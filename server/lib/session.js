const { createHmac, randomBytes } = require('node:crypto');

// على الاستضافة اضبط SESSION_SECRET في متغيرات البيئة.
// محلياً يُنشأ سر عشوائي مؤقت (سيُبطل الجلسات عند كل إعادة تشغيل).
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function createSessionToken(userId) {
  return sign({ userId, exp: Date.now() + MAX_AGE_MS });
}

function attachSession(req, res, next) {
  const token = req.cookies && req.cookies.harf_session;
  const payload = verify(token);
  req.userId = payload ? payload.userId : null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  const db = require('../db');
  const user = db.prepare('SELECT user_type FROM users WHERE id = ?').get(req.userId);
  if (!user || user.user_type !== 'admin') return res.status(403).json({ error: 'هذه الصفحة للمشرفين فقط' });
  next();
}

module.exports = { createSessionToken, attachSession, requireAuth, requireAdmin, MAX_AGE_MS };
