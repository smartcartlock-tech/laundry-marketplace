// C3: Retention — מחיקה מתוזמנת של נתונים שפגו או ישנים (מזעור מידע, תיקון 13).
// רץ בהפעלת השרת ואחת ל-6 שעות. מוחק רק נתונים שאין חובה חוקית/עסקית לשמור:
//   otp_codes שפגו (סיסמאות חד-פעמיות — אין שום ערך בשמירתן)
//   bot_sessions שפגו (טוקני שיחה מתים)
//   notifications מעל 90 יום (לוג שליחות תפעולי; אינו מסמך חשבונאי)
// push_subscriptions מתות כבר נמחקות בעת שליחה (410/404 ב-src/push.js).
const { q } = require('./db');

const RULES = [
  { name: 'otp_codes', sql: `DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day'` },
  { name: 'bot_sessions', sql: `DELETE FROM bot_sessions WHERE expires_at < now() - interval '1 day'` },
  { name: 'notifications', sql: `DELETE FROM notifications WHERE created_at < now() - interval '90 days'` },
];

async function runRetention() {
  const out = {};
  for (const r of RULES) {
    const res = await q(r.sql);
    out[r.name] = res.rowCount || 0;
  }
  return out;
}

function startRetention() {
  const run = () => runRetention()
    .then(c => { const n = Object.values(c).reduce((a, b) => a + b, 0); if (n) console.log('[retention] deleted:', JSON.stringify(c)); })
    .catch(e => console.error('[retention]', e.message));
  setTimeout(run, 30 * 1000);
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}

module.exports = { runRetention, startRetention };
