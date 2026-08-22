const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { hashPassword } = require('./lib/password');

const DB_PATH = path.join(__dirname, 'harf.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  bio TEXT,
  profile_image_url TEXT,
  user_type TEXT NOT NULL DEFAULT 'writer' CHECK (user_type IN ('reader','writer','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS writer_profiles (
  user_id INTEGER PRIMARY KEY,
  bio_full TEXT,
  cover_image_url TEXT,
  country TEXT,
  specialization TEXT,
  follower_count INTEGER NOT NULL DEFAULT 0,
  article_count INTEGER NOT NULL DEFAULT 0,
  total_views INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category_id INTEGER,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  content TEXT,
  featured_image_url TEXT,
  reading_time_minutes INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','pending_review','published','rejected')),
  rejection_reason TEXT,
  published_at TEXT DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS followers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  writer_id INTEGER NOT NULL,
  follower_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(writer_id, follower_id),
  FOREIGN KEY (writer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(article_id, user_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rpm_rates (
  country_code TEXT PRIMARY KEY,
  country_name TEXT NOT NULL,
  rpm_usd REAL NOT NULL DEFAULT 0.5
);

CREATE TABLE IF NOT EXISTS user_earnings (
  user_id INTEGER PRIMARY KEY,
  total_earnings REAL NOT NULL DEFAULT 0,
  available_balance REAL NOT NULL DEFAULT 0,
  total_views INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS view_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  country_code TEXT NOT NULL,
  rpm_usd REAL NOT NULL,
  earning_usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('vodafone_cash','etisalat_cash','instapay','tilda','airtm')),
  account_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, method),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('vodafone_cash','etisalat_cash','instapay','tilda','airtm')),
  payment_details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','processing','completed','rejected')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const MIN_WITHDRAWAL_USD = 10;

(function seedRpmRatesIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM rpm_rates').get();
  if (count > 0) return;
  const insertRate = db.prepare('INSERT INTO rpm_rates (country_code, country_name, rpm_usd) VALUES (?, ?, ?)');
  const rates = [
    ['US', 'الولايات المتحدة', 1.50], ['CA', 'كندا', 1.25], ['GB', 'المملكة المتحدة', 1.20],
    ['AU', 'أستراليا', 1.15], ['AE', 'الإمارات', 0.75], ['SA', 'السعودية', 0.60],
    ['EG', 'مصر', 0.50], ['DE', 'ألمانيا', 1.10], ['FR', 'فرنسا', 0.95],
    ['DEFAULT', 'الدول الأخرى', 0.50],
  ];
  for (const r of rates) insertRate.run(...r);
})();

function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return;

  const insertCategory = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)');
  const categories = {
    culture: insertCategory.run('ثقافة وأدب', 'culture').lastInsertRowid,
    tech: insertCategory.run('علوم وتقنية', 'tech').lastInsertRowid,
    business: insertCategory.run('اقتصاد وأعمال', 'business').lastInsertRowid,
  };

  const insertUser = db.prepare(`
    INSERT INTO users (username, email, phone, password_hash, first_name, last_name, bio, profile_image_url, user_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'writer')
  `);
  const insertProfile = db.prepare(`
    INSERT INTO writer_profiles (user_id, bio_full, country, specialization, follower_count, article_count, total_views) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertArticle = db.prepare(`
    INSERT INTO articles (user_id, category_id, title, slug, description, featured_image_url, reading_time_minutes, view_count, like_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demoPasswordHash = hashPassword('demo12345');

  const authors = [
    {
      username: 'mariam-alansari', email: 'mariam@harf.demo', first: 'مريم', last: 'الأنصاري',
      bio: 'كاتبة أدبية من القاهرة، تكتب في الثقافة والهوية والمجتمع.',
      avatar: '/images/authors/mariam-alansari.png',
      country: 'مصر', specialization: 'ثقافة وأدب',
      followers: 18, views: 4200,
      article: {
        category: categories.culture, title: 'الكتابة فعل مقاومة: لماذا نكتب في زمن السرعة؟',
        slug: 'article-writing-resistance', description: 'في عصر تتسابق فيه المنشورات وتتراكم المحتويات، تصبح الكتابة الواعية صوتاً فردياً يقاوم الضجيج.',
        image: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1200&q=80', minutes: 7, views: 4200, likes: 231,
      },
    },
    {
      username: 'hoda-yassin', email: 'hoda@harf.demo', first: 'هدى', last: 'ياسين',
      bio: 'كاتبة مستقلة من مصر متخصصة في الذكاء الاصطناعي، تجمع بين خلفية تقنية عميقة وقلم سلس يقرّب أعقد المفاهيم للقارئ العادي. نشرت ٧ مقالات حول الذكاء الاصطناعي وتطبيقاته عبر مسيرتها المهنية.',
      avatar: '/images/authors/hoda-yassin.png',
      country: 'مصر', specialization: 'الذكاء الاصطناعي',
      followers: 233, views: 32000,
      article: {
        category: categories.tech, title: 'الذكاء الاصطناعي والإبداع: هل يستطيع الآلة أن تكتب رواية؟',
        slug: 'article-ai-creativity', description: 'جدل فلسفي عميق بين الإبداع الإنساني والذكاء الاصطناعي، وحدود ما يمكن للآلة أن تكتبه.',
        image: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80', minutes: 12, views: 2100, likes: 98,
      },
    },
    {
      username: 'siham-sayed', email: 'siham@harf.demo', first: 'سهام', last: 'سيد',
      bio: 'كاتبة مستقلة من مصر متخصصة في التسويق الرقمي، تحوّل أدوات التسويق الحديثة إلى محتوى عملي مباشر لأصحاب المشاريع الصغيرة والمستقلين.',
      avatar: '/images/authors/siham-sayed.png',
      country: 'مصر', specialization: 'التسويق الرقمي',
      followers: 120, views: 19000,
      article: {
        category: categories.business, title: 'الكاتب المستقل: كيف تحوّل قلمك إلى مصدر دخل ثابت؟',
        slug: 'article-freelance-income', description: 'دليل عملي شامل للكتّاب الراغبين في تحويل شغفهم بالكتابة إلى مهنة ناجحة ومصدر دخل حقيقي.',
        image: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=80', minutes: 10, views: 3700, likes: 175,
      },
    },
    {
      username: 'ahmed-awadallah', email: 'ahmed.awadallah@harf.demo', first: 'أحمد', last: 'عوض الله',
      bio: 'كاتب مستقل متخصص في الترجمة وتعلم اللغات، وله خبرة في التدريس عن بعد ساعدته على فهم أكبر التحديات التي تواجه متعلمي اللغات العرب.',
      avatar: '/images/authors/ahmed-awadallah.png',
      country: 'مصر', specialization: 'الترجمة وتعلم اللغات',
      followers: 177, views: 23000,
      article: {
        category: categories.culture, title: 'في رحلة البحث عن الهوية: الكاتب العربي بين الأصالة والحداثة',
        slug: 'article-arab-writer-identity', description: 'يجد الكاتب العربي نفسه بين قوى الموروث الثقافي الغني ومتطلبات العالم المتغير.',
        image: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1200&q=80', minutes: 9, views: 4200, likes: 0,
      },
    },
  ];

  const insertEarnings = db.prepare(`
    INSERT INTO user_earnings (user_id, total_earnings, available_balance, total_views) VALUES (?, ?, ?, ?)
  `);
  const defaultRpm = db.prepare("SELECT rpm_usd FROM rpm_rates WHERE country_code = 'DEFAULT'").get().rpm_usd;

  for (const author of authors) {
    const userId = insertUser.run(
      author.username, author.email, null, demoPasswordHash,
      author.first, author.last, author.bio, author.avatar
    ).lastInsertRowid;
    insertProfile.run(userId, author.bio, author.country, author.specialization, author.followers, 1, author.views);
    const a = author.article;
    const articleId = insertArticle.run(userId, a.category, a.title, a.slug, a.description, a.image, a.minutes, a.views, a.likes).lastInsertRowid;
    const earning = Math.round((a.views / 1000) * defaultRpm * 100) / 100;
    insertEarnings.run(userId, earning, earning, a.views);
    db.prepare(`
      INSERT INTO view_events (article_id, author_id, country_code, rpm_usd, earning_usd, created_at)
      VALUES (?, ?, 'DEFAULT', ?, ?, datetime('now'))
    `).run(articleId, userId, defaultRpm, earning);
  }

  const adminId = db.prepare(`
    INSERT INTO users (username, email, phone, password_hash, first_name, last_name, user_type)
    VALUES ('admin', 'admin@harf.demo', NULL, ?, 'مشرف', 'حرف', 'admin')
  `).run(demoPasswordHash).lastInsertRowid;
  db.prepare('INSERT INTO writer_profiles (user_id) VALUES (?)').run(adminId);
  db.prepare('INSERT INTO user_earnings (user_id) VALUES (?)').run(adminId);
}

seedIfEmpty();

module.exports = db;
module.exports.MIN_WITHDRAWAL_USD = MIN_WITHDRAWAL_USD;
