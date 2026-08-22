const express = require('express');
const db = require('../db');
const { requireAuth } = require('../lib/session');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const notifications = db.prepare(`
    SELECT id, type, message, article_id, is_read, created_at
    FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30
  `).all(req.userId);
  const unreadCount = notifications.filter(n => !n.is_read).length;
  res.json({ notifications, unreadCount });
});

router.post('/:id/read', requireAuth, (req, res) => {
  const notification = db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!notification) return res.status(404).json({ error: 'الإشعار غير موجود' });
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(notification.id);
  res.json({ ok: true });
});

router.post('/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.userId);
  res.json({ ok: true });
});

module.exports = router;
