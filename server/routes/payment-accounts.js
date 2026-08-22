const express = require('express');
const db = require('../db');
const { requireAuth } = require('../lib/session');

const router = express.Router();

const VALID_METHODS = ['vodafone_cash', 'etisalat_cash', 'instapay', 'tilda', 'airtm'];

router.get('/', requireAuth, (req, res) => {
  const accounts = db.prepare('SELECT method, account_value FROM payment_accounts WHERE user_id = ?').all(req.userId);
  res.json({ accounts });
});

router.put('/:method', requireAuth, (req, res) => {
  const { method } = req.params;
  const { accountValue } = req.body || {};

  if (!VALID_METHODS.includes(method)) return res.status(400).json({ error: 'وسيلة سحب غير مدعومة' });
  if (!accountValue || !String(accountValue).trim()) {
    return res.status(400).json({ error: 'من فضلك أدخلي بيانات المحفظة أو الحساب' });
  }

  db.prepare(`
    INSERT INTO payment_accounts (user_id, method, account_value)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, method) DO UPDATE SET account_value = excluded.account_value
  `).run(req.userId, method, String(accountValue).trim());

  res.json({ ok: true, method, accountValue: String(accountValue).trim() });
});

router.delete('/:method', requireAuth, (req, res) => {
  db.prepare('DELETE FROM payment_accounts WHERE user_id = ? AND method = ?').run(req.userId, req.params.method);
  res.json({ ok: true });
});

module.exports = router;
