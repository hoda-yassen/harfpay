// إرسال إيميلات عبر Resend (https://resend.com) — يستخدم fetch المدمج في Node، من غير أي مكتبة إضافية.
// لازم تحديد RESEND_API_KEY و RESEND_FROM في متغيّرات البيئة على Railway؛ لو مش موجودين، بيتجاهل الإرسال
// ويسجّل تحذير في اللوج بدل ما يكسر السيرفر (مفيد لحظة التطوير المحلي من غير حساب Resend).

async function sendResetEmail(to, resetUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    console.warn('[mailer] RESEND_API_KEY أو RESEND_FROM غير محددين — لم يتم إرسال إيميل استعادة كلمة المرور.');
    return false;
  }

  const html = `
    <div style="font-family:Tahoma,Arial,sans-serif;direction:rtl;text-align:right;max-width:480px;margin:0 auto;">
      <h2 style="color:#1B4D3E;">استعادة كلمة المرور — حرف</h2>
      <p>وصلنا طلب لاستعادة كلمة المرور لحسابك. اضغطي الرابط ده لتحديد كلمة مرور جديدة:</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#1B4D3E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">تحديد كلمة مرور جديدة</a></p>
      <p style="color:#888;font-size:0.85rem;">الرابط صالح لمدة ٣٠ دقيقة فقط. لو مش انتِ اللي طلبتي ده، تجاهلي هذا الإيميل.</p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: 'استعادة كلمة المرور — حرف', html }),
  });

  if (!res.ok) {
    console.error('[mailer] فشل إرسال إيميل الاستعادة:', res.status, await res.text().catch(() => ''));
    return false;
  }
  return true;
}

module.exports = { sendResetEmail };
