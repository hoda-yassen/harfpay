const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const geoip = require('geoip-lite');
const db = require('../db');
const { requireAuth } = require('../lib/session');
const { DATA_DIR } = require('../lib/paths');

const router = express.Router();

const DAILY_ARTICLE_LIMIT = 3;
function hasReachedDailyLimit(userId) {
  const { count } = db.prepare(`
    SELECT COUNT(*) AS count FROM articles
    WHERE user_id = ? AND date(created_at) = date('now')
  `).get(userId);
  return count >= DAILY_ARTICLE_LIMIT;
}

// صور المقالات المرفوعة تُخزَّن في DATA_DIR (اللي المفروض يكون Volume دائم على Railway)، مش في فولدر الكود،
// عشان ما تُمسح لما الموقع يتحدّث. server.js بيوصّل رابط /images/articles/ للمكان ده فعليًا.
const ARTICLE_IMAGES_DIR = path.join(DATA_DIR, 'uploads', 'articles');
fs.mkdirSync(ARTICLE_IMAGES_DIR, { recursive: true });
const ALLOWED_IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const uploadArticleImage = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ARTICLE_IMAGES_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_IMAGE_TYPES[file.mimetype] || path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) return cb(new Error('صيغة الصورة غير مدعومة (jpg, png, webp فقط)'));
    cb(null, true);
  },
});

router.post('/upload-image', requireAuth, (req, res) => {
  uploadArticleImage.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرفاق صورة' });
    res.json({ url: `/images/articles/${req.file.filename}` });
  });
});

// يحدد بلد الزائر من عنوان الـ IP محليًا (بدون أي اتصال خارجي) لاحتساب سعر المشاهدة المناسب لبلده.
// على جهاز محلي (127.0.0.1) لا يوجد بلد حقيقي فيُستخدم السعر الافتراضي — يعمل بدقة فقط بعد نشر الموقع فعليًا.
function resolveCountryCode(ip) {
  const geo = geoip.lookup(ip);
  if (!geo || !geo.country) return 'DEFAULT';
  const known = db.prepare('SELECT 1 FROM rpm_rates WHERE country_code = ?').get(geo.country);
  return known ? geo.country : 'DEFAULT';
}

const MIN_CONTENT_LENGTH = 1500;
const MAX_CONTENT_LENGTH = 50000;

// حماية بسيطة من إعادة تحميل الصفحة المتكررة لتضخيم المشاهدات والأرباح صناعياً.
// هذا ليس نظام مكافحة احتيال كامل (جدول fraud_detection في الـ schema الأصلي يغطي هذا لاحقاً).
const recentViews = new Map();
const VIEW_COOLDOWN_MS = 30 * 1000;

function shouldCountView(ip, articleId) {
  const key = `${ip}:${articleId}`;
  const last = recentViews.get(key);
  const now = Date.now();
  if (last && now - last < VIEW_COOLDOWN_MS) return false;
  recentViews.set(key, now);
  return true;
}

// يرفض الزيارات القادمة من بوتات معروفة (محركات بحث، أدوات فحص، سكربتات آلية) قبل احتسابها أصلاً.
const BOT_UA_PATTERN = /bot|crawl|spider|slurp|headless|curl|wget|python-requests|scrapy|phantomjs|axios|go-http-client/i;
function isBotUserAgent(userAgent) {
  return !userAgent || BOT_UA_PATTERN.test(userAgent);
}

// أقل مدة قراءة (بالثواني) عشان نعتبر الزيارة حقيقية. زيارة أقصر من كده (أو صفر) تُعتبر وهمية وتُخصم لاحقًا.
const MIN_READ_SECONDS = 3;

