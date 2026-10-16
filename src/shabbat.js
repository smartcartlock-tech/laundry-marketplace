// N7: שקט בשבת וחגים — חישוב מקומי בלבד (בלי API חיצוני), אזור זמן Asia/Jerusalem.
// שבת: שישי 16:00 עד מוצאי שבת 20:00 (קירוב קבוע לצורכי דמו). חגים: רשימה סטטית של ימי חג (איסור מלאכה) 2025-2027.
const HOLIDAYS_2025_2027 = [
  // 2025 (תשרי תשפ"ו ואילך)
  '2025-09-23','2025-09-24',           // ראש השנה
  '2025-10-02',                        // יום כיפור
  '2025-10-07','2025-10-14',           // סוכות, שמחת תורה
  // 2026
  '2026-04-02','2026-04-08',           // פסח
  '2026-05-22',                        // שבועות
  '2026-09-12','2026-09-13',           // ראש השנה תשפ"ז
  '2026-09-21',                        // יום כיפור
  '2026-09-26','2026-10-03',           // סוכות, שמחת תורה
  // 2027
  '2027-04-22','2027-04-28',           // פסח
  '2027-06-11',                        // שבועות
  '2027-10-02','2027-10-03',           // ראש השנה תשפ"ח
  '2027-10-11',                        // יום כיפור
  '2027-10-16','2027-10-23',           // סוכות, שמחת תורה
];
const HOLIDAY_SET = new Set(HOLIDAYS_2025_2027);

function jerusalemNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
}

// האם עכשיו (ירושלים) שבת או יום חג — לצורך השתקת התראות
function isQuietTime(now = jerusalemNow()) {
  const day = now.getDay(); // 0=ראשון ... 6=שבת
  const h = now.getHours();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (day === 5 && h >= 16) return { quiet: true, reason: 'שבת' };
  if (day === 6 && h < 20) return { quiet: true, reason: 'שבת' };
  if (HOLIDAY_SET.has(dateStr)) return { quiet: true, reason: 'חג' };
  // ערב חג מ-16:00 (היום שלפני יום חג ברשימה)
  const next = new Date(now.getTime() + 24 * 3600 * 1000);
  const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  if (HOLIDAY_SET.has(nextStr) && h >= 16) return { quiet: true, reason: 'ערב חג' };
  return { quiet: false };
}

// שעון בר-החזרה לבדיקות (injectable clock): בפרוד תמיד jerusalemNow
let clockFn = jerusalemNow;
function __setClock(fn) { clockFn = fn || jerusalemNow; }

// האם למשתמש מופעל שקט שבת/חג וכרגע זמן שקט
async function shabbatMuted(userId) {
  try {
    const { rows } = await require('./db').q('SELECT quiet_shabbat FROM user_notification_prefs WHERE user_id=$1', [userId]);
    if (!rows[0] || !rows[0].quiet_shabbat) return false;
    return isQuietTime(clockFn()).quiet;
  } catch (e) { return false; } // טעות בקריאה — לא חוסמים הודעות
}

module.exports = { isQuietTime, shabbatMuted, jerusalemNow, __setClock };
