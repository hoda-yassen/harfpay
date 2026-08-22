const express = require('express');
const db = require('../db');
const { requireAuth } = require('../lib/session');

const router = express.Router();

router.get('/:username', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'الكاتب غير موجود' });

  const profile = db.prepare('SELECT * FROM writer_profiles WHERE user_id = ?').get(user.id) || {};
  const articles = db.prepare(`
    SELECT id, title, slug, description, featured_image_url, reading_time_minutes, view_count, published_at
    FROM articles WHERE user_id = ? AND is_published = 1 ORDER BY published_at DESC
  `).all(user.id);

  let isFollowing = false;
  if (req.userId) {
    isFollowing = !!db.prepare('SELECT 1 FROM followers WHERE writer_id = ? AND follower_id = ?').get(user.id, req.userId);
  }

  res.json({
    author: {
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      bio: profile.bio_full || user.bio,
      avatar: user.profile_image_url,
      cover: profile.cover_image_url || null,
      country: profile.country || null,
      specialization: profile.specialization || null,
      followerCount: profile.follower_count || 0,
      articleCount: profile.article_count || 0,
      totalViews: profile.total_views || 0,
    },
    articles,
    isFollowing,
    isOwnProfile: req.userId === user.id,
  });
});

router.post('/:username/follow', requireAuth, (req, res) => {
  const writer = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!writer) return res.status(404).json({ error: 'الكاتب غير موجود' });
  if (writer.id === req.userId) return res.status(400).json({ error: 'لا يمكنك متابعة نفسك' });

  const existing = db.prepare('SELECT id FROM followers WHERE writer_id = ? AND follower_id = ?').get(writer.id, req.userId);
  let following;
  if (existing) {
    db.prepare('DELETE FROM followers WHERE id = ?').run(existing.id);
    db.prepare('UPDATE writer_profiles SET follower_count = MAX(follower_count - 1, 0) WHERE user_id = ?').run(writer.id);
    following = false;
  } else {
    db.prepare('INSERT INTO followers (writer_id, follower_id) VALUES (?, ?)').run(writer.id, req.userId);
    db.prepare('UPDATE writer_profiles SET follower_count = follower_count + 1 WHERE user_id = ?').run(writer.id);
    following = true;
  }
  const profile = db.prepare('SELECT follower_count FROM writer_profiles WHERE user_id = ?').get(writer.id);
  res.json({ following, followerCount: profile.follower_count });
});

module.exports = router;
