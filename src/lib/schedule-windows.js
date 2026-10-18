// T95: 'ללא העדפה' → שיבוץ אוטומטי לחלון הפתוח הקרוב (במקום ברירת-מחדל של שעת יצירה).
// אם אין חלון מתאים ב-14 הימים הקרובים — מחזיר null וההזמנה נשארת 'לתיאום'.
// הלוגיקה מקבילה ל-pickupOptions (src/lib/pickup-change.js): שעון ירושלים ב-SQL, דילוג על שבת,
// ימי סגירה וקיבולת; עמודת הספירה תלוית סוג החלון (pickup_at לאיסוף, delivery_at להחזרה).
const { q } = require('../db');

async function nextOpenWindow(tenantId, kind, { after = null, db = { query: q } } = {}) {
  if (!['pickup', 'delivery'].includes(kind)) return null;
  const afterTs = after ? new Date(after) : new Date();
  if (isNaN(afterTs.getTime())) return null;
  const col = kind === 'pickup' ? 'o.pickup_at' : 'o.delivery_at';
  const { rows } = await db.query(`
    SELECT ((d.day::date + w.start_time) AT TIME ZONE 'Asia/Jerusalem') AS at
    FROM generate_series((now() AT TIME ZONE 'Asia/Jerusalem')::date,
      (now() AT TIME ZONE 'Asia/Jerusalem')::date + 14, interval '1 day') d(day)
    JOIN pickup_windows w ON w.tenant_id=$1 AND w.kind=$2
      AND w.weekday=extract(dow FROM d.day) AND w.weekday<>6
    WHERE ((d.day::date + w.start_time) AT TIME ZONE 'Asia/Jerusalem') > $3
      AND NOT EXISTS (SELECT 1 FROM tenant_closures c WHERE c.tenant_id=$1 AND c.day=d.day::date)
      AND (SELECT count(*) FROM orders o WHERE o.tenant_id=$1
        AND o.status NOT IN ('cancelled','delivered')
        AND ${col} >= ((d.day::date + w.start_time) AT TIME ZONE 'Asia/Jerusalem')
        AND ${col} < ((d.day::date + w.end_time) AT TIME ZONE 'Asia/Jerusalem')) < w.capacity
    ORDER BY at LIMIT 1`, [tenantId, kind, afterTs.toISOString()]);
  return rows[0] ? new Date(rows[0].at).toISOString() : null;
}

module.exports = { nextOpenWindow };
