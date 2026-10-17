// T25: שינוי חלון איסוף — לוגיקה משותפת (אפליקציה T26 + בוט) עם התראה לבעלים ולשליח המשובץ.
const { pool, q } = require('../db');
const { notifyUser } = require('../notify');
const { renderTemplateByKey } = require('../usermessages');

// SQL owns Jerusalem/DST conversion; return only configured, open pickup slots.
async function pickupOptions(tenantId, orderId, db = { query: q }) {
  const { rows } = await db.query(`
    SELECT DISTINCT ((d.day::date + w.start_time) AT TIME ZONE 'Asia/Jerusalem') AS at,
      w.end_time::text AS end_time
    FROM generate_series((now() AT TIME ZONE 'Asia/Jerusalem')::date,
      (now() AT TIME ZONE 'Asia/Jerusalem')::date + 14, interval '1 day') d(day)
    JOIN pickup_windows w ON w.tenant_id=$1 AND w.kind='pickup'
      AND w.weekday=extract(dow FROM d.day) AND w.weekday<>6
    WHERE ((d.day::date + w.start_time) AT TIME ZONE 'Asia/Jerusalem') > now()
      AND NOT EXISTS (SELECT 1 FROM tenant_closures c WHERE c.tenant_id=$1 AND c.day=d.day::date)
      AND (SELECT count(*) FROM orders o WHERE o.tenant_id=$1 AND o.id<>$2
        AND o.status NOT IN ('cancelled','delivered')
        AND o.pickup_at >= ((d.day::date + w.start_time) AT TIME ZONE 'Asia/Jerusalem')
        AND o.pickup_at < ((d.day::date + w.end_time) AT TIME ZONE 'Asia/Jerusalem')) < w.capacity
    ORDER BY at LIMIT 30`, [tenantId, orderId]);
  return rows.map(r => ({ at: new Date(r.at).toISOString(), label:
    new Date(r.at).toLocaleString('he-IL', {timeZone:'Asia/Jerusalem', weekday:'long',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}) + '–' + r.end_time.slice(0,5) }));
}

// משנה חלון איסוף עם נעילת שורה ואילוץ סטטוס. מחזיר { ok:true, order } או { error, status }.
async function changePickupWindow({ orderId, tenantId = null, newPickupAt, actorId = null, note = null, notify = true }) {
  const at = new Date(newPickupAt);
  if (isNaN(at.getTime())) return { error: 'מועד איסוף לא תקין', status: 400 };
  if (at.getTime() < Date.now() - 5 * 60 * 1000) return { error: 'לא ניתן לקבוע חלון איסוף בעבר', status: 400 };
  if (at.getTime() > Date.now() + 30 * 24 * 3600 * 1000) return { error: 'חלון איסוף רחוק מדי', status: 400 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT o.*, t.name AS tenant_name FROM orders o JOIN tenants t ON t.id=o.tenant_id
       WHERE o.id=$1 ${tenantId ? 'AND o.tenant_id=$2' : ''} FOR UPDATE`,
      tenantId ? [orderId, tenantId] : [orderId]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return { error: 'הזמנה לא נמצאה', status: 404 }; }
    if (!['new', 'confirmed'].includes(order.status)) { await client.query('ROLLBACK'); return { error: 'לא ניתן לשנות חלון איסוף לאחר איסוף או ביטול', status: 409 }; }
    // Serialize pickup changes for this tenant and recheck the chosen slot under lock.
    await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [order.tenant_id]);
    const options = await pickupOptions(order.tenant_id, order.id, client);
    if (!options.some(s => new Date(s.at).getTime() === at.getTime())) {
      await client.query('ROLLBACK');
      return { error: 'החלון אינו זמין. בחרו חלון איסוף מהרשימה המעודכנת', status: 409 };
    }
    await client.query('UPDATE orders SET pickup_at=$1, updated_at=now() WHERE id=$2', [at.toISOString(), order.id]);
    const label = at.toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
    await client.query('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,$2,$3,$4)',
      [order.id, order.status, actorId, note || `חלון איסוף שונה ל-${label}`]);
    await client.query('COMMIT');
    order.pickup_at = at.toISOString();
    if (notify) notifyPickupChanged(order, label).catch(() => {});
    return { ok: true, order, label };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[pickup-change]', e);
    return { error: 'שגיאת שרת', status: 500 };
  } finally { client.release(); }
}

// T25: התראה לבעלי/צוות המכבסה ולשליח המשובץ (אם יש) על החלון החדש
async function notifyPickupChanged(order, label) {
  const code = order.tracking_code || String(order.id).slice(0, 8);
  const vars = { 'קוד': code, 'חלון': label, 'מכבסה': order.tenant_name || '' };
  const t = await renderTemplateByKey('pickup_window_changed', vars);
  const body = t ? t.body : `חלון האיסוף של הזמנה ${code} שונה ל-${label}.`;
  const { rows: members } = await q(
    'SELECT u.id, u.phone FROM tenant_members tm JOIN users u ON u.id = tm.user_id WHERE tm.tenant_id=$1', [order.tenant_id]);
  for (const m of members) await notifyUser(m.id, order.tenant_id, body, m.phone, t ? t.title : undefined);
  if (order.courier_id) {
    const { rows: c } = await q('SELECT u.id, u.phone FROM couriers c JOIN users u ON u.id=c.user_id WHERE c.id=$1', [order.courier_id]);
    if (c[0]) await notifyUser(c[0].id, order.tenant_id, `עדכון משימה: ${body}`, c[0].phone, t ? t.title : undefined);
  }
}

module.exports = { changePickupWindow, notifyPickupChanged, pickupOptions };
