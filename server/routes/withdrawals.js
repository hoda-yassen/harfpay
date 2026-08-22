const express = require('express');
const db = require('../db');
const { requireAuth } = require('../lib/session');

const router = express.Router();

const METHODS = {
  vodafone_cash: 'فودافون كاش',
  etisalat_cash: 'اتصالات كاش',
  instapay: 'إنستا باي',
  tilda: 'تيلدا',
  airtm: 'AirTM',
};

router.get('/methods', (req, res) => {
  res.json({ methods: Object.entries(METHODS).map(([value, label]) => ({ value, label })) });
});

router.get('/', requireAuth, (req, res) => {
  const requests = db.prepare(`
    SELECT id, amount, method, status, created_at, processed_at
    FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.userId);
  res.json({ requests: requests.map(r => ({ ...r, methodLabel: METHODS[r.method] || r.method })) });
});

router.post('/', requireAuth, (req, res) => {
  const { amount, method, paymentDetails } = req.body || {};
  const numericAmount = Number(amount);

  if (!METHODS[method]) {
    return res.status(400).json({ error: 'طريقة السحب غير مدعومة' });
  }
  if (!paymentDetails || !String(paymentDetails).trim()) {
    return res.status(400).json({ error: 'من فضلك أدخلي بيانات الحساب (رقم المحفظة أو الحساب)' });
  }
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'قيمة السحب غير صحيحة' });
  }
  if (numericAmount < db.MIN_WITHDRAWAL_USD) {
    return res.status(400).json({ error: `الحد الأدنى للسحب هو ${db.MIN_WITHDRAWAL_USD}$` });
  }

  const earnings = db.prepare('SELECT available_balance FROM user_earnings WHERE user_id = ?').get(req.userId);
  if (!earnings || numericAmount > earnings.available_balance) {
    return res.status(400).json({ error: 'رصيدك المتاح أقل من قيمة السحب المطلوبة' });
  }

  db.prepare('UPDATE user_earnings SET available_balance = available_balance - ? WHERE user_id = ?')
    .run(numericAmount, req.userId);
  const info = db.prepare(`
    INSERT INTO withdrawal_requests (user_id, amount, method, payment_details, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(req.userId, numericAmount, method, String(paymentDetails).trim());

  res.status(201).json({
    request: { id: info.lastInsertRowid, amount: numericAmount, method, methodLabel: METHODS[method], status: 'pending' },
  });
});

module.exports = router;
