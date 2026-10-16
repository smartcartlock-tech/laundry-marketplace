// E3: התראה לאדמין על שגיאת 500 חדשה ב-error_log — דרך ה-push/וואטסאפ הקיימים (notify.js).
// דיכוי: התראה אחת לכל היותר ל-10 דקות (ניתן לעקוף ב-ERROR_ALERT_THROTTLE_MS, לבדיקות).
// נופל בשקט: כשל בשליחה לא משפיע על רישום השגיאה או על השרת.
const { q } = require('./db');
const { notifyUser } = require('./notify');

const THROTTLE_MS = Number(process.env.ERROR_ALERT_THROTTLE_MS) || 10 * 60 * 1000;
let lastAlertAt = 0;
let inFlight = false;

async function maybeAlertAdmin(entry) {
  const now = Date.now();
  if (now - lastAlertAt < THROTTLE_MS || inFlight) return { alerted: false, throttled: true };
  inFlight = true;
  try {
    const { rows } = await q(`SELECT id, phone FROM users WHERE role = 'admin'`);
    if (!rows.length) return { alerted: false, reason: 'no-admins' };
    const body = `⚠️ שגיאת שרת (500): ${entry.method || ''} ${entry.path || ''}\n${String(entry.message || '').slice(0, 200)}`;
    for (const admin of rows) {
      await notifyUser(admin.id, null, body, admin.phone).catch(() => {});
    }
    lastAlertAt = Date.now();
    return { alerted: true, admins: rows.length };
  } catch (e) {
    console.warn('[error-alerts] failed:', e.message);
    return { alerted: false, reason: e.message };
  } finally {
    inFlight = false;
  }
}

module.exports = { maybeAlertAdmin, THROTTLE_MS };
