const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../lib/session');

const router = express.Router();

router.get('/pending-articles', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.title, a.slug, a.description, a.content, a.created_at,
           u.username AS author_username, u.first_name AS author_first_name, u.last_name AS author_last_name
    FROM articles a
    JOIN users u ON u.id = a.user_id
    WHERE a.status = 'pending_review'
    ORDER BY a.created_at ASC
  `).all();
  res.json({ articles: rows });
});

router.post('/articles/:id/approve', requireAdmin, (req, res) => {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!article) return res.status(404).json({ error: 'المقال غير موجود' });

  db.prepare(`
    UPDATE articles SET status = 'published', is_published = 1, published_at = datetime('now')
    WHERE id = ?
  `).run(article.id);
  db.prepare('UPDATE writer_profiles SET article_count = article_count + 1 WHERE user_id = ?').run(article.user_id);

  res.json({ ok: true });
});

router.post('/articles/:id/reject', requireAdmin, (req, res) => {
  const { reason } = req.body || {};
  const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(req.params.id);
  if (!article) return res.status(404).json({ error: 'المقال غير موجود' });

  db.prepare(`
    UPDATE articles SET status = 'rejected', rejection_reason = ? WHERE id = ?
  `).run(reason || 'لم يستوفِ معايير النشر', article.id);

  res.json({ ok: true });
});

const MAX_PINNED_ARTICLES = 3;

router.get('/published-articles', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.title, a.slug, a.is_pinned, a.published_at,
           u.username AS author_username, u.first_name AS author_first_name, u.last_name AS author_last_name
    FROM articles a
    JOIN users u ON u.id = a.user_id
    WHERE a.status = 'published'
    ORDER BY a.is_pinned DESC, a.published_at DESC
  `).all();
  res.json({ articles: rows });
});

router.post('/articles/:id/pin', requireAdmin, (req, res) => {
  const article = db.prepare('SELECT id, status FROM articles WHERE id = ?').get(req.params.id);
  if (!article) return res.status(404).json({ error: 'المقال غير موجود' });
  if (article.status !== 'published') return res.status(400).json({ error: 'لا يمكن تثبيت مقال غير منشور' });

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM articles WHERE is_pinned = 1').get();
  if (count >= MAX_PINNED_ARTICLES) {
    return res.status(400).json({ error: `يمكن تثبيت ${MAX_PINNED_ARTICLES} مقالات فقط في نفس الوقت. ألغِ تثبيت مقال آخر أولاً.` });
  }

  db.prepare('UPDATE articles SET is_pinned = 1 WHERE id = ?').run(article.id);
  res.json({ ok: true });
});

router.post('/articles/:id/unpin', requireAdmin, (req, res) => {
  const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(req.params.id);
  if (!article) return res.status(404).json({ error: 'المقال غير موجود' });

  db.prepare('UPDATE articles SET is_pinned = 0 WHERE id = ?').run(article.id);
  res.json({ ok: true });
});

const WITHDRAWAL_STATUSES = ['pending', 'approved', 'processing', 'completed', 'rejected'];

router.get('/withdrawals', requireAdmin, (req, res) => {
  const statusFilter = req.query.status;
  const rows = statusFilter
    ? db.prepare(`
        SELECT w.*, u.username, u.first_name, u.last_name, u.email
        FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
        WHERE w.status = ? ORDER BY w.created_at ASC
      `).all(statusFilter)
    : db.prepare(`
        SELECT w.*, u.username, u.first_name, u.last_name, u.email
        FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
        ORDER BY w.created_at DESC
      `).all();
  res.json({ requests: rows });
});

router.post('/withdrawals/:id/status', requireAdmin, (req, res) => {
  const { status, notes } = req.body || {};
  if (!WITHDRAWAL_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'حالة غير صحيحة' });
  }
  const request = db.prepare('SELECT * FROM withdrawal_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (request.status === 'completed' || request.status === 'rejected') {
    return res.status(400).json({ error: 'هذا الطلب تمت معالجته بالفعل ولا يمكن تعديله' });
  }

  // لو اتحول لمرفوض، الرصيد يرجع للكاتب لأنه ما استلمش الفلوس فعليًا.
  if (status === 'rejected') {
    db.prepare('UPDATE user_earnings SET available_balance = available_balance + ? WHERE user_id = ?')
      .run(request.amount, request.user_id);
  }

  db.prepare(`
    UPDATE withdrawal_requests SET status = ?, notes = ?,
      processed_at = CASE WHEN ? IN ('completed','rejected') THEN datetime('now') ELSE processed_at END
    WHERE id = ?
  `).run(status, notes || request.notes, status, request.id);

  res.json({ ok: true });
});

module.exports = router;
