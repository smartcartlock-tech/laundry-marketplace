// התראה לשליח על משימות חדשות משיבוץ אוטומטי (routes-engine).
// עובר דרך notifyUser — push קודם, וואטסאפ בדמו רק ל-DEMO_NOTIFY_ALLOWLIST, אחרת סימולציה בלוג.
const { q } = require('./db');
const { notifyUser } = require('./notify');

// built: רשומות buildRoutesForDate — { courier_id, city, stops, combined }
async function notifyRouteBuilt(built) {
  for (const b of built || []) {
    if (!b.courier_id || !b.stops) continue;
    try {
      const { rows } = await q(
        'SELECT u.id AS uid, u.phone FROM couriers c JOIN users u ON u.id=c.user_id WHERE c.id=$1', [b.courier_id]);
      if (!rows[0]) continue;
      await notifyUser(rows[0].uid, null,
        `שובצו לך ${b.stops} נקודות חדשות למסלול היום (${b.city}). פתח/י את מסך מסלול היום באפליקציה.`,
        rows[0].phone);
    } catch (e) { console.error('[courier-notify]', e.message); }
  }
}

module.exports = { notifyRouteBuilt };
