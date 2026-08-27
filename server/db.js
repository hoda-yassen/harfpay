const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword, verifyPassword } = require('./lib/password');
const { DATA_DIR } = require('./lib/paths');

// باسورد الأدمن الافتراضي لأول تشغيل (زراعة قاعدة بيانات فاضية) — يُقرأ من متغيّر بيئة على Railway وليس من الكود،
// عشان مفيش باسورد حقيقي يتخزن نصًّا صريحًا في مستودع GitHub (اللي ممكن يكون عام/مقروء لأي حد).
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_SEED_PASSWORD || 'demo12345';
// باسورد استرجاع مؤقت — لو محدد، بيرفع حساب الأدمن التجريبي وحساب المالكة الشخصي لنفس الباسورد ده تلقائيًا،
// ده مفيد لحظة ما الباسورد القديم يتكشف أو تنساه المالكة. لازم يتشال من Railway بعد ما تسجّل دخول بنجاح.
const ADMIN_RESET_PASSWORD = process.env.ADMIN_RESET_PASSWORD || null;

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'harf.db');
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
  meta_keywords TEXT,
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
  ip_address TEXT,
  user_agent TEXT,
  report_token TEXT,
  duration_seconds INTEGER,
  is_fraud INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  article_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
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

// يضيف أعمدة جديدة لجداول موجودة بالفعل بأمان (CREATE TABLE IF NOT EXISTS لا يعدّل جدولاً قائماً).
(function migrateColumns() {
  function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  }
  if (!hasColumn('articles', 'meta_keywords')) {
    db.exec('ALTER TABLE articles ADD COLUMN meta_keywords TEXT');
  }
  if (!hasColumn('articles', 'is_pinned')) {
    db.exec('ALTER TABLE articles ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn('articles', 'is_hero_pinned')) {
    db.exec('ALTER TABLE articles ADD COLUMN is_hero_pinned INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn('users', 'reset_token_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN reset_token_hash TEXT');
  }
  if (!hasColumn('users', 'reset_token_expires')) {
    db.exec('ALTER TABLE users ADD COLUMN reset_token_expires TEXT');
  }
  if (!hasColumn('view_events', 'ip_address')) {
    db.exec('ALTER TABLE view_events ADD COLUMN ip_address TEXT');
  }
  if (!hasColumn('view_events', 'user_agent')) {
    db.exec('ALTER TABLE view_events ADD COLUMN user_agent TEXT');
  }
  if (!hasColumn('view_events', 'duration_seconds')) {
    db.exec('ALTER TABLE view_events ADD COLUMN duration_seconds INTEGER');
  }
  if (!hasColumn('view_events', 'is_fraud')) {
    db.exec('ALTER TABLE view_events ADD COLUMN is_fraud INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn('view_events', 'report_token')) {
    db.exec('ALTER TABLE view_events ADD COLUMN report_token TEXT');
  }
  if (!hasColumn('users', 'signup_source')) {
    db.exec('ALTER TABLE users ADD COLUMN signup_source TEXT');
  }
})();

// لو حساب الأدمن لسه على باسورد ضعيف/مكشوف قديم (demo12345 أو الباسورد اللي كان مكتوبًا غلط في الكود العلني قبل كده)،
// بيترفّع تلقائيًا للباسورد الجديد المقروء من متغيّر بيئة (ADMIN_SEED_PASSWORD)، مش من الكود نفسه.
(function upgradeWeakAdminPassword() {
  const admin = db.prepare("SELECT id, password_hash FROM users WHERE email = 'admin@harf.demo'").get();
  if (!admin) return;
  const isKnownWeak = verifyPassword('demo12345', admin.password_hash)
    || verifyPassword('3niglgHtOyfIXQ1260@', admin.password_hash); // كان مكشوفًا في مستودع GitHub العام — لازم يتغيّر.
  if (isKnownWeak) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(ADMIN_DEFAULT_PASSWORD), admin.id);
  }
})();

// باسورد استرجاع مؤقت (لو حددته المالكة في Railway): يرفع باسورد حساب الأدمن التجريبي وحسابها الشخصي لنفس القيمة،
// عشان تقدر تدخل تاني لو نسيت الباسورد أو انكشف. لازم تشيل المتغيّر ده من Railway بعد ما تسجّل دخول بنجاح.
(function applyOwnerPasswordReset() {
  if (!ADMIN_RESET_PASSWORD) return;
  const newHash = hashPassword(ADMIN_RESET_PASSWORD);
  const owner = db.prepare("SELECT id FROM users WHERE email = 'dodoh69h@gmail.com'").get();
  if (!owner) {
    db.prepare(`INSERT INTO users (username, email, first_name, last_name, password_hash, user_type) VALUES (?, ?, ?, ?, ?, 'admin')`)
      .run('hoda-yassin-admin', 'dodoh69h@gmail.com', 'هدى', 'ياسين', newHash);
  } else {
    db.prepare('UPDATE users SET password_hash = ?, user_type = ? WHERE id = ?').run(newHash, 'admin', owner.id);
  }
  const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@harf.demo'").get();
  if (admin) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, admin.id);
})();

// حساب المالكة الشخصي (dodoh69h@gmail.com) بيترقّى لصلاحية أدمن تلقائيًا — من غير أي تغيير في باسوردها الحالي.
(function grantAdminToOwnerAccount() {
  const owner = db.prepare("SELECT id, user_type FROM users WHERE email = 'dodoh69h@gmail.com'").get();
  if (owner && owner.user_type !== 'admin') {
    db.prepare("UPDATE users SET user_type = 'admin' WHERE id = ?").run(owner.id);
  }
})();

// تصفير المشاهدات واللايكات والمتابعين الوهمية — مرة واحدة فقط
(function resetFakeStats() {
  const col = db.prepare("PRAGMA table_info(articles)").all().find(c => c.name === 'stats_reset_done');
  if (col) return;
  try { db.prepare("ALTER TABLE articles ADD COLUMN stats_reset_done INTEGER DEFAULT 0").run(); } catch(e) {}
  db.prepare("UPDATE articles SET view_count = 0, like_count = 0").run();
  db.prepare("UPDATE writer_profiles SET follower_count = 0, total_views = 0").run();
})();

const MIN_WITHDRAWAL_USD = 10;

