/* Shared logic for the Harf platform: follow persistence + share counters.
   Follow state is stored locally in this browser (localStorage) since the
   site has no live backend yet — see harf-database-schema.sql for the
   schema a real server would use to make this synced across devices/users. */
(function () {
  // بيلقط مصدر الزيارة أول ما حد يدخل الموقع (أول لمسة فقط) عشان لو سجّل بعد كده نعرف جاي منين —
  // من غير ما نحتاج رابط فيه utm مخصوص. لو الرابط فيه utm_campaign/utm_source بناخده كأولوية
  // (لأنه أدق، زي "fb_ad_1")، ولو مفيش، بنستنتج المصدر تلقائيًا من referrer المتصفح (facebook.com،
  // instagram.com، google، إلخ) اللي بييجي مع أي زيارة عادي من غير أي تعديل على الرابط نفسه.
  const SOURCE_KEY = 'harf-signup-source';
  function detectSourceFromReferrer() {
    try {
      if (!document.referrer) return null;
      const host = new URL(document.referrer).hostname.replace(/^www\./, '');
      if (host === location.hostname) return null; // تنقل داخلي في نفس الموقع، مش مصدر خارجي
      const KNOWN = {
        'facebook.com': 'facebook', 'l.facebook.com': 'facebook', 'lm.facebook.com': 'facebook',
        'instagram.com': 'instagram', 'l.instagram.com': 'instagram',
        'google.com': 'google', 'x.com': 'twitter', 'twitter.com': 'twitter',
        'tiktok.com': 'tiktok', 'whatsapp.com': 'whatsapp', 'wa.me': 'whatsapp',
        'youtube.com': 'youtube', 'linkedin.com': 'linkedin',
      };
      return KNOWN[host] || host;
    } catch (e) { return null; }
  }
  try {
    const params = new URLSearchParams(location.search);
    const campaign = params.get('utm_campaign') || params.get('utm_source') || params.get('ref') || detectSourceFromReferrer();
    if (campaign && !localStorage.getItem(SOURCE_KEY)) {
      localStorage.setItem(SOURCE_KEY, campaign.slice(0, 60));
    }
  } catch (e) {}
  window.harfGetSignupSource = function () {
    try { return localStorage.getItem(SOURCE_KEY) || null; }
    catch (e) { return null; }
  };

  const FOLLOW_KEY = 'harf-follows';

  function getFollows() {
    try { return JSON.parse(localStorage.getItem(FOLLOW_KEY)) || []; }
    catch (e) { return []; }
  }

  function setFollows(list) {
    localStorage.setItem(FOLLOW_KEY, JSON.stringify(list));
  }

  function isFollowing(authorId) {
    return getFollows().includes(authorId);
  }

  function applyFollowUI(authorId, following) {
    document.querySelectorAll(`[data-author-id="${authorId}"].follow-btn`).forEach(b => {
      b.classList.toggle('following', following);
      b.textContent = following ? 'متابَع' : 'متابعة';
    });
  }

  function toggleFollowLocal(authorId) {
    let follows = getFollows();
    const nowFollowing = !follows.includes(authorId);
    follows = nowFollowing ? [...follows, authorId] : follows.filter(id => id !== authorId);
    setFollows(follows);
    applyFollowUI(authorId, nowFollowing);
    if (typeof showToast === 'function') {
      showToast(nowFollowing ? 'تمت المتابعة!' : 'تم إلغاء المتابعة');
    }
  }

  async function toggleFollow(btn, authorId) {
    if (!authorId) return;
    try {
      const res = await fetch(`/api/authors/${authorId}/follow`, { method: 'POST' });
      if (res.status === 401) {
        if (typeof showToast === 'function') showToast('سجّلي الدخول أولاً للمتابعة');
        if (typeof openModal === 'function') openModal();
        return;
      }
      if (!res.ok) throw new Error('follow request failed');
      const data = await res.json();
      applyFollowUI(authorId, data.following);
      document.querySelectorAll(`[data-follower-count-for="${authorId}"]`).forEach(el => {
        el.textContent = data.followerCount.toLocaleString('ar-EG');
      });
      if (typeof showToast === 'function') {
        showToast(data.following ? 'تمت المتابعة!' : 'تم إلغاء المتابعة');
      }
    } catch (e) {
      // لا يوجد سيرفر متاح — نستخدم تخزين محلي في المتصفح كبديل مؤقت.
      toggleFollowLocal(authorId);
    }
  }

  function initFollowButtons() {
    const authorIds = new Set();
    document.querySelectorAll('.follow-btn[data-author-id]').forEach(btn => {
      const authorId = btn.dataset.authorId;
      authorIds.add(authorId);
      if (isFollowing(authorId)) {
        btn.classList.add('following');
        btn.textContent = 'متابَع';
      }
      if (btn.dataset.harfBound) return;
      btn.dataset.harfBound = '1';
      btn.addEventListener('click', () => toggleFollow(btn, authorId));
    });
    authorIds.forEach(async (authorId) => {
      try {
        const res = await fetch(`/api/authors/${authorId}`);
        if (!res.ok) return;
        const data = await res.json();
        applyFollowUI(authorId, data.isFollowing);
        document.querySelectorAll(`[data-follower-count-for="${authorId}"]`).forEach(el => {
          el.textContent = data.author.followerCount.toLocaleString('ar-EG');
        });
      } catch (e) {
        // لا يوجد سيرفر متاح — تُستخدم حالة المتابعة المحلية المحمّلة أعلاه.
      }
    });
  }

  async function initAuthorProfilePage(username) {
    try {
      const res = await fetch(`/api/authors/${username}`);
      if (!res.ok) return;
      const data = await res.json();
      const cover = document.querySelector('.cover');
      if (cover && data.author.cover) cover.style.backgroundImage = `url('${data.author.cover}')`;
      const countryEl = document.querySelector('[data-profile-country]');
      if (countryEl && data.author.country) countryEl.textContent = data.author.country;
      const specEl = document.querySelector('[data-profile-specialization]');
      if (specEl && data.author.specialization) specEl.textContent = data.author.specialization;
      const bioEl = document.querySelector('.profile-bio');
      if (bioEl && data.author.bio) bioEl.textContent = data.author.bio;
      const avatarEl = document.querySelector('.profile-avatar');
      if (avatarEl && data.author.avatar) avatarEl.src = data.author.avatar;
      if (data.isOwnProfile) {
        const editLink = document.querySelector('[data-edit-profile-link]');
        if (editLink) editLink.style.display = 'inline-flex';
      }
    } catch (e) {
      // لا يوجد سيرفر متاح — تُعرض البيانات الثابتة كما هي.
    }
  }

  window.harfToggleFollow = toggleFollow;
  window.harfIsFollowing = isFollowing;
  window.harfInitAuthorProfilePage = initAuthorProfilePage;
  window.harfInitFollowButtons = initFollowButtons;
  document.addEventListener('DOMContentLoaded', () => {
    initFollowButtons();
  });
})();
