const express = require('express');
const crypto = require('node:crypto');
const geoip = require('geoip-lite');
const db = require('../db');
const { requireAuth } = require('../lib/session');

const router = express.Router();

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
           a.view_count, a.like_count, a.published_at,
           u.username AS author_username, u.first_name AS author_first_name, u.last_name AS author_last_name,
           u.profile_image_url AS author_avatar,
           c.name AS category_name, c.slug AS category_slug
    FROM articles a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN categories c ON c.id = a.category_id
    WHERE a.status = 'published'
    ORDER BY a.published_at DESC
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
  const { title, categoryId, description, content, featuredImageUrl } = req.body || {};

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
    INSERT INTO articles (user_id, category_id, title, slug, description, content, featured_image_url, reading_time_minutes, status, is_published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', 0)
  `).run(req.userId, categoryId || null, title.trim(), slug, description || null, content.trim(), featuredImageUrl || null, readingTime);

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
  if (article.status === 'published' && !isSelfView && shouldCountView(req.ip, article.id)) {
    db.prepare('UPDATE articles SET view_count = view_count + 1 WHERE id = ?').run(article.id);
    article.view_count += 1;

    const countryCode = resolveCountryCode(req.ip);
    const rate = db.prepare('SELECT rpm_usd FROM rpm_rates WHERE country_code = ?').get(countryCode).rpm_usd;
    const earning = rate / 1000;
    db.prepare(`
      INSERT INTO view_events (article_id, author_id, country_code, rpm_usd, earning_usd)
      VALUES (?, ?, ?, ?, ?)
    `).run(article.id, article.user_id, countryCode, rate, earning);
    db.prepare(`
      UPDATE user_earnings SET total_earnings = total_earnings + ?, available_balance = available_balance + ?,
        total_views = total_views + 1, updated_at = datetime('now') WHERE user_id = ?
    `).run(earning, earning, article.user_id);
  }

  res.json({ article });
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