function slugify(title) {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'maqal'}-${suffix}`;
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.title, a.slug, a.description, a.featured_image_url, a.reading_time_minutes,
           a.view_count, a.like_count, a.published_at, a.is_pinned, a.is_hero_pinned,
           u.username AS author_username, u.first_name AS author_first_name, u.last_name AS author_last_name,
           u.profile_image_url AS author_avatar,
           c.name AS category_name, c.slug AS category_slug
    FROM articles a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN categories c ON c.id = a.category_id
    WHERE a.status = 'published'
    ORDER BY a.is_pinned DESC, a.published_at DESC
  `).all();
  res.json({ articles: rows });
});

router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.title, a.slug, a.status, a.rejection_reason, a.view_count, a.like_count, a.created_at, a.published_at,
           c.name AS category_name
    FROM articles a
    LEFT JOIN categories c ON c.id = a.category_id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC
  `).all(req.userId);
  res.json({ articles: rows });
});

router.post('/', requireAuth, (req, res) => {
  const { title, categoryId, description, content, featuredImageUrl, metaKeywords } = req.body || {};

  if (hasReachedDailyLimit(req.userId)) {
    return res.status(429).json({ error: `وصلت للحد الأقصى للنشر اليومي (${DAILY_ARTICLE_LIMIT} مقالات). حاول تاني بكرة.` });
  }
  if (!title || !title.trim()) return res.status(400).json({ error: 'عنوان المقال مطلوب' });
  if (title.trim().length > 100) return res.status(400).json({ error: 'العنوان طويل جداً (الحد الأقصى ١٠٠ حرف)' });
  if (!content || content.trim().length < MIN_CONTENT_LENGTH) {
    return res.status(400).json({ error: `محتوى المقال قصير جداً — الحد الأدنى ${MIN_CONTENT_LENGTH} حرف لضمان جودة المحتوى` });
  }
  if (content.trim().length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({ error: `محتوى المقال طويل جداً — الحد الأقصى ${MAX_CONTENT_LENGTH} حرف` });
  }
  if (description && description.length > 160) {
    return res.status(400).json({ error: 'الوصف المختصر يجب ألا يتجاوز ١٦٠ حرفاً' });
  }

  const slug = slugify(title);
  const wordCount = content.trim().split(/\s+/).length;
  const readingTime = Math.max(1, Math.round(wordCount / 200));

  const info = db.prepare(`
    INSERT INTO articles (user_id, category_id, title, slug, description, meta_keywords, content, featured_image_url, reading_time_minutes, status, is_published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', 0)
  `).run(req.userId, categoryId || null, title.trim(), slug, description || null, (metaKeywords || '').trim() || null, content.trim(), featuredImageUrl || null, readingTime);

  res.status(201).json({ article: { id: info.lastInsertRowid, slug, status: 'pending_review' } });
});

router.get('/:slug', (req, res) => {
  const article = db.prepare(`
    SELECT a.*, u.username AS author_username, u.first_name AS author_first_name, u.last_name AS author_last_name,
           u.profile_image_url AS author_avatar, c.name AS category_name
    FROM articles a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN categories c ON c.id = a.category_id
    WHERE a.slug = ?
  `).get(req.params.slug);
  if (!article) return res.status(404).json({ error: 'المقال غير موجود' });

  const isOwner = req.userId === article.user_id;
  if (article.status !== 'published' && !isOwner) {
    return res.status(404).json({ error: 'المقال غير موجود' });
  }

  const isSelfView = req.userId === article.user_id;
  const userAgent = req.get('User-Agent') || '';
  let reportToken = null;

  // زيارات البوتات (سكربتات، محركات فحص) تُرفض قبل احتسابها أصلاً — مش هتوصل حتى لمرحلة الخصم لاحقًا.
  if (article.status === 'published' && !isSelfView && !isBotUserAgent(userAgent) && shouldCountView(req.ip, article.id)) {
    db.prepare('UPDATE articles SET view_count = view_count + 1 WHERE id = ?').run(article.id);
    article.view_count += 1;

    const countryCode = resolveCountryCode(req.ip);
    const rate = db.prepare('SELECT rpm_usd FROM rpm_rates WHERE country_code = ?').get(countryCode).rpm_usd;
    const earning = rate / 1000;
    // توكن عشوائي غير قابل للتخمين لتأكيد مدة القراءة لاحقًا — يمنع أي زائر من التلاعب بزيارات مقالات غيره
    // عن طريق تخمين أرقام تسلسلية والإبلاغ عن مدد وهمية لتزوير أو إسقاط أرباح كاتب آخر.
    reportToken = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO view_events (article_id, author_id, country_code, rpm_usd, earning_usd, ip_address, user_agent, report_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(article.id, article.user_id, countryCode, rate, earning, req.ip, userAgent, reportToken);
    db.prepare(`
      UPDATE user_earnings SET total_earnings = total_earnings + ?, available_balance = available_balance + ?,
        total_views = total_views + 1, updated_at = datetime('now') WHERE user_id = ?
    `).run(earning, earning, article.user_id);
  }

  res.json({ article, reportToken });
});

// الصفحة بترسل هنا مدة بقاء القارئ الفعلية بعد ما يسيب الصفحة (عبر sendBeacon)، معرَّفة بتوكن الزيارة
// العشوائي (مش رقمها التسلسلي) عشان محدش يقدر يخمّن زيارات غيره ويتلاعب بيها.
// لو المدة قليلة جداً (زيارة وهمية/ارتداد فوري) بنسحب المشاهدة والأرباح المرتبطة بيها ونبلّغ الكاتب.
router.post('/view-events/:token/duration', (req, res) => {
  const { duration } = req.body || {};
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return res.status(400).json({ error: 'مدة غير صحيحة' });
  }

  const event = db.prepare('SELECT * FROM view_events WHERE report_token = ?').get(req.params.token);
  if (!event) return res.status(404).json({ error: 'الزيارة غير موجودة' });
  if (event.duration_seconds !== null) return res.json({ ok: true }); // مُعالَجة بالفعل، تجاهل أي تكرار

  db.prepare('UPDATE view_events SET duration_seconds = ? WHERE id = ?').run(Math.round(seconds), event.id);

  if (seconds < MIN_READ_SECONDS) {
    db.prepare('UPDATE view_events SET is_fraud = 1 WHERE id = ?').run(event.id);
    db.prepare('UPDATE articles SET view_count = MAX(view_count - 1, 0) WHERE id = ?').run(event.article_id);
    db.prepare(`
      UPDATE user_earnings SET total_earnings = MAX(total_earnings - ?, 0), available_balance = MAX(available_balance - ?, 0),
        total_views = MAX(total_views - 1, 0) WHERE user_id = ?
    `).run(event.earning_usd, event.earning_usd, event.author_id);

    const article = db.prepare('SELECT title FROM articles WHERE id = ?').get(event.article_id);
    db.prepare(`
      INSERT INTO notifications (user_id, type, message, article_id)
      VALUES (?, 'fraud_alert', ?, ?)
    `).run(
      event.author_id,
      `تنبيه: تم اكتشاف زيارة غير شرعية/وهمية على مقالك "${article ? article.title : ''}" وتم خصمها من رصيدك ومشاهداتك للحفاظ على جودة الموقع.`,
      event.article_id
    );
  }

  res.json({ ok: true });
});

router.put('/:slug', requireAuth, (req, res) => {
  const article = db.prepare('SELECT * FROM articles WHERE slug = ?').get(req.params.slug);
  if (!article) return res.status(404).json({ error: 'المقال غير موجود' });
  if (article.user_id !== req.userId) return res.status(403).json({ error: 'لا يمكنك تعديل مقال ليس لك' });

  const { title, categoryId, description, content, featuredImageUrl, metaKeywords } = req.body || {};

  if (!title || !title.trim()) return res.status(400).json({ error: 'عنوان المقال مطلوب' });
  if (title.trim().length > 100) return res.status(400).json({ error: 'العنوان طويل جداً (الحد الأقصى ١٠٠ حرف)' });
  if (!content || content.trim().length < MIN_CONTENT_LENGTH) {
    return res.status(400).json({ error: `محتوى المقال قصير جداً — الحد الأدنى ${MIN_CONTENT_LENGTH} حرف لضمان جودة المحتوى` });
  }
  if (content.trim().length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({ error: `محتوى المقال طويل جداً — الحد الأقصى ${MAX_CONTENT_LENGTH} حرف` });
  }
  if (description && description.length > 160) {
    return res.status(400).json({ error: 'الوصف المختصر يجب ألا يتجاوز ١٦٠ حرفاً' });
  }

  const wordCount = content.trim().split(/\s+/).length;
  const readingTime = Math.max(1, Math.round(wordCount / 200));

  // أي تعديل على مقال منشور أو مرفوض يعيده لطابور المراجعة لضمان جودة المحتوى المعدَّل.
  db.prepare(`
    UPDATE articles SET title = ?, category_id = ?, description = ?, meta_keywords = ?, content = ?, featured_image_url = ?,
      reading_time_minutes = ?, status = 'pending_review', rejection_reason = NULL
    WHERE id = ?
  `).run(title.trim(), categoryId || null, description || null, (metaKeywords || '').trim() || null, content.trim(), featuredImageUrl || null, readingTime, article.id);

  res.json({ article: { id: article.id, slug: article.slug, status: 'pending_review' } });
});

router.delete('/:slug', requireAuth, (req, res) => {
  const article = db.prepare('SELECT id, user_id FROM articles WHERE slug = ?').get(req.params.slug);
  if (!article) return res.status(404).json({ error: 'المقال غير موجود' });
  if (article.user_id !== req.userId) return res.status(403).json({ error: 'لا يمكنك حذف مقال ليس لك' });

  db.prepare('DELETE FROM articles WHERE id = ?').run(article.id);
  res.json({ ok: true });
});

router.get('/:slug/related', (req, res) => {
  const article = db.prepare('SELECT id, category_id FROM articles WHERE slug = ?').get(req.params.slug);
  if (!article) return res.status(404).json({ error: 'المقال غير موجود' });

  const baseSelect = `
    SELECT a.id, a.title, a.slug, a.featured_image_url, a.view_count,
           u.username AS author_username, u.first_name AS author_first_name, u.last_name AS author_last_name
    FROM articles a JOIN users u ON u.id = a.user_id
    WHERE a.status = 'published' AND a.id != ?
  `;

  let related = [];
  if (article.category_id) {
    related = db.prepare(`${baseSelect} AND a.category_id = ? ORDER BY RANDOM() LIMIT 6`)
      .all(article.id, article.category_id);
  }
  if (related.length < 3) {
    const excludeIds = [article.id, ...related.map(r => r.id)];
    const placeholders = excludeIds.map(() => '?').join(',');
    const fill = db.prepare(`${baseSelect.replace('AND a.id != ?', `AND a.id NOT IN (${placeholders})`)} ORDER BY RANDOM() LIMIT ?`)
      .all(...excludeIds, 6 - related.length);
    related = related.concat(fill);
  }

  res.json({ articles: related.slice(0, 6) });
});

router.post('/:slug/like', requireAuth, (req, res) => {
  const article = db.prepare('SELECT id FROM articles WHERE slug = ?').get(req.params.slug);
  if (!article) return res.status(404).json({ error: 'المقال غير موجود' });

  const existing = db.prepare('SELECT id FROM likes WHERE article_id = ? AND user_id = ?').get(article.id, req.userId);
  let liked;
  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    db.prepare('UPDATE articles SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(article.id);
    liked = false;
  } else {
    db.prepare('INSERT INTO likes (article_id, user_id) VALUES (?, ?)').run(article.id, req.userId);
    db.prepare('UPDATE articles SET like_count = like_count + 1 WHERE id = ?').run(article.id);
    liked = true;
  }
  const row = db.prepare('SELECT like_count FROM articles WHERE id = ?').get(article.id);
  res.json({ liked, likeCount: row.like_count });
});

module.exports = router;
