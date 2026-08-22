const express = require('express');
const db = require('../db');
const { requireAuth } = require('../lib/session');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const earnings = db.prepare('SELECT * FROM user_earnings WHERE user_id = ?').get(req.userId)
    || { total_earnings: 0, available_balance: 0, total_views: 0 };

  const recentViews = db.prepare(`
    SELECT ve.earning_usd, ve.country_code, ve.created_at, a.title AS article_title, a.slug AS article_slug
    FROM view_events ve
    JOIN articles a ON a.id = ve.article_id
    WHERE ve.author_id = ?
    ORDER BY ve.created_at DESC
    LIMIT 20
  `).all(req.userId);

  const rate = db.prepare("SELECT rpm_usd FROM rpm_rates WHERE country_code = 'DEFAULT'").get();

  res.json({
    wallet: {
      totalEarnings: earnings.total_earnings,
      availableBalance: earnings.available_balance,
      totalViews: earnings.total_views,
      currentRpmUsd: rate.rpm_usd,
    },
    recentViews,
  });
});

module.exports = router;
