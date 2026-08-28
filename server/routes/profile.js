const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const db = require('../db');
const { requireAuth } = require('../lib/session');

const router = express.Router();
const SITE_ROOT = path.join(__dirname, '..', '..');
const ALLOWED_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function makeUpload(subfolder) {
  const dir = path.join(SITE_ROOT, 'images', subfolder);
  fs.mkdirSync(dir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
      const ext = ALLOWED_TYPES[file.mimetype] || path.extname(file.originalname) || '.jpg';
      cb(null, `${user.username}${ext}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: MAX_SIZE },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_TYPES[file.mimetype]) return cb(new Error('صيغة الصورة غير مدعومة (jpg, png, webp فقط)'));
      cb(null, true);
    },
  });
}

const uploadAvatar = makeUpload('authors');
const uploadCover = makeUpload('covers');

router.post('/avatar', requireAuth, (req, res) => {
  uploadAvatar.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرفاق صورة' });
    const url = `/images/authors/${req.file.filename}`;
    db.prepare('UPDATE users SET profile_image_url = ? WHERE id = ?').run(url, req.userId);
    res.json({ avatar: url });
  });
});

router.post('/cover', requireAuth, (req, res) => {
  uploadCover.single('cover')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرفاق صورة' });
    const url = `/images/covers/${req.file.filename}`;
    db.prepare('UPDATE writer_profiles SET cover_image_url = ? WHERE user_id = ?').run(url, req.userId);
    res.json({ cover: url });
  });
});

router.put('/', requireAuth, (req, res) => {
  const { bio, specialization, country, firstName, lastName } = req.body || {};
  if (firstName !== undefined) {
    const trimmedFirst = String(firstName || '').trim().slice(0, 80);
    const trimmedLast = String(lastName || '').trim().slice(0, 80);
    if (!trimmedFirst) return res.status(400).json({ error: 'الاسم الأول مطلوب' });
    db.prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?')
      .run(trimmedFirst, trimmedLast || null, req.userId);
  }
  db.prepare(`
    UPDATE writer_profiles SET bio_full = ?, specialization = ?, country = ? WHERE user_id = ?
  `).run(bio || null, specialization || null, country || null, req.userId);
  const profile = db.prepare('SELECT * FROM writer_profiles WHERE user_id = ?').get(req.userId);
  res.json({ profile });
});

module.exports = router;
