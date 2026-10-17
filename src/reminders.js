// T84: internal inbox only. Never import notify, push, bot, SMS or WhatsApp.
const { pool } = require('./db');
const { isDemo } = require('./config');
const { postUserMessage } = require('./usermessages');
const { isQuietTime } = require('./shabbat');
const KINDS = new Set(['order_ready', 'pickup_tomorrow', 'courier']);
const TEXT = {
  order_ready: ['ההזמנה מוכנה', 'ההזמנה שלך מוכנה במכבסה.'],
  pickup_tomorrow: ['תזכורת איסוף למחר', 'האיסוף של ההזמנה שלך מתוכנן למחר.'],
  courier: ['תזכורת משימת שליח', 'יש לך משימת איסוף או מסירה מתוכננת בקרוב.'],
};
async function enqueue(query, { tenantId, userId, orderId, kind, scheduledAt, key, payload = {} }) {
  if (!KINDS.has(kind)) throw new Error('invalid reminder kind');
  const { rows } = await query(`INSERT INTO reminder_outbox(tenant_id,user_id,order_id,kind,payload,scheduled_at,idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING *`,
  [tenantId, userId, orderId, kind, payload, scheduledAt, key]);
  return rows[0] || null;
}
// Polling hooks catch changes from every order route, including courier assignment.
async function scheduleHooks(query, tenantId) {
  await query(`INSERT INTO reminder_outbox(tenant_id,user_id,order_id,kind,payload,scheduled_at,idempotency_key)
    SELECT tenant_id,customer_id,id,'order_ready','{}',now(),'ready:'||id FROM orders
    WHERE tenant_id=$1 AND status='ready' ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`, [tenantId]);
  await query(`INSERT INTO reminder_outbox(tenant_id,user_id,order_id,kind,payload,scheduled_at,idempotency_key)
    SELECT tenant_id,customer_id,id,'pickup_tomorrow',jsonb_build_object('event_at',pickup_at),
      ((pickup_at AT TIME ZONE 'Asia/Jerusalem')::date-1 + time '09:00') AT TIME ZONE 'Asia/Jerusalem',
      'pickup:'||id||':'||pickup_at FROM orders
    WHERE tenant_id=$1 AND status IN ('new','confirmed') AND pickup_at>now()
      AND (pickup_at AT TIME ZONE 'Asia/Jerusalem')::date=(now() AT TIME ZONE 'Asia/Jerusalem')::date+1
    ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`, [tenantId]);
  await query(`INSERT INTO reminder_outbox(tenant_id,user_id,order_id,kind,payload,scheduled_at,idempotency_key)
    SELECT o.tenant_id,c.user_id,o.id,'courier',jsonb_build_object('event_at',CASE WHEN o.status='confirmed' THEN o.pickup_at ELSE o.delivery_at END),
      (CASE WHEN o.status='confirmed' THEN o.pickup_at ELSE o.delivery_at END)-interval '1 hour',
      'courier:'||o.id||':'||c.user_id||':'||(CASE WHEN o.status='confirmed' THEN 'pickup' ELSE 'delivery' END)||':'||(CASE WHEN o.status='confirmed' THEN o.pickup_at ELSE o.delivery_at END)
    FROM orders o JOIN couriers c ON c.id=o.courier_id AND c.approved=true
    WHERE o.tenant_id=$1 AND o.status IN ('confirmed','ready','out_for_delivery')
      AND (CASE WHEN o.status='confirmed' THEN o.pickup_at ELSE o.delivery_at END)>now()
    ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`, [tenantId]);
}
function localDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date));
  const get = type => parts.find(p=>p.type===type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function validForOrder(r, o, courierUser) {
  if (!o || ['cancelled', 'delivered'].includes(o.status)) return false;
  if (r.kind === 'order_ready') return o.status === 'ready' && r.user_id === o.customer_id;
  const event = r.kind === 'pickup_tomorrow' ? o.pickup_at : (o.status === 'confirmed' ? o.pickup_at : o.delivery_at);
  if (r.kind === 'courier' && event && new Date(event).getTime() <= Date.now()) return false;
  if (r.payload.event_at && (!event || new Date(event).getTime() !== new Date(r.payload.event_at).getTime())) return false;
  if (r.kind === 'pickup_tomorrow') return ['new', 'confirmed'].includes(o.status) && r.user_id === o.customer_id;
  return ['confirmed', 'ready', 'out_for_delivery'].includes(o.status) && courierUser === r.user_id;
}
async function deliverTenant(tenantId, db = pool) {
  const c = await db.connect();
  const query = c.query.bind(c);
  try {
    await query('BEGIN');
    const { rows } = await query(`SELECT * FROM reminder_outbox WHERE tenant_id=$1 AND status='pending'
      ORDER BY (scheduled_at<=now()) DESC,scheduled_at LIMIT 500 FOR UPDATE SKIP LOCKED`, [tenantId]);
    let delivered = 0;
    for (const r of rows) {
      const { rows: orders } = await query('SELECT * FROM orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, r.order_id]);
      const o = orders[0];
      let courierUser;
      if (o?.courier_id) {
        const { rows: couriers } = await query(`SELECT c.user_id FROM couriers c JOIN orders o ON o.courier_id=c.id
          WHERE o.tenant_id=$1 AND o.id=$2 AND c.approved=true`, [tenantId, o.id]);
        courierUser = couriers[0]?.user_id;
      }
      const { rows: prefs } = await query(`SELECT p.* FROM user_notification_prefs p JOIN reminder_outbox r ON r.user_id=p.user_id
        WHERE r.tenant_id=$1 AND r.id=$2 FOR SHARE OF p`, [tenantId, r.id]);
      const p = prefs[0];
      if (!validForOrder(r, o, courierUser) || p?.status_updates === false || p?.order_messages === false) {
        await query("UPDATE reminder_outbox SET status='cancelled' WHERE tenant_id=$1 AND id=$2", [tenantId, r.id]);
        continue;
      }
      if (new Date(r.scheduled_at).getTime() > Date.now()) continue;
      if (p?.quiet_shabbat && isQuietTime().quiet) continue;
      // Expired pickup reminders must never claim that an already elapsed pickup is tomorrow.
      if (r.kind === 'pickup_tomorrow' && localDay(o.pickup_at) <= localDay(new Date())) {
        await query("UPDATE reminder_outbox SET status='cancelled' WHERE tenant_id=$1 AND id=$2", [tenantId, r.id]);
        continue;
      }
      const [title, body] = TEXT[r.kind];
      await postUserMessage(r.user_id, { tenantId, kind: 'order', title, body,
        data: { reminder_id: r.id, reminder_kind: r.kind, order_id: r.order_id, internal_only: true } }, query);
      await query("UPDATE reminder_outbox SET status='delivered',delivered_at=now() WHERE tenant_id=$1 AND id=$2 AND status='pending'", [tenantId, r.id]);
      delivered++;
    }
    await query('COMMIT');
    return delivered;
  } catch (e) { await query('ROLLBACK'); throw e; } finally { c.release(); }
}
let running = false;
async function scan() {
  if (!isDemo || running) return;
  running = true;
  try {
    const { rows } = await pool.query('SELECT id FROM tenants');
    for (const t of rows) { await scheduleHooks(pool.query.bind(pool), t.id); await deliverTenant(t.id); }
  } finally { running = false; }
}
function start() {
  if (!isDemo) return null;
  const tick = () => scan().catch(e => console.error('[reminders]', e.message));
  const timer = setInterval(tick, 60000); timer.unref();
  return timer;
}
module.exports = { enqueue, scheduleHooks, deliverTenant, scan, start, KINDS };
