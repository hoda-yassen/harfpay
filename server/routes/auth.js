const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { hashPassword, verifyPassword } = require('../lib/password');
const { createSessionToken, MAX_AGE_MS } = require('../lib/session');
const { sendResetEmail } = require('../lib/mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// مقارنة الإيميلات في SQLite حساسة لحالة الأحرف افتراضيًا — لو المستخدم سجّل بحرف كبير وبعدين
// دخل بحرف صغير (زي ما بيحصل تلقائي على كيبورد الموبايل) هيفشل الدخول غلط. توحيد الحالة بيمنع ده.
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// حماية من محاولات تخمين كلمة المرور (Brute Force) — ١٠ محاولات كحد أقصى كل ١٥ دقيقة لكل IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة جداً، من فضلك حاولي مرة أخرى بعد قليل' },
});

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    bio: row.bio,
    avatar: row.profile_image_url,
    userType: row.user_type,
  };
}

function setSessionCookie(req, res, userId) {
  res.cookie('harf_session', createSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure, // يعتمد على X-Forwarded-Proto عبر trust proxy — يفعّل تلقائياً بمجرد النشر على HTTPS
    maxAge: MAX_AGE_MS,
  });
}

router.post('/register', authLimiter, (req, res) => {
  const { fullName, phone, password, signupSource } = req.body || {};
  const email = normalizeEmail((req.body || {}).email);
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صحيحة' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجّل بالفعل' });
  }

  const baseUsername = fullName.trim().toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '') || 'writer';
  let username = baseUsername;
  let n = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    username = `${baseUsername}-${++n}`;
  }

  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  const lastName = rest.join(' ') || null;

  // مصدر التسجيل (مثلاً اسم حملة إعلانية) بييجي من رابط UTM في صفحة الهبوط — بنقصّه ونقيّده كـ نص بسيط للأمان.
  const source = typeof signupSource === 'string' ? signupSource.trim().slice(0, 60).replace(/[^\w؀-ۿ-]/g, '') : null;

  const info = db.prepare(`
    INSERT INTO users (username, email, phone, password_hash, first_name, last_name, user_type, signup_source)
    VALUES (?, ?, ?, ?, ?, ?, 'writer', ?)
  `).run(username, email, phone || null, hashPassword(password), firstName, lastName, source || null);

  db.prepare('INSERT INTO writer_profiles (user_id) VALUES (?)').run(info.lastInsertRowid);
  db.prepare('INSERT INTO user_earnings (user_id) VALUES (?)').run(info.lastInsertRowid);

  setSessionCookie(req, res, info.lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', authLimiter, (req, res) => {
  const { password } = req.body || {};
  const email = normalizeEmail((req.body || {}).email);
  if (!email || !password) {
    return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }
  setSessionCookie(req, res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie('harf_session');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.userId) return res.json({ user: null });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: publicUser(user) });
});

const RESET_TOKEN_MINUTES = 30;
const GENERIC_RESET_MESSAGE = 'لو البريد الإلكتروني ده مسجّل عندنا، وصله رابط لاستعادة كلمة المرور.';

router.post('/forgot-password', authLimiter, async (req, res) => {
  const email = normalizeEmail((req.body || {}).email);
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'أدخلي بريدًا إلكترونيًا صحيحًا' });
  }

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  // نفس الرسالة سواء الإيميل موجود أو لأ، عشان محدش يقدر يعرف مين مسجّل في الموقع من غير كده.
  if (!user) return res.json({ ok: true, message: GENERIC_RESET_MESSAGE });

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?').run(tokenHash, expires, user.id);

  const origin = `${req.protocol}://${req.get('host')}`;
  const resetUrl = `${origin}/reset-password.html?token=${token}`;
  await sendResetEmail(user.email, resetUrl).catch(() => {});

  res.json({ ok: true, message: GENERIC_RESET_MESSAGE });
});

router.post('/reset-password', authLimiter, (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'الرابط أو كلمة المرور غير صحيحة' });
  if (password.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = db.prepare('SELECT id, reset_token_expires FROM users WHERE reset_token_hash = ?').get(tokenHash);
  if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'رابط الاستعادة غير صالح أو منتهي — اطلبي رابطًا جديدًا' });
  }

  db.prepare('UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?')
    .run(hashPassword(password), user.id);

  res.json({ ok: true });
});

module.exports = router;
