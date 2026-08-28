const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');

const { attachSession } = require('./lib/session');
const { DATA_DIR } = require('./lib/paths');
const { lookupCountry } = require('./lib/geo');
const authRoutes = require('./routes/auth');
const authorRoutes = require('./routes/authors');
const articleRoutes = require('./routes/articles');
const profileRoutes = require('./routes/profile');
const walletRoutes = require('./routes/wallet');
const withdrawalRoutes = require('./routes/withdrawals');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');
const paymentAccountRoutes = require('./routes/payment-accounts');

const app = express();
const SITE_ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

// عند النشر خلف بروكسي واحد فقط (Railway/Render) هذا يضمن قراءة IP الزائر الحقيقي من X-Forwarded-For.
// "true" بدل رقم محدد كانت ثغرة: بتخلي أي زائر يزوّر IP نفسه بحرية عبر هذا الهيدر (لتضخيم مشاهداته
// أو انتحال بلد بسعر ربح أعلى)، لأن Express كان بيثق في أول قيمة بالهيدر وهي قابلة للتزييف بالكامل من المتصفح.
app.set('trust proxy', 1);

// حماية أساسية من تخمين نوع الملف (MIME sniffing) للصور المرفوعة من المستخدمين.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(attachSession);

app.use('/api/auth', authRoutes);
app.use('/api/authors', authorRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payment-accounts', paymentAccountRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// القيد UNIQUE(ip_address, visit_date) بيمنع تكرار الصف في القاعدة، لكن ده لوحده مش كفاية: كل طلب
// برضو بيوصل لـ SQLite المتزامن (DatabaseSync) اللي بيوقف الـ event loop لحظيًا، فطلبات كتير جدًا
// في وقت قصير (DoS) لسه ممكنة من غير حد أقصى صريح — الـ rate limit ده بيمنع الاستنزاف ده.
const trackVisitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/track-visit', trackVisitLimiter, (req, res) => {
  const db = require('./db');
  const country = lookupCountry(req.ip);
  const source = typeof req.body?.source === 'string' ? req.body.source.trim().slice(0, 60).replace(/[^\w؀-ۿ-]/g, '') : null;
  const visitDate = new Date().toISOString().slice(0, 10);
  try {
    db.prepare('INSERT OR IGNORE INTO site_visits (ip_address, visit_date, country, source) VALUES (?, ?, ?, ?)')
      .run(req.ip, visitDate, country, source || null);
  } catch (e) {}
  res.status(204).end();
});

app.get('/api/categories', (req, res) => {
  const db = require('./db');
  const cats = db.prepare(`
    SELECT c.id, c.name, c.slug, COUNT(a.id) AS article_count
    FROM categories c
    LEFT JOIN articles a ON a.category_id = c.id AND a.status = 'published'
    GROUP BY c.id ORDER BY article_count DESC, c.name
  `).all();
  res.json({ categories: cats });
});

app.get('/api/stats', (req, res) => {
  const db = require('./db');
  const writers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE user_type = 'writer'").get().n;
  const articles = db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published'").get().n;
  const views = db.prepare("SELECT COALESCE(SUM(view_count), 0) AS n FROM articles WHERE status = 'published'").get().n;
  const paidOut = db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM withdrawal_requests WHERE status = 'completed'").get().n;
  const signupSources = db.prepare(`
    SELECT COALESCE(NULLIF(signup_source, ''), 'مباشر') AS source, COUNT(*) AS n
    FROM users WHERE user_type = 'writer' GROUP BY source ORDER BY n DESC
  `).all();
  res.json({ writers, articles, views, paidOutUsd: paidOut, signupSources });
});

// يمنع الوصول المباشر لفولدر السيرفر (قاعدة البيانات، الكود، الأسرار) عبر رابط — كان مكشوفاً بالكامل قبل هذا السطر.
app.use((req, res, next) => {
  if (req.path.toLowerCase().startsWith('/server')) return res.status(404).json({ error: 'غير موجود' });
  next();
});

// صور المقالات المرفوعة تعيش في DATA_DIR (فولدر دائم، منفصل عن كود الموقع) — نوصّل رابطها المعروف
// /images/articles/ للمكان الحقيقي ده، قبل الملفات الثابتة العادية.
app.use('/images/articles', express.static(path.join(DATA_DIR, 'uploads', 'articles')));

