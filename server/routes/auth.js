const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { hashPassword, verifyPassword } = require('../lib/password');
const { createSessionToken, MAX_AGE_MS } = require('../lib/session');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const { fullName, email, phone, password } = req.body || {};
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

  const info = db.prepare(`
    INSERT INTO users (username, email, phone, password_hash, first_name, last_name, user_type)
    VALUES (?, ?, ?, ?, ?, ?, 'writer')
  `).run(username, email, phone || null, hashPassword(password), firstName, lastName);

  db.prepare('INSERT INTO writer_profiles (user_id) VALUES (?)').run(info.lastInsertRowid);
  db.prepare('INSERT INTO user_earnings (user_id) VALUES (?)').run(info.lastInsertRowid);

  setSessionCookie(req, res, info.lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
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

module.exports = router;
