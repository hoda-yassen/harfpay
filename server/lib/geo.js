const geoip = require('geoip-lite');

// يحدد بلد أي IP محليًا (بدون أي اتصال خارجي) لأغراض التحليلات العامة (زوار/تسجيلات حسب البلد).
// منفصل عن resolveCountryCode في articles.js اللي بيرجع 'DEFAULT' عمدًا لو البلد مش في جدول أسعار
// المشاهدة — هنا بنرجع كود البلد الحقيقي زي ما هو، أو 'unknown' لو مفيش بيانات (زي 127.0.0.1 محليًا).
function lookupCountry(ip) {
  const geo = geoip.lookup(ip);
  return (geo && geo.country) || 'unknown';
}

module.exports = { lookupCountry };