// خريطة الموقع بتتولّد ديناميكيًا من قاعدة البيانات الحقيقية بدل ملف ثابت كان بيفضل قديم ومش بيتحدث
// أوتوماتيك كل ما مقال جديد يتنشر أو كاتب جديد ينضم — وده أساسي عشان جوجل يكتشف المحتوى الجديد بسرعة.
app.get('/sitemap.xml', (req, res) => {
  const db = require('./db');
  const origin = `${req.protocol}://${req.get('host')}`;
  const staticPages = [
    ['harf-website.html', 'daily', '1.0'],
    ['browse-articles.html', 'daily', '0.9'],
    ['seo-analyzer.html', 'weekly', '0.7'],
    ['help-center.html', 'monthly', '0.5'],
    ['about.html', 'monthly', '0.5'],
    ['privacy-policy.html', 'yearly', '0.3'],
    ['terms-of-use.html', 'yearly', '0.3'],
    ['withdrawal-policy.html', 'yearly', '0.3'],
  ];
  const articles = db.prepare(`SELECT slug, published_at FROM articles WHERE status = 'published' ORDER BY published_at DESC`).all();
  const authors = db.prepare(`
    SELECT DISTINCT u.username FROM users u JOIN articles a ON a.user_id = u.id WHERE a.status = 'published'
  `).all();

  const urlTag = (loc, changefreq, priority, lastmod) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticPages.map(([p, freq, pr]) => urlTag(`${origin}/${p}`, freq, pr)),
    ...articles.map(a => urlTag(`${origin}/article-view.html?slug=${encodeURIComponent(a.slug)}`, 'monthly', '0.8', a.published_at ? a.published_at.slice(0, 10) : undefined)),
    ...authors.map(u => urlTag(`${origin}/author-${u.username}.html`, 'weekly', '0.6')),
    '</urlset>',
  ].join('\n');

  res.type('application/xml').send(xml);
});

// يقرأ عنوان ووصف وصورة كل مقال من القاعدة ويحطها في الـ<head> قبل ما الصفحة توصل للمتصفح — عشان
// روبوتات البحث (جوجل) وأدوات معاينة الروابط (فيسبوك/واتساب) اللي مابتشغّلش JavaScript تشوف العنوان
// والوصف الحقيقيين للمقال فورًا، بدل عنوان عام ثابت كان بيفضل زي ما هو لحد ما JS يشتغل في المتصفح.
// لازم يتسجّل قبل express.static — وإلا static هيلاقي الملف الثابت الأول ويردّه زي ما هو من غير تعديل.
app.get('/article-view.html', (req, res) => {
  const filePath = path.join(SITE_ROOT, 'article-view.html');
  const slug = req.query.slug;
  if (!slug) return res.sendFile(filePath);

  const db = require('./db');
  const article = db.prepare(`
    SELECT a.title, a.description, a.meta_keywords, a.featured_image_url, a.published_at, a.slug,
           u.first_name AS author_first_name, u.last_name AS author_last_name, u.username AS author_username
    FROM articles a JOIN users u ON u.id = a.user_id
    WHERE a.slug = ? AND a.status = 'published'
  `).get(slug);
  if (!article) return res.sendFile(filePath);

  const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const origin = `${req.protocol}://${req.get('host')}`;
  const url = `${origin}/article-view.html?slug=${encodeURIComponent(article.slug)}`;
  const authorName = `${article.author_first_name || ''} ${article.author_last_name || ''}`.trim() || article.author_username;
  const title = `${article.title} | حرف`;
  const description = article.description || '';
  const image = article.featured_image_url || '';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: article.title, description: article.description || undefined,
    image: image || undefined, author: { '@type': 'Person', name: authorName },
    datePublished: article.published_at || undefined, mainEntityOfPage: url,
  });

  let html = fs.readFileSync(filePath, 'utf8');
  html = html
    .replace('<title id="pageTitle">مقال | حرف</title>', `<title id="pageTitle">${esc(title)}</title>`)
    .replace('<meta id="metaDescription" name="description" content="">', `<meta id="metaDescription" name="description" content="${esc(description)}">`)
    .replace('<meta id="metaKeywords" name="keywords" content="">', `<meta id="metaKeywords" name="keywords" content="${esc(article.meta_keywords || '')}">`)
    .replace('<link id="canonicalLink" rel="canonical" href="">', `<link id="canonicalLink" rel="canonical" href="${esc(url)}">`)
    .replace('<meta id="ogTitle" property="og:title" content="">', `<meta id="ogTitle" property="og:title" content="${esc(article.title)}">`)
    .replace('<meta id="ogDescription" property="og:description" content="">', `<meta id="ogDescription" property="og:description" content="${esc(description)}">`)
    .replace('<meta id="ogImage" property="og:image" content="">', `<meta id="ogImage" property="og:image" content="${esc(image)}">`)
    .replace('<meta id="ogUrl" property="og:url" content="">', `<meta id="ogUrl" property="og:url" content="${esc(url)}">`)
    .replace('</head>', `<script type="application/ld+json">${jsonLd}</script>\n</head>`);

  res.send(html);
});

app.use(express.static(SITE_ROOT));

app.get('/', (req, res) => {
  res.sendFile(path.join(SITE_ROOT, 'harf-website.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'غير موجود' });
});

app.listen(PORT, () => {
  console.log(`Harf server running at http://localhost:${PORT}`);
});