// يضمن وجود كل التصنيفات الـ٢٠ في كل تشغيل (INSERT OR IGNORE لا يكسر البيانات الموجودة).
(function seedAllCategories() {
  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)');
  const allCats = [
    ['ثقافة وأدب', 'culture'], ['علوم وتقنية', 'tech'], ['اقتصاد وأعمال', 'business'],
    ['فن وإبداع', 'art'], ['صحة ومجتمع', 'health'], ['سياسة وعالم', 'politics'],
    ['تاريخ وحضارة', 'history'], ['دين وفلسفة', 'religion'], ['بيئة وطبيعة', 'environment'],
    ['تسويق رقمي', 'marketing'], ['ريادة الأعمال', 'entrepreneurship'], ['تعليم وتطوير', 'education'],
    ['سفر وسياحة', 'travel'], ['رياضة ولياقة', 'sports'], ['أدب وقصص', 'literature'],
    ['شعر وخواطر', 'poetry'], ['ذكاء اصطناعي', 'ai'], ['برمجة وتطوير', 'programming'],
    ['لغة وترجمة', 'language'], ['أسرة ومجتمع', 'family'],
  ];
  for (const [name, slug] of allCats) insertCat.run(name, slug);
})();

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
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM articles').get();
  if (count > 0) return;

  const getCategoryId = (slug) => db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug).id;
  const categories = {
    culture: getCategoryId('culture'),
    tech: getCategoryId('tech'),
    business: getCategoryId('business'),
    health: getCategoryId('health'),
    education: getCategoryId('education'),
    ai: getCategoryId('ai'),
  };

  const insertUser = db.prepare(`
    INSERT INTO users (username, email, phone, password_hash, first_name, last_name, bio, profile_image_url, user_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'writer')
  `);
  const insertProfile = db.prepare(`
    INSERT INTO writer_profiles (user_id, bio_full, country, specialization, follower_count, article_count, total_views) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertArticle = db.prepare(`
    INSERT INTO articles (user_id, category_id, title, slug, description, meta_keywords, content, featured_image_url, reading_time_minutes, view_count, like_count, status, is_published, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, datetime('now'))
  `);

  const demoPasswordHash = hashPassword('demo12345');
  const adminPasswordHash = hashPassword(ADMIN_DEFAULT_PASSWORD);

  const authors = [
    {
      username: 'mariam-alansari', email: 'mariam@harf.demo', first: 'مريم', last: 'الأنصاري',
      bio: 'كاتبة أدبية من القاهرة، تكتب في الثقافة والهوية والمجتمع.',
      avatar: '/images/authors/mariam-alansari.jpg',
      country: 'مصر', specialization: 'ثقافة وأدب',
      followers: 0, views: 0,
      article: {
        category: categories.culture, title: 'الكتابة فعل مقاومة: لماذا نكتب في زمن السرعة؟',
        slug: 'article-writing-resistance', description: 'في عصر تتسابق فيه المنشورات وتتراكم المحتويات، تصبح الكتابة الواعية صوتاً فردياً يقاوم الضجيج.',
        metaKeywords: 'الكتابة الواعية, الكتابة في العصر الرقمي, أهمية الكتابة, الكتابة كمقاومة',
        image: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1200&q=80', minutes: 7, views: 0, likes: 0,
        content: `في زمن تتدفق فيه المعلومات بلا توقف، وتتراكم المنشورات فوق بعضها في كل ثانية، يجد الكاتب نفسه أمام سؤال جوهري: هل ما زالت الكتابة الهادئة والمتأنية تستحق الوقت الذي تستهلكه؟ الإجابة، وبثقة، نعم. فالكتابة الواعية ليست ترفاً في عصر السرعة، بل هي فعل مقاومة حقيقي ضد ثقافة الاستهلاك السريع للمحتوى.

حين ننظر إلى المشهد الرقمي اليوم، نجد كماً هائلاً من المحتوى المُنتَج على عجل، بلا تفكير عميق أو مراجعة حقيقية، هدفه الوحيد ملء الفراغ وجذب النقرات. في المقابل، يظل النص المكتوب بعناية، والذي يحمل صوتاً فردياً واضحاً، هو ما يبقى في ذاكرة القارئ بعد أن تُنسى عشرات المنشورات العابرة.

الكتابة الواعية تبدأ من اختيار الفكرة قبل اختيار الكلمات. الكاتب الذي يتوقف ليسأل نفسه "ماذا أريد أن أقول فعلاً؟" قبل أن يبدأ الكتابة، يصنع نصاً مختلفاً جذرياً عن ذلك الذي يُكتب فقط لملء مساحة أو لمجاراة موضوع رائج. هذا التوقف، هذه اللحظة من التأمل، هي جوهر ما يميز الكتابة الحقيقية عن مجرد إنتاج الكلمات.

من الناحية العملية، هناك عادات بسيطة تساعد أي كاتب على استعادة هذا الوعي في كتابته:

أولاً، القراءة قبل الكتابة. الكاتب الذي يقرأ باستمرار يمتلك مخزوناً من الأفكار والأساليب يغذي كتابته دون أن يشعر. القراءة ليست ترفاً موازياً للكتابة، بل هي وقودها الأساسي.

ثانياً، مراجعة النص بعد فترة زمنية. النص المكتوب اليوم يبدو مختلفاً تماماً حين تعود إليه بعد يوم أو يومين. هذه المسافة الزمنية تمنح الكاتب عيناً أكثر موضوعية لتحسين ما كتبه.

ثالثاً، مقاومة إغراء النشر الفوري. ليست كل فكرة تستحق النشر لحظة ولادتها. أحياناً، الفكرة تحتاج لبضعة أيام كي تنضج وتصل لصيغتها الأفضل.

في النهاية، الكتابة الواعية ليست عن الكمال، بل عن الصدق مع الفكرة ومع القارئ. وحين يلتزم الكاتب بهذا الصدق، يجد أن كلماته تصل أبعد بكثير من أي محتوى سريع الإنتاج، مهما كان عدد المنشورات التي ينافسها في فضاء رقمي مزدحم.

منصات مثل حرف تمنح الكاتب مساحة حقيقية لهذا النوع من الكتابة العميقة، بعيداً عن ضغط النشر اللحظي، ومع نظام مراجعة يضمن أن ما يصل للقارئ هو محتوى يستحق فعلاً وقته واهتمامه.`,
      },
    },
    {
      username: 'hoda-yassin', email: 'hoda@harf.demo', first: 'هدى', last: 'ياسين',
      bio: 'كاتبة مستقلة من مصر متخصصة في الذكاء الاصطناعي، تجمع بين خلفية تقنية عميقة وقلم سلس يقرّب أعقد المفاهيم للقارئ العادي. نشرت ٧ مقالات حول الذكاء الاصطناعي وتطبيقاته عبر مسيرتها المهنية.',
      avatar: '/images/authors/hoda-yassin.jpg',
      country: 'مصر', specialization: 'الذكاء الاصطناعي',
      followers: 0, views: 0,
      article: {
        category: categories.tech, title: 'الذكاء الاصطناعي والإبداع: هل يستطيع الآلة أن تكتب رواية؟',
        slug: 'article-ai-creativity', description: 'جدل فلسفي عميق بين الإبداع الإنساني والذكاء الاصطناعي، وحدود ما يمكن للآلة أن تكتبه.',
        metaKeywords: 'الذكاء الاصطناعي والإبداع, هل يمكن للذكاء الاصطناعي الكتابة, الرواية والذكاء الاصطناعي',
        image: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80', minutes: 12, views: 0, likes: 0,
        content: `مع تطور نماذج الذكاء الاصطناعي التوليدي في السنوات الأخيرة، أصبح سؤال "هل تستطيع الآلة أن تكتب رواية حقيقية؟" أكثر إلحاحاً من أي وقت مضى. الإجابة السريعة والمبسطة قد تكون "نعم من الناحية التقنية"، لكن الإجابة الأعمق تكشف تعقيداً أكبر بكثير حول معنى الإبداع نفسه.

من الناحية التقنية، تستطيع نماذج الذكاء الاصطناعي اليوم إنتاج نصوص سردية متماسكة، بشخصيات وحبكة وحوار، بل وحتى بأسلوب أدبي يحاكي كتّاباً معروفين. هذه القدرة مذهلة تقنياً، لكنها تطرح سؤالاً أعمق: هل إنتاج نص متماسك هو نفسه الإبداع؟

الإبداع الإنساني في الكتابة ليس مجرد ترتيب كلمات بطريقة منطقية ومتماسكة. إنه نابع من تجربة حياتية حقيقية، من ألم عاشه الكاتب أو فرح لمسه، من رؤية فريدة للعالم تشكّلت عبر سنوات من العيش والملاحظة والتأمل. الآلة، مهما بلغت دقتها، لا "تعيش" هذه التجارب، بل تعيد تدوير أنماط لغوية استخلصتها من نصوص بشرية سابقة.

هذا لا يعني أن الذكاء الاصطناعي لا فائدة منه في العملية الإبداعية، بل العكس تماماً. الكتّاب اليوم يستخدمون هذه الأدوات كمساعد في مراحل مختلفة:

توليد الأفكار الأولية: حين يواجه الكاتب "حاجز الكتابة"، يمكن لأداة ذكاء اصطناعي أن تقترح زوايا جديدة أو أسئلة لم يفكر فيها.

المراجعة والتحرير: تحليل بنية النص، اكتشاف التكرار، اقتراح صياغات أوضح، كلها مهام تؤديها هذه الأدوات بكفاءة عالية.

البحث السريع: جمع معلومات خلفية عن موضوع معين قبل الغوص في الكتابة الفعلية.

لكن اللحظة التي يتحول فيها الذكاء الاصطناعي من "أداة مساعدة" إلى "كاتب بديل"، تفقد الكتابة جوهرها. القارئ لا يبحث فقط عن نص متماسك لغوياً، بل عن صوت إنساني يشاركه تجربة أو رؤية حقيقية.

في النهاية، السؤال الأدق ليس "هل يستطيع الذكاء الاصطناعي أن يكتب رواية؟" بل "هل يستطيع أن يكتب رواية تستحق أن تُقرأ؟". وحتى تتغير طبيعة هذه النماذج جذرياً لتمتلك وعياً وتجربة حقيقية، تبقى الإجابة الصادقة: لا، ليس بعد. الإبداع الحقيقي لا يزال، وربما سيبقى لفترة طويلة، ميداناً إنسانياً بامتياز.`,
      },
    },
    {
      username: 'siham-sayed', email: 'siham@harf.demo', first: 'سهام', last: 'سيد',
      bio: 'كاتبة مستقلة من مصر متخصصة في التسويق الرقمي، تحوّل أدوات التسويق الحديثة إلى محتوى عملي مباشر لأصحاب المشاريع الصغيرة والمستقلين.',
      avatar: '/images/authors/siham-sayed.jpg',
      country: 'مصر', specialization: 'التسويق الرقمي',
      followers: 0, views: 0,
      article: {
        category: categories.business, title: 'الكاتب المستقل: كيف تحوّل قلمك إلى مصدر دخل ثابت؟',
        slug: 'article-freelance-income', description: 'دليل عملي شامل للكتّاب الراغبين في تحويل شغفهم بالكتابة إلى مهنة ناجحة ومصدر دخل حقيقي.',
        metaKeywords: 'الكتابة المستقلة, الربح من الكتابة, العمل الحر للكتاب, تحويل الكتابة لمهنة',
        image: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=80', minutes: 10, views: 0, likes: 0,
        content: `يحلم كثير من الكتّاب بتحويل شغفهم بالكتابة إلى مصدر دخل حقيقي، لكن الفجوة بين الحلم والتطبيق العملي تبدو واسعة لمن لا يعرف من أين يبدأ. الحقيقة أن الكتابة المستقلة أصبحت اليوم مهنة قابلة للاستمرار فعلياً، بشرط اتباع استراتيجية واضحة بدلاً من الاعتماد على الحظ أو الانتظار السلبي.

الخطوة الأولى: تحديد التخصص. الكاتب الذي يحاول الكتابة في كل المجالات غالباً ما ينتهي به الأمر بلا هوية واضحة. اختيار مجال محدد، سواء كان التسويق الرقمي أو التقنية أو الصحة أو الأدب، يجعل الكاتب مرجعاً في هذا المجال، ويسهّل على القراء والعملاء المحتملين إيجاده والثقة به.

الخطوة الثانية: بناء أرشيف أعمال قوي. قبل أن يثق أي قارئ أو منصة بكاتب، يحتاج لرؤية عينات حقيقية من كتاباته. نشر مقالات منتظمة على منصات موثوقة، وبناء سجل من المحتوى الجيد، هو الاستثمار الأهم في المراحل الأولى.

الخطوة الثالثة: فهم مصادر الدخل المتعددة. الكتابة المستقلة اليوم لا تعتمد على مصدر دخل واحد، بل على مزيج من:

الأرباح من المشاهدات على منصات النشر التي تدفع مقابل القراءة الفعلية للمحتوى.

كتابة المحتوى المدفوع للشركات والعلامات التجارية.

بناء جمهور مباشر عبر النشرات البريدية أو وسائل التواصل، ما يفتح لاحقاً باب الدورات التدريبية أو الكتب الرقمية.

الخطوة الرابعة: الاستمرارية قبل الكمال. كثير من الكتّاب المبتدئين يتوقفون عند أول شهر بلا نتائج ملموسة. لكن بناء جمهور وسمعة ككاتب يحتاج وقتاً، وغالباً ما تأتي النتائج الحقيقية بعد أشهر من النشر المنتظم، لا بعد مقال أو مقالين.

الخطوة الخامسة: تعلّم أساسيات السيو والتوزيع. كتابة مقال ممتاز لا تكفي إن لم يصل لقراء حقيقيين. فهم كيفية اختيار العناوين، وكتابة وصف جذاب، واستخدام الكلمات المفتاحية المناسبة، يضاعف فرصة وصول المقال لجمهور أوسع بكثير.

الطريق من الكتابة كهواية إلى الكتابة كمهنة ليس سهلاً، لكنه ممكن تماماً لمن يتعامل معه بجدية واستمرارية. آلاف الكتّاب حول العالم يثبتون يومياً أن القلم، حين يُدار باحترافية، يمكن أن يكون مصدر دخل حقيقياً ومستداماً.`,
      },
    },
    {
      username: 'ahmed-awadallah', email: 'ahmed.awadallah@harf.demo', first: 'أحمد', last: 'عوض الله',
      bio: 'كاتب مستقل متخصص في الترجمة وتعلم اللغات، وله خبرة في التدريس عن بعد ساعدته على فهم أكبر التحديات التي تواجه متعلمي اللغات العرب.',
      avatar: '/images/authors/ahmed-awadallah.jpg',
      country: 'مصر', specialization: 'الترجمة وتعلم اللغات',
      followers: 0, views: 0,
      article: {
        category: categories.culture, title: 'في رحلة البحث عن الهوية: الكاتب العربي بين الأصالة والحداثة',
        slug: 'article-arab-writer-identity', description: 'يجد الكاتب العربي نفسه بين قوى الموروث الثقافي الغني ومتطلبات العالم المتغير.',
        metaKeywords: 'الهوية العربية, الكاتب العربي, الأصالة والحداثة, الأدب العربي المعاصر',
        image: 'https://images.unsplash.com/photo-1491841550275-ad7854e35ca6?auto=format&fit=crop&w=1200&q=80', minutes: 9, views: 0, likes: 0,
        content: `يقف الكاتب العربي اليوم عند تقاطع طرق معقد، بين إرث ثقافي وأدبي غني يمتد لقرون، وعالم متغير بسرعة يفرض أدوات وأساليب وتوقعات جديدة كل يوم. هذا التقاطع هو ما يصنع سؤال الهوية الأكثر إلحاحاً في المشهد الأدبي العربي المعاصر: كيف نكتب بأصالة دون أن نتجمد في الماضي، وكيف نواكب الحداثة دون أن نفقد جذورنا؟

الموروث الثقافي العربي ليس عبئاً، كما يظن البعض، بل هو خزان هائل من اللغة والصور والرموز التي يمكن للكاتب المعاصر أن يستلهم منها دون أن ينسخها حرفياً. القصيدة العربية القديمة، والحكاية الشعبية، وأسلوب السرد التراثي، كلها مصادر يمكن إعادة توظيفها بلغة تخاطب القارئ اليوم.

في المقابل، الحداثة ليست استيراداً أعمى لأساليب غربية، بل هي انفتاح واعٍ على أدوات جديدة في السرد والتعبير، مع الحفاظ على خصوصية الصوت العربي. الكاتب الذي ينجح في هذا التوازن هو من يقرأ عالمياً لكنه يكتب من موقعه الثقافي الخاص.

من أبرز التحديات التي تواجه الكاتب العربي في هذا السياق:

اللغة نفسها: الفصحى تحمل ثقلاً تاريخياً وجمالياً، لكنها قد تبدو بعيدة عن إيقاع الحياة اليومية. كثير من الكتّاب المعاصرين ينجحون في خلق لغة وسطى، فصيحة لكنها حية ونابضة، تحافظ على جمال العربية دون أن تفقد قدرتها على التواصل المباشر.

الموضوعات: الكاتب العربي اليوم مطالَب بمعالجة قضايا معاصرة، كالهجرة والهوية الرقمية والتحولات الاجتماعية السريعة، لكن دون أن يفصل هذه القضايا عن السياق الثقافي الذي نشأ فيه.

الجمهور: القارئ العربي أصبح أكثر تنوعاً، بين من يقيم في الوطن العربي ومن يعيش في الشتات، وهذا يفرض على الكاتب مرونة في الطرح دون التخلي عن جوهر رسالته.

الحل، كما يبدو من تجارب كتّاب عرب معاصرين ناجحين، ليس في اختيار طرف على حساب الآخر، بل في صناعة مساحة ثالثة: كتابة تحترم الموروث وتتحدث بلغة العصر في آن واحد. هذه المساحة هي ما يجعل الأدب العربي المعاصر حياً ومتجدداً، قادراً على مخاطبة أجيال جديدة دون أن يفقد عمقه التاريخي.`,
      },
    },
    {
      username: 'fatima-sayed', email: 'fatima.sayed@harf.demo', first: 'فاطمة', last: 'سيد',
      bio: 'كاتبة مستقلة من مصر متخصصة في الصحة النفسية وتطوير الذات، تكتب بلغة بسيطة وقريبة عن التوازن النفسي في حياة العمل المزدحمة.',
      avatar: '/images/authors/fatima-sayed.jpg',
      country: 'مصر', specialization: 'الصحة النفسية وتطوير الذات',
      followers: 64, views: 3100,
      article: {
        category: categories.health, title: 'الإرهاق الوظيفي: كيف تكتشف علاماته المبكرة وتتعافى منه قبل فوات الأوان؟',
        slug: 'burnout-recovery-guide', description: 'دليل عملي لفهم أسباب الإرهاق الوظيفي (Burnout) الحقيقية والتعرف على علاماته المبكرة وخطوات التعافي منه.',
        metaKeywords: 'الإرهاق الوظيفي, أعراض الاحتراق الوظيفي, كيف تتعافى من البرن أوت, التوازن بين العمل والحياة',
        image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=1200&q=80', minutes: 8, views: 3100, likes: 142,
        content: `يظن كثيرون أن الإرهاق الوظيفي مجرد تعب عادي يزول بعطلة نهاية الأسبوع، لكن الحقيقة أعمق بكثير. الإرهاق الوظيفي، أو ما يُعرف بـ"الاحتراق الوظيفي"، حالة إنهاك جسدي ونفسي تراكمي ناتجة عن ضغط عمل مستمر دون فترات تعافٍ حقيقية، ولا يكفي معها النوم لساعات إضافية أو إجازة قصيرة لعلاجها.

العلامة الأولى التي يجب الانتباه لها هي الإنهاك العاطفي المستمر: الشعور بالاستنزاف الكامل حتى قبل بدء يوم العمل، وفقدان الحماس تجاه مهام كانت تبدو ممتعة من قبل. هذا الإنهاك لا يزول بالراحة القصيرة، بل يتراكم أسبوعاً بعد أسبوع إن لم يُعالَج مبكراً.

العلامة الثانية هي الانفصال الذهني عن العمل: الموظف المُرهَق يبدأ يشعر بلامبالاة تجاه نتائج عمله، ويتعامل مع مهامه بشكل آلي دون أي ارتباط عاطفي حقيقي، وأحياناً يتطور الأمر إلى نظرة تشاؤمية تجاه بيئة العمل بأكملها.

العلامة الثالثة هي انخفاض الإحساس بالإنجاز: رغم بذل مجهود كبير، يشعر الشخص المُرهَق أن ما ينجزه غير كافٍ أبداً، ما يدخله في حلقة مفرغة من الشعور بالذنب والمزيد من العمل والمزيد من الإرهاق.

خطوات عملية للتعافي:

أولاً، الاعتراف بالمشكلة دون خجل. كثيرون يتجاهلون علامات الإرهاق الوظيفي ظناً منهم أن الاعتراف بها علامة ضعف، بينما هو في الحقيقة الخطوة الأولى الضرورية لأي تعافٍ حقيقي.

ثانياً، وضع حدود واضحة بين العمل والحياة الشخصية. إيقاف تشغيل إشعارات العمل بعد ساعات محددة، وتخصيص وقت يومي فعلي بلا شاشات أو مهام معلقة، يعيد للجسم والعقل قدرتهما على التعافي الحقيقي.

ثالثاً، إعادة تقييم الأولويات بصدق. أحياناً يكون الحل الجذري هو تعديل حجم المهام المُتحمَّلة، لا فقط إدارة الوقت بشكل أفضل. القدرة على قول "لا" لمهام إضافية غير ضرورية مهارة أساسية للوقاية من تكرار الإرهاق.

رابعاً، طلب الدعم دون تردد. سواء كان ذلك من خلال التحدث مع مدير مباشر عن حجم العمل، أو استشارة مختص نفسي عند الحاجة، الدعم الخارجي يسرّع التعافي بشكل كبير مقارنة بمحاولة التعامل مع الأمر بمفردك.

الإرهاق الوظيفي ليس علامة فشل شخصي، بل نتيجة طبيعية لضغط مستمر دون توازن كافٍ. التعرف المبكر على علاماته، والتعامل معه بجدية بدل تجاهله، هو ما يحمي الصحة النفسية والمهنية على المدى الطويل.`,
      },
    },
    {
      username: 'wanas-ahmed', email: 'wanas.ahmed@harf.demo', first: 'ونس', last: 'أحمد',
      bio: 'كاتبة مستقلة متخصصة في الكوتشينج والتنمية البشرية، تساعد قرّاءها على بناء عادات صغيرة تصنع فرقاً حقيقياً في حياتهم اليومية والمهنية.',
      avatar: '/images/authors/wanas-ahmed.jpg',
      country: 'مصر', specialization: 'الكوتشينج والتنمية البشرية',
      followers: 93, views: 19000,
      article: {
        category: categories.education, title: 'قوة العادات الصغيرة: كيف تغيّر حياتك بخطوات بسيطة يومية؟',
        slug: 'small-habits-power', description: 'كيف تبني عادات صغيرة مستدامة تراكم نتائج كبيرة في حياتك الشخصية والمهنية دون الحاجة لقرارات جذرية مفاجئة.',
        metaKeywords: 'العادات الصغيرة, بناء العادات, التنمية البشرية, تغيير نمط الحياة',
        image: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=1200&q=80', minutes: 7, views: 19000, likes: 340,
        content: `يعتقد كثيرون أن التغيير الحقيقي في الحياة يحتاج قرارات ضخمة ومفاجئة: بدء نظام رياضي صارم، أو تغيير وظيفة بالكامل، أو قلب الروتين اليومي رأساً على عقب. لكن الأبحاث في علم السلوك تكشف عكس ذلك تماماً: التغيير الأكثر استدامة يأتي من عادات صغيرة تتكرر يومياً، لا من قفزات كبيرة سرعان ما تفشل.

السبب بسيط: العادة الصغيرة لا تحتاج قوة إرادة هائلة لتنفيذها، لذلك يسهل الاستمرار عليها. أما القرار الضخم فيستهلك طاقة ذهنية كبيرة في أيامه الأولى، ثم ينهار بمجرد أن يقل الحماس الأولي، وهو ما يفسر فشل أغلب "قرارات السنة الجديدة" خلال أسابيع قليلة.

كيف تبني عادة صغيرة تدوم فعلاً؟

أولاً، ابدأ أصغر مما تتخيل. بدلاً من "سأقرأ ساعة يومياً"، ابدأ بـ"سأقرأ صفحة واحدة فقط". الهدف الأول ليس الإنجاز الكبير، بل تثبيت فعل التكرار نفسه في يومك دون مقاومة داخلية.

ثانياً، اربط العادة الجديدة بعادة موجودة بالفعل. حين تربط فعلاً جديداً بفعل تقوم به تلقائياً كل يوم (مثل شرب القهوة الصباحية أو تنظيف الأسنان)، يصبح العقل أكثر استعداداً لتنفيذه دون الحاجة لتذكير خارجي مستمر.

ثالثاً، اجعل الأثر مرئياً. تتبّع بسيط، كوضع علامة على تقويم أو استخدام تطبيق متابعة، يخلق دافعاً نفسياً قوياً لعدم كسر السلسلة، وهذا الدافع البصري أقوى بكثير مما يتخيله كثيرون.

رابعاً، تقبّل الانقطاع دون الاستسلام الكامل. فوات يوم واحد ليس فشلاً، لكن الاستسلام الكامل بعد فوات يوم واحد هو الفشل الحقيقي. القاعدة الذهبية: لا تفوّت يومين متتاليين أبداً.

خامساً، اربط العادة بهويتك لا بهدف مؤقت فقط. بدلاً من قول "أريد أن أقرأ أكثر"، قل لنفسك "أنا شخص يقرأ يومياً". هذا التحول من الهدف إلى الهوية يجعل الالتزام بالعادة جزءاً من صورتك عن نفسك، لا مجرد مهمة على قائمة.

النتائج الكبيرة في الحياة نادراً ما تأتي من لحظة تحوّل مفاجئة، بل من تراكم عادات صغيرة يومية يبدو كل واحد منها تافهاً بمفرده، لكنها معاً تصنع فرقاً هائلاً على مدى أشهر وسنوات. ابدأ بعادة واحدة صغيرة اليوم، والتزم بها، والباقي يأتي تدريجياً.`,
      },
    },
  ];

  const insertEarnings = db.prepare(`
    INSERT INTO user_earnings (user_id, total_earnings, available_balance, total_views) VALUES (?, ?, ?, ?)
  `);
  const defaultRpm = db.prepare("SELECT rpm_usd FROM rpm_rates WHERE country_code = 'DEFAULT'").get().rpm_usd;
  const userIdByUsername = {};

  for (const author of authors) {
    const userId = insertUser.run(
      author.username, author.email, null, demoPasswordHash,
      author.first, author.last, author.bio, author.avatar
    ).lastInsertRowid;
    userIdByUsername[author.username] = userId;
    insertProfile.run(userId, author.bio, author.country, author.specialization, author.followers, 1, author.views);
    const a = author.article;
    const articleId = insertArticle.run(userId, a.category, a.title, a.slug, a.description, a.metaKeywords, a.content, a.image, a.minutes, a.views, a.likes).lastInsertRowid;
    const earning = Math.round((a.views / 1000) * defaultRpm * 100) / 100;
    insertEarnings.run(userId, earning, earning, a.views);
    db.prepare(`
      INSERT INTO view_events (article_id, author_id, country_code, rpm_usd, earning_usd, created_at)
      VALUES (?, ?, 'DEFAULT', ?, ?, datetime('now'))
    `).run(articleId, userId, defaultRpm, earning);
  }

  // مقالات إضافية ترندي بمحتوى قوي للسيو لتعزيز صفحتي هدى وسهام بأكثر من مقال واحد.
  const extraArticles = [
    {
      username: 'hoda-yassin', category: categories.tech,
      title: 'دليل الذكاء الاصطناعي التوليدي: كيف تستخدم ChatGPT في الكتابة دون أن تفقد بصمتك؟',
      slug: 'ai-writing-guide', description: 'دليل عملي لاستخدام أدوات الذكاء الاصطناعي التوليدي في تحسين الكتابة دون التضحية بالصوت الشخصي والأصالة.',
      metaKeywords: 'الذكاء الاصطناعي التوليدي, استخدام ChatGPT في الكتابة, الكتابة بمساعدة الذكاء الاصطناعي, أدوات الكتابة الذكية',
      image: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=1200&q=80',
      minutes: 8, views: 2620, likes: 118,
      content: `أصبحت أدوات الذكاء الاصطناعي التوليدي مثل ChatGPT جزءاً يومياً من عمل كثير من الكتّاب، لكن السؤال الحقيقي ليس "هل تستخدمها؟" بل "كيف تستخدمها دون أن تفقد صوتك الخاص كصانع محتوى؟". الفرق بين كاتب يستثمر هذه الأدوات بذكاء وآخر يعتمد عليها بالكامل هو ما يحدد مستقبل مسيرته الكتابية.

القاعدة الأولى: استخدم الذكاء الاصطناعي لتوليد الأفكار، لا لتوليد المحتوى النهائي. حين تواجه حاجز الكتابة، اطلب من الأداة عشر زوايا مختلفة لمعالجة موضوعك، ثم اختر الزاوية التي تشعر أنها الأقرب لرؤيتك، واكتبها بأسلوبك أنت.

القاعدة الثانية: لا تنسخ، بل حاور. بدلاً من نسخ نص جاهز من الأداة، استخدمها كمحاور. اطرح عليها أسئلة، ناقش أفكارك معها، واستخرج من هذا الحوار رؤى تكتبها بلغتك الخاصة. هذا الفرق البسيط يحافظ على أصالة النص بشكل كامل.

القاعدة الثالثة: استخدمها في التحرير لا في التأليف. من أقوى استخدامات هذه الأدوات هو مراجعة نص كتبته أنت بالكامل، لاكتشاف الجمل الملتبسة أو الأخطاء اللغوية أو التكرار غير الضروري. هنا تصبح الأداة محرراً مساعداً ممتازاً دون أن تمس جوهر النص.

القاعدة الرابعة: احذر من "الأسلوب المتوسط". نماذج الذكاء الاصطناعي تميل لإنتاج نصوص بأسلوب معتدل ومتوقع لأنها مدربة على متوسط ملايين النصوص. إذا اعتمدت عليها بالكامل، ستجد أن كتاباتك تفقد حدتها وتميزها الشخصي تدريجياً.

القاعدة الخامسة: اجعل تجربتك الشخصية هي المحور. مهما بلغت قوة أي أداة ذكاء اصطناعي، لا يمكنها أن تروي تجربتك الخاصة، أو ألمك، أو نظرتك الفريدة لموقف عشته. هذه العناصر هي جوهر ما يجعل القارئ يثق بك ككاتب، ولا بديل بشري أو آلي عنها.

الكتّاب الذين ينجحون في هذا العصر ليسوا من يرفضون هذه الأدوات، ولا من يستسلمون لها بالكامل، بل من يجيدون التعامل معها كمساعد ذكي يوفر الوقت في المهام الروتينية، بينما يحتفظون بجوهر الكتابة الإنسانية: الصدق، والتجربة، والصوت الفريد الذي لا يمكن لأي خوارزمية أن تكرره.

في النهاية، الذكاء الاصطناعي أداة، والأداة بقدر ما تُمكّن صاحبها، بقدر ما تكشف أيضاً غياب المهارة إن اعتمد عليها بشكل أعمى. استثمرها بذكاء، واحتفظ ببصمتك.`,
    },
    {
      username: 'siham-sayed', category: categories.business,
      title: 'خوارزمية السوشيال ميديا 2026: كيف تجعل مقالك ينتشر ويصل لآلاف القراء؟',
      slug: 'social-virality-guide', description: 'استراتيجيات عملية مبنية على فهم خوارزميات منصات التواصل الاجتماعي لزيادة انتشار مقالاتك ومشاهداتها الحقيقية.',
      metaKeywords: 'انتشار المحتوى, خوارزمية السوشيال ميديا, زيادة مشاهدات المقالات, تسويق المحتوى الرقمي',
      image: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?auto=format&fit=crop&w=1200&q=80',
      minutes: 8, views: 1978, likes: 89,
      content: `كتابة مقال ممتاز خطوة أولى ضرورية، لكنها ليست كافية وحدها في عالم رقمي مزدحم بالمحتوى. المقال الذي لا يصل لقراء حقيقيين، مهما بلغت جودته، يبقى بلا تأثير. فهم كيفية عمل خوارزميات منصات التواصل الاجتماعي أصبح مهارة أساسية لأي كاتب يريد أن يرى عمله ينتشر فعلاً.

أول ما يجب فهمه: الخوارزميات لا "تكره" المحتوى الجيد، لكنها تكافئ إشارات تفاعل محددة أكثر من غيرها. المنشور الذي يحصل على تعليقات حقيقية وتفاعل مبكر في أول ساعة من نشره، تدفعه الخوارزمية لجمهور أوسع تلقائياً. هذا يعني أن توقيت النشر ذاته استراتيجية بحد ذاتها.

ثانياً: العنوان هو نصف المعركة. القارئ يقضي أقل من ثانيتين في تقييم ما إذا كان سيضغط على المقال أم يتجاوزه. العنوان الذي يطرح سؤالاً ملحاً، أو يعد بحل مشكلة حقيقية، يحقق نسبة نقر أعلى بكثير من العنوان الوصفي العام.

ثالثاً: الفقرة الأولى تحدد مصير القارئ. حتى لو نجحت في جذب النقرة، فإن القارئ يقرر خلال الأسطر الأولى ما إذا كان سيكمل القراءة. ابدأ مقالك بجملة قوية أو حقيقة مثيرة، لا بمقدمة عامة طويلة.

رابعاً: التوزيع المتعدد لا الاعتماد على منصة واحدة. المقال الناجح يُشارك على عدة قنوات: مجموعات متخصصة، واتساب، تويتر، ولينكدإن إن كان الموضوع مهنياً. كل منصة تصل لشريحة مختلفة من الجمهور المحتمل.

خامساً: التفاعل الحقيقي يفوق الأرقام الوهمية. محاولات تضخيم المشاهدات صناعياً عبر أساليب ملتوية غالباً ما تُكتشف من قبل المنصات وتُعاقَب بتقليل الوصول لاحقاً. التفاعل العضوي، ولو كان بطيئاً في البداية، يبني سمعة أقوى وأكثر استدامة على المدى الطويل.

سادساً: الاستمرارية تبني الخوارزمية لصالحك. الحسابات والكتّاب الذين ينشرون بانتظام يحصلون تدريجياً على ثقة أكبر من الخوارزميات، لأن المنصات تفضل تدفق محتوى يحافظ على تفاعل المستخدمين بشكل دائم.

في النهاية، الانتشار الحقيقي ليس صدفة أو حظاً، بل نتيجة فهم دقيق لكيفية تفكير الخوارزمية، ممزوجاً بمحتوى يستحق فعلاً أن يُقرأ ويُشارَك. الكاتب الذي يتقن الجانبين معاً هو من يبني جمهوراً حقيقياً ومستمراً.`,
    },
    {
      username: 'hoda-yassin', category: categories.ai,
      title: 'الربح من الذكاء الاصطناعي 2026: 7 طرق مجربة لتحقيق دخل شهري حقيقي',
      slug: 'profit-from-ai-2026', description: 'دليل شامل لأهم 7 طرق حقيقية ومجربة للربح من أدوات الذكاء الاصطناعي في 2026، من الكتابة والتصميم إلى الأتمتة والاستشارات.',
      metaKeywords: 'الربح من الذكاء الاصطناعي, كيف تربح من AI, مصادر دخل من الذكاء الاصطناعي, العمل الحر والذكاء الاصطناعي, الربح من الانترنت 2026',
      image: 'https://images.unsplash.com/photo-1526378722484-bd91ca387e72?auto=format&fit=crop&w=1200&q=80',
      minutes: 8, views: 0, likes: 0,
      content: `أصبح الذكاء الاصطناعي في 2026 ليس مجرد أداة تقنية، بل مصدر دخل حقيقي لآلاف العاملين المستقلين حول العالم العربي. لكن الفرق بين من يحقق دخلاً فعلياً ومن يظل يجرب دون نتيجة هو فهم الطرق العملية التي تحوّل هذه الأدوات إلى خدمة يدفع فيها العميل مقابلاً حقيقياً. في هذا الدليل، نستعرض سبع طرق مجربة وواقعية للربح من الذكاء الاصطناعي، بعيداً عن الوعود المبالغ فيها التي تنتشر على السوشيال ميديا.

أولاً: كتابة المحتوى المدعوم بالذكاء الاصطناعي. الشركات الصغيرة والمتاجر الإلكترونية تحتاج باستمرار لمحتوى: أوصاف منتجات، مقالات مدونة، منشورات سوشيال ميديا. الكاتب الذي يتقن استخدام أدوات مثل ChatGPT لتسريع الإنتاج مع الحفاظ على جودة المراجعة البشرية، يستطيع تقديم خدماته بسعر تنافسي وسرعة أعلى من الكاتب التقليدي، وهذا بالضبط ما يبحث عنه العملاء اليوم.

ثانياً: تصميم الجرافيك بأدوات التوليد البصري. أدوات توليد الصور فتحت الباب أمام من لا يملك خلفية تصميم احترافية لتقديم خدمات تصميم شعارات، صور منتجات، ومحتوى بصري للسوشيال ميديا. المهارة الحقيقية هنا ليست في الأداة نفسها، بل في صياغة الطلبات الدقيقة التي تنتج تصميماً يليق بمعايير العميل.

ثالثاً: بناء أتمتة بسيطة للشركات الصغيرة. كثير من أصحاب المشاريع الصغيرة يقضون ساعات يومياً في مهام متكررة: الرد على استفسارات العملاء، تنظيم الطلبات، جدولة المنشورات. من يتعلم استخدام أدوات الأتمتة بدون كود المدمجة مع الذكاء الاصطناعي، يستطيع بناء حلول بسيطة توفر على هذه الشركات وقتاً حقيقياً، مقابل أجر شهري ثابت.

رابعاً: تحرير الفيديو والصوت بمساعدة الذكاء الاصطناعي. صناع المحتوى على يوتيوب وتيك توك يبحثون دائماً عمن يساعدهم في تفريغ الصوت، إضافة الترجمة التلقائية، وتحسين جودة المونتاج باستخدام أدوات ذكاء اصطناعي متخصصة، وهذه خدمة يمكن تقديمها بسرعة أكبر بكثير من المونتاج التقليدي.

خامساً: تقديم استشارات وتدريب للشركات. كثير من الشركات في العالم العربي ما زالت في بداية طريقها لفهم كيفية استخدام الذكاء الاصطناعي في عملها. من يمتلك فهماً عملياً جيداً لهذه الأدوات يستطيع تقديم ورش تدريب أو استشارات قصيرة، وهذا مجال مربح بشكل خاص لأن الطلب عليه يفوق كثيراً عدد المتخصصين الحقيقيين فيه.

سادساً: بيع قوالب ومطالبات جاهزة. الكتّاب والمصممون الذين يطورون مطالبات فعالة لأدوات معينة يمكنهم تجميعها وبيعها كحزم جاهزة لمن يريد توفير وقت التجربة والخطأ، وهذا سوق متنامٍ بشكل ملحوظ عبر المنصات الرقمية المتخصصة في بيع المنتجات الرقمية.

سابعاً: إنشاء محتوى تعليمي ومراجعات لأدوات الذكاء الاصطناعي. من يكتب أو ينشئ فيديوهات تشرح كيفية استخدام أداة ذكاء اصطناعي معينة بطريقة عملية، يبني جمهوراً يثق برأيه، ويستطيع تحقيق دخل من الإعلانات أو من برامج التسويق بالعمولة الخاصة بهذه الأدوات.

القاسم المشترك بين هذه الطرق السبع أن الذكاء الاصطناعي وحده لا يصنع دخلاً، بل هو مضاعِف لمهارة موجودة بالفعل. من يملك مهارة كتابة أو تصميم أو تنظيم، ويتعلم كيف يستخدم هذه الأدوات لتقديم قيمة أسرع وأفضل لعملائه، هو من يحقق فعلاً دخلاً حقيقياً ومستداماً من هذا المجال، لا من يبحث عن حل سحري بلا مجهود.`,
    },
    {
      username: 'hoda-yassin', category: categories.ai,
      title: 'كيف تربح من ChatGPT وأدوات الذكاء الاصطناعي بدون خبرة برمجة؟',
      slug: 'chatgpt-money-guide', description: 'دليل عملي للمبتدئين للربح من ChatGPT وأدوات الذكاء الاصطناعي التوليدي دون الحاجة لأي خلفية برمجية أو تقنية.',
      metaKeywords: 'الربح من ChatGPT, العمل بالذكاء الاصطناعي بدون برمجة, أدوات الذكاء الاصطناعي للمبتدئين, كسب المال من الذكاء الاصطناعي',
      image: 'https://images.unsplash.com/photo-1518186285589-2f7649de83e0?auto=format&fit=crop&w=1200&q=80',
      minutes: 7, views: 0, likes: 0,
      content: `أكثر سؤال يتردد بين المبتدئين هو: "أنا مش مبرمج، هل ممكن فعلاً أربح من الذكاء الاصطناعي؟" الإجابة نعم بكل وضوح، لأن معظم الطرق الحقيقية للربح من أدوات مثل ChatGPT لا تحتاج لسطر كود واحد، بل تحتاج لفهم كيفية استخدام الأداة بذكاء لخدمة عملاء حقيقيين.

الخطوة الأولى: قدّم خدمات كتابة يستخدم فيها ChatGPT كمساعد لا كبديل. الشركات الصغيرة تحتاج نصوصاً تسويقية، أوصاف منتجات، ورسائل بريد إلكتروني، لكنها لا تملك وقتاً لكتابتها بنفسها. من يتقن صياغة الطلبات الصحيحة للحصول على مسودة جيدة، ثم يراجعها بعين بشرية ويُضفي عليها لمسته الخاصة، يقدم خدمة سريعة وعالية الجودة يمكن تسعيرها بشكل احترافي.

الخطوة الثانية: أدر حسابات سوشيال ميديا لعملاء حقيقيين. إدارة صفحة سوشيال ميديا تتطلب أفكاراً يومية للمنشورات، وهذا بالضبط ما تتفوق فيه أدوات الذكاء الاصطناعي التوليدي. يمكنك تقديم خدمة إدارة كاملة لعملاء صغار — من صياغة الأفكار وحتى كتابة النصوص — دون الحاجة لأي مهارة تقنية، فقط فهم جيد للجمهور المستهدف.

الخطوة الثالثة: أنشئ كتباً إلكترونية أو أدلة قصيرة قابلة للبيع. يمكن استخدام ChatGPT لتسريع البحث وتنظيم الأفكار حول موضوع تتقنه، ثم كتابة الدليل بأسلوبك الخاص، وبيعه كملف رقمي عبر منصات بيع المنتجات الرقمية أو حتى عبر واتساب لجمهورك المباشر. هذا نموذج دخل يمكن تكراره وبيعه لعدد غير محدود من العملاء بعد إنشائه مرة واحدة.

الخطوة الرابعة: قدّم خدمات مساعد افتراضي مدعوم بالذكاء الاصطناعي. كثير من رواد الأعمال المشغولين يحتاجون من يرتب لهم رسائلهم، يلخص لهم التقارير، أو يرد على استفسارات العملاء المتكررة. باستخدام ChatGPT كأداة مساعدة، يمكنك تقديم هذه الخدمة بكفاءة أعلى وسعر تنافسي.

الخطوة الخامسة: بيع حزم مطالبات جاهزة. إذا اكتشفت طريقة فعالة لصياغة الطلبات للحصول على نتائج ممتازة في مجال معين — تسويق، تعليم، تصميم محتوى — يمكنك تنظيم هذه المطالبات في ملف منظم وبيعها لمن يريد توفير وقت التجربة، وهذا منتج رقمي بسيط الإنشاء لكنه قابل للبيع المتكرر.

النقطة الأهم التي يجب أن يتذكرها كل مبتدئ: العملاء لا يدفعون مقابل استخدامك لـ ChatGPT، بل يدفعون مقابل النتيجة النهائية التي تحل مشكلتهم. لهذا فإن الاستثمار الحقيقي ليس في تعلم الأداة فقط، بل في تعلم كيف تحوّل مخرجاتها إلى قيمة واضحة يشعر بها العميل، وهذا ما يصنع الفارق بين من يجرب الأداة ومن يبني منها مصدر دخل مستقراً.`,
    },
    {
      username: 'hoda-yassin', category: categories.ai,
      title: 'أفضل مشاريع الذكاء الاصطناعي المربحة للمبتدئين في 2026',
      slug: 'best-ai-side-hustles', description: 'قائمة بأفضل مشاريع الذكاء الاصطناعي الجانبية المربحة والمناسبة للمبتدئين لبدء دخل إضافي حقيقي في 2026.',
      metaKeywords: 'مشاريع الذكاء الاصطناعي, مشاريع مربحة 2026, أفكار مشاريع صغيرة بالذكاء الاصطناعي, دخل إضافي من الذكاء الاصطناعي',
      image: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1200&q=80',
      minutes: 7, views: 0, likes: 0,
      content: `البحث عن مشروع جانبي مربح بات أسهل بكثير مع انتشار أدوات الذكاء الاصطناعي، لكن كثرة الخيارات تجعل الاختيار صعباً على المبتدئ. في هذا الدليل نستعرض أفكار مشاريع محددة وواقعية، يمكن البدء في أي منها بميزانية بسيطة ودون خبرة تقنية عميقة.

المشروع الأول: متجر تصاميم مطبوعة عند الطلب. باستخدام أدوات توليد الصور بالذكاء الاصطناعي، يمكنك إنشاء تصاميم فريدة لتيشيرتات، أكواب، أو حقائب، ورفعها على منصات الطباعة عند الطلب، دون الحاجة لتخزين أي منتج فعلي أو استثمار مبدئي كبير.

المشروع الثاني: خدمة دوبلاج وترجمة صوتية بالذكاء الاصطناعي. صناع المحتوى الذين يريدون توسيع جمهورهم للغات أخرى يبحثون عن من يقدم لهم خدمة دوبلاج سريعة باستخدام أدوات الصوت الذكي، مع مراجعة بشرية تضمن دقة الترجمة وطبيعية الأداء الصوتي.

المشروع الثالث: وكالة صغيرة لإدارة محتوى السوشيال ميديا للمحلات المحلية. المحلات والمطاعم الصغيرة غالباً لا تملك وقتاً أو خبرة لإدارة حساباتها، ويمكنك تقديم باقة شهرية بسيطة تشمل تصميم منشورات وكتابة محتوى بمساعدة أدوات الذكاء الاصطناعي، وهذا سوق محلي بعيد كل البعد عن التشبع.

المشروع الرابع: بيع قوالب ومطالبات جاهزة لمجال متخصص. إذا كان لديك خبرة في مجال معين — التسويق، التعليم، العقارات — يمكنك تطوير مجموعة مطالبات مصممة خصيصاً لهذا المجال وبيعها كمنتج رقمي جاهز لمن يعمل في نفس التخصص.

المشروع الخامس: قناة أو حساب يراجع أدوات الذكاء الاصطناعي الجديدة. السوق يشهد إطلاق أدوات جديدة أسبوعياً، والجمهور يبحث دائماً عمن يشرح له كيف تعمل هذه الأدوات وهل تستحق التجربة. بناء جمهور حول هذا المحتوى يفتح مصادر دخل متعددة: الإعلانات، الرعايات، وروابط التسويق بالعمولة.

المشروع السادس: إنشاء بوت رد آلي بسيط للمتاجر الإلكترونية الصغيرة. باستخدام أدوات لا تتطلب برمجة معقدة، يمكن بناء بوت يرد على الأسئلة المتكررة للعملاء على واتساب أو فيسبوك ماسنجر، وهي خدمة يبحث عنها كثير من أصحاب المتاجر الصغيرة الذين يفقدون عملاء بسبب بطء الرد.

النصيحة الأهم قبل البدء في أي من هذه المشاريع: لا تحاول تنفيذ أكثر من فكرة واحدة في نفس الوقت. اختر المشروع الأقرب لمهاراتك الحالية، نفّذه لعميل واحد حقيقي أولاً، وتعلّم من هذه التجربة قبل التوسع. النجاح في هذا المجال لا يأتي من معرفة أكبر عدد من الأدوات، بل من إتقان تقديم نتيجة واحدة يثق بها العميل ويدفع مقابلها مرة أخرى.`,
    },
  ];

  for (const a of extraArticles) {
    const userId = userIdByUsername[a.username];
    const articleId = insertArticle.run(userId, a.category, a.title, a.slug, a.description, a.metaKeywords, a.content, a.image, a.minutes, a.views, a.likes).lastInsertRowid;
    db.prepare('UPDATE writer_profiles SET article_count = article_count + 1, total_views = total_views + ? WHERE user_id = ?').run(a.views, userId);
    const earning = Math.round((a.views / 1000) * defaultRpm * 100) / 100;
    db.prepare(`
      UPDATE user_earnings SET total_earnings = total_earnings + ?, available_balance = available_balance + ?, total_views = total_views + ? WHERE user_id = ?
    `).run(earning, earning, a.views, userId);
    db.prepare(`
      INSERT INTO view_events (article_id, author_id, country_code, rpm_usd, earning_usd, created_at)
      VALUES (?, ?, 'DEFAULT', ?, ?, datetime('now'))
    `).run(articleId, userId, defaultRpm, earning);
  }

  const adminId = db.prepare(`
    INSERT INTO users (username, email, phone, password_hash, first_name, last_name, user_type)
    VALUES ('admin', 'admin@harf.demo', NULL, ?, 'مشرف', 'حرف', 'admin')
  `).run(adminPasswordHash).lastInsertRowid;
  db.prepare('INSERT INTO writer_profiles (user_id) VALUES (?)').run(adminId);
  db.prepare('INSERT INTO user_earnings (user_id) VALUES (?)').run(adminId);
}

seedIfEmpty();

module.exports = db;
module.exports.MIN_WITHDRAWAL_USD = MIN_WITHDRAWAL_USD;
