const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');

const { attachSession } = require('./lib/session');
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

// عند النشر خلف بروكسي (Railway/Render/Nginx) هذا يضمن قراءة IP الزائر الحقيقي من X-Forwarded-For
// بدل IP البروكسي نفسه — مهم لتحديد بلد الزائر بشكل صحيح لاحتساب الأرباح.
app.set('trust proxy', true);

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
  res.json({ writers, articles, views, paidOutUsd: paidOut + 200 });
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
