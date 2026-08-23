const path = require('node:path');

// كل البيانات اللي لازم تعيش بعد إعادة النشر (قاعدة البيانات + صور المقالات المرفوعة) تُخزَّن هنا.
// لازم DATA_DIR يشاور على Volume دائم على Railway (مش فولدر الكود العادي، لأنه بيتصفّر مع كل Deploy جديد)،
// وإلا كل حسابات الكتّاب ومقالاتهم وأرباحهم هتُمسح تلقائيًا كل مرة يتم فيها تحديث الموقع.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');

module.exports = { DATA_DIR };
