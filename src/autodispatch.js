// T81: שיבוץ שליח אוטומטי (דמו בלבד — אין הודעות אמיתיות).
// כשהזמנה מוכנה לאיסוף המערכת מציעה אותה לשליח פנוי באותו tenant עם timeout,
// נופלת לשליח הבא בדחייה או בפקיעה, ומתעדת כל החלטה ב-dispatch_log.
const { q } = require('./db');

const TIMEOUT_MIN = Math.max(0.01, Number(process.env.DISPATCH_OFFER_TIMEOUT_MIN) || 5);

async function logDecision(tenantId, orderId, decision, reason, payload = {}) {
  await q('INSERT INTO dispatch_log(tenant_id, order_id, decision, reason, payload) VALUES ($1,$2,$3,$4,$5)',
    [tenantId, orderId, decision, reason || null, JSON.stringify(payload)]);
}

// שליחים פעילים (מאושרים + מקוונים) באותו tenant, ממוינים לפי עומס משימות פתוחות ואז דירוג.
// שליח שכבר קיבל הצעה להזמנה זו (בכל ניסיון) לא מוצע שוב.
async function pickCourier(tenantId, orderId) {
  const { rows } = await q(
    `SELECT c.id, c.model, u.id AS uid, u.phone,
            (SELECT count(*)::int FROM orders o WHERE o.courier_id=c.id AND o.status NOT IN ('delivered','cancelled')) AS load
     FROM couriers c JOIN users u ON u.id=c.user_id
     WHERE c.approved AND c.is_online AND (c.tenant_id=$1 OR c.model IN ('platform','shared'))
       AND NOT EXISTS (SELECT 1 FROM dispatch_offers f WHERE f.order_id=$2 AND f.courier_id=c.id)
     ORDER BY load ASC, c.rating DESC, c.created_at ASC`, [tenantId, orderId]);
  return rows;
}

// הצעה לשליח הפנוי הבא. trigger: manual / status-confirmed / timeout / decline
async function dispatchOrder(tenantId, orderId, trigger = 'manual') {
  const { rows: o } = await q('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2', [orderId, tenantId]);
  if (!o[0]) return { mode: 'error', error: 'order not found' };
  const order = o[0];
  if (order.courier_id) return { mode: 'skipped', reason: 'already assigned' };
  if (['delivered', 'cancelled'].includes(order.status)) return { mode: 'skipped', reason: 'closed order' };
  const { rows: open } = await q(`SELECT id FROM dispatch_offers WHERE order_id=$1 AND status='offered'`, [orderId]);
  if (open.length) return { mode: 'skipped', reason: 'open offer exists' };
  const candidates = await pickCourier(tenantId, orderId);
  if (!candidates.length) {
    await logDecision(tenantId, orderId, 'unassigned', 'אין שליח פנוי פעיל — ההזמנה נשארת ללא שיבוץ', { trigger });
    return { mode: 'unassigned' };
  }
  const chosen = candidates[0];
  const { rows: att } = await q('SELECT count(*)::int AS n FROM dispatch_offers WHERE order_id=$1', [orderId]);
  const attempt = att[0].n + 1;
  const { rows: off } = await q(
    'INSERT INTO dispatch_offers(tenant_id, order_id, courier_id, attempt) VALUES ($1,$2,$3,$4) RETURNING *',
    [tenantId, orderId, chosen.id, attempt]);
  await logDecision(tenantId, orderId, 'offered', `הצעה מספר ${attempt} נשלחה לשליח`, { trigger, courier_id: chosen.id, load: chosen.load, candidates: candidates.length });
  const { rows: t } = await q('SELECT id, name FROM tenants WHERE id=$1', [tenantId]);
  if (t[0]) require('./ordernotices').notifyCourierNewTask({ id: chosen.uid, phone: chosen.phone }, t[0], order, 'offer').catch(() => {}); // מדומה בסביבת דמו
  return { mode: 'offered', offer: off[0], attempt };
}

// סריקת הצעות שפגו: סימון expired, לוג, ו-fallback לשליח הבא (או unassigned אם אין)
async function expireStaleOffers() {
  const { rows } = await q(
    `UPDATE dispatch_offers SET status='expired', responded_at=now()
     WHERE status='offered' AND offered_at < now() - ($1 || ' minutes')::interval
     RETURNING id, tenant_id, order_id, courier_id, attempt`, [String(TIMEOUT_MIN)]);
  for (const f of rows) {
    await logDecision(f.tenant_id, f.order_id, 'timeout', `הצעה ${f.attempt} פגה אחרי ${TIMEOUT_MIN} דקות ללא מענה`, { courier_id: f.courier_id });
    const r = await dispatchOrder(f.tenant_id, f.order_id, 'timeout');
    if (r.mode === 'offered') await logDecision(f.tenant_id, f.order_id, 'fallback', 'מעבר לשליח הבא אחרי timeout', { attempt: r.attempt, courier_id: r.offer.courier_id });
  }
  return rows.length;
}

// קבלת הצעה: הראשון שמאשר זוכה — העדכון מותנה בכך שההזמנה עדיין ללא שליח
async function acceptOffer(offerId, courierId) {
  const { rows } = await q(
    `UPDATE dispatch_offers SET status='accepted', responded_at=now()
     WHERE id=$1 AND courier_id=$2 AND status='offered'
       AND EXISTS(SELECT 1 FROM orders o WHERE o.id=dispatch_offers.order_id AND o.courier_id IS NULL AND o.status NOT IN ('delivered','cancelled'))
     RETURNING *`, [offerId, courierId]);
  if (!rows[0]) return { mode: 'lost' };
  const f = rows[0];
  await q('UPDATE orders SET courier_id=$1, updated_at=now() WHERE id=$2 AND courier_id IS NULL', [courierId, f.order_id]);
  await q(`UPDATE dispatch_offers SET status='expired', responded_at=now() WHERE order_id=$1 AND id<>$2 AND status='offered'`, [f.order_id, f.id]);
  await logDecision(f.tenant_id, f.order_id, 'accepted', 'השליח אישר את ההצעה', { courier_id: courierId, attempt: f.attempt });
  return { mode: 'accepted', offer: f };
}

// דחיית הצעה: מסומן skipped ומיד מוצע לשליח הבא
async function declineOffer(offerId, courierId, reason) {
  const { rows } = await q(
    `UPDATE dispatch_offers SET status='skipped', responded_at=now()
     WHERE id=$1 AND courier_id=$2 AND status='offered' RETURNING *`, [offerId, courierId]);
  if (!rows[0]) return { mode: 'lost' };
  const f = rows[0];
  await logDecision(f.tenant_id, f.order_id, 'declined', reason || 'השליח דחה את ההצעה', { courier_id: courierId, attempt: f.attempt });
  const r = await dispatchOrder(f.tenant_id, f.order_id, 'decline');
  if (r.mode === 'offered') await logDecision(f.tenant_id, f.order_id, 'fallback', 'מעבר לשליח הבא אחרי דחייה', { attempt: r.attempt, courier_id: r.offer.courier_id });
  return { mode: 'skipped', next: r.mode };
}

let started = false;
function start() {
  if (started) return;
  started = true;
  const scanMs = Math.max(1000, Math.min(60 * 1000, (TIMEOUT_MIN * 60 * 1000) / 2));
  setInterval(() => expireStaleOffers().catch(e => console.error('[dispatch]', e.message)), scanMs).unref();
}

module.exports = { TIMEOUT_MIN, dispatchOrder, expireStaleOffers, acceptOffer, declineOffer, pickCourier, logDecision, start };
