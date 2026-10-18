// T81: שיבוץ שליח אוטומטי (דמו בלבד — אין הודעות אמיתיות).
// כשהזמנה מוכנה לאיסוף המערכת מציעה אותה לשליח פנוי באותו tenant עם timeout,
// נופלת לשליח הבא בדחייה או בפקיעה, ומתעדת כל החלטה ב-dispatch_log.
const { q } = require('./db');

const TIMEOUT_MIN = Math.max(0.01, Number(process.env.DISPATCH_OFFER_TIMEOUT_MIN) || 5);

async function logDecision(tenantId, orderId, decision, reason, payload = {}) {
  await q('INSERT INTO dispatch_log(tenant_id, order_id, decision, reason, payload) VALUES ($1,$2,$3,$4,$5)',
    [tenantId, orderId, decision, reason || null, JSON.stringify(payload)]);
}

// סינון קשיח: רק שליחים מאושרים עם is_online=true — גם ב-fallback. סדר העדפה: שליחי דמו (טלפון דמו +9725000000xx)
// קודם בטנאנט דמו, אז שליחי הטנאנט עצמו, ואז לפי עומס משימות פתוחות, דירוג וותק. שליח שכבר קיבל הצעה להזמנה זו לא מוצע שוב.
const DEMO_PHONES = ['+972500000002', '+972500000003', '+972500000004', '+972500000031'];
async function pickCourier(tenantId, orderId) {
  const { rows } = await q(
    `SELECT c.id, c.model, u.id AS uid, u.phone,
            (SELECT count(*)::int FROM orders o WHERE o.courier_id=c.id AND o.status NOT IN ('delivered','cancelled')) AS load
     FROM couriers c JOIN users u ON u.id=c.user_id
     WHERE c.approved AND c.is_online AND (c.tenant_id=$1 OR c.model IN ('platform','shared'))
       AND NOT EXISTS (SELECT 1 FROM dispatch_offers f WHERE f.order_id=$2 AND f.courier_id=c.id)
     ORDER BY CASE WHEN u.phone = ANY($3) THEN 0 ELSE 1 END, CASE WHEN c.tenant_id=$1 THEN 0 ELSE 1 END, load ASC, c.rating DESC, c.created_at ASC`, [tenantId, orderId, DEMO_PHONES]);
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
  // T109: תגמול משוער (תעריף לנקודה × איסוף+מסירה) ומרחק מכבסה→לקוח — נשמרים על ההצעה עצמה
  const { haversineKm, getSetting } = require('./routes-engine');
  const { rows: t } = await q('SELECT id, name, lat, lng FROM tenants WHERE id=$1', [tenantId]);
  const rate = Number(await getSetting('courier_rate_per_stop', '12'));
  const payoutEstimate = Number.isFinite(rate) ? Math.round(rate * 2) : null;
  const tenant = t[0] || null;
  let distanceKm = null;
  if (tenant && tenant.lat != null && tenant.lng != null && order.lat != null && order.lng != null) {
    distanceKm = Math.round(haversineKm({ lat: Number(tenant.lat), lng: Number(tenant.lng) }, { lat: Number(order.lat), lng: Number(order.lng) }) * 10) / 10;
  }
  const { rows: off } = await q(
    'INSERT INTO dispatch_offers(tenant_id, order_id, courier_id, attempt, payout_estimate, distance_km) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [tenantId, orderId, chosen.id, attempt, payoutEstimate, distanceKm]);
  await logDecision(tenantId, orderId, 'offered', `הצעה מספר ${attempt} נשלחה לשליח`, { trigger, courier_id: chosen.id, load: chosen.load, candidates: candidates.length, payout_estimate: payoutEstimate, distance_km: distanceKm });
  if (tenant) notifyOffer({ id: chosen.uid, phone: chosen.phone }, tenant, order, { payoutEstimate, distanceKm }).catch(() => {}); // מדומה בסביבת דמו
  return { mode: 'offered', offer: off[0], attempt };
}

// T109: הודעת הצעת שיבוץ עשירה — תגמול ₪ משוער + מרחק + חלון איסוף, עם קישור ישיר למשימה
// (קישור ב-data של ההודעה במרכז ההודעות + deep-link ב-push). מכבד השתקות (סטטוסים/שבת) כמו notifyUser.
async function notifyOffer(courierUser, tenant, order, estimate) {
  if (!courierUser || !courierUser.id) return;
  const { statusMuted } = require('./notification-prefs');
  const { shabbatMuted } = require('./shabbat');
  const { renderTemplateByKey, postOrderMessage } = require('./usermessages');
  const { sendPushToUser } = require('./push');
  const { sendWhatsApp } = require('./notify');
  const url = './#/courier/day';
  const t = await renderTemplateByKey('courier_new_task', {
    'סוג': 'הצעת שיבוץ חדשה מהפלטפורמה — אשר/י באפליקציית השליח',
    'קוד': order.tracking_code || String(order.id).slice(0, 8),
    'מכבסה': tenant.name, 'כתובת': order.address,
  });
  const title = t ? t.title : 'הצעת שיבוץ חדשה';
  const base = t ? t.body : `משימה חדשה: הזמנה ${order.tracking_code || order.id} ב${tenant.name}. כתובת: ${order.address}`;
  const extras = [
    estimate.payoutEstimate != null ? `תגמול משוער: ₪${estimate.payoutEstimate}` : null,
    estimate.distanceKm != null ? `מרחק: ${estimate.distanceKm} ק"מ` : null,
  ].filter(Boolean).join(' · ');
  const body = extras ? `${base}\n${extras}` : base;
  if (await statusMuted(courierUser.id)) {
    await q('INSERT INTO notifications(user_id, tenant_id, channel, body, sent) VALUES ($1,$2,$3,$4,$5)', [courierUser.id, tenant.id, 'muted', body, false]).catch(() => {});
    return;
  }
  if (await shabbatMuted(courierUser.id)) {
    await q('INSERT INTO notifications(user_id, tenant_id, channel, body, sent) VALUES ($1,$2,$3,$4,$5)', [courierUser.id, tenant.id, 'shabbat-muted', body, false]).catch(() => {});
    return;
  }
  let sent = false, channel = 'log';
  try { const p = await sendPushToUser(courierUser.id, { title, body, url }); if (p.sent > 0) { sent = true; channel = 'push'; } } catch (e) {}
  if (!sent && courierUser.phone) {
    const r = await sendWhatsApp(courierUser.phone, body);
    if (r.sent || r.via === 'bot-simulated') { sent = true; channel = 'whatsapp'; }
  }
  await q('INSERT INTO notifications(user_id, tenant_id, channel, body, sent) VALUES ($1,$2,$3,$4,$5)',
    [courierUser.id, tenant.id, channel, body, sent]).catch(() => {});
  await postOrderMessage(courierUser.id, { tenantId: tenant.id, kind: 'order', title, body, data: { url: '#/courier/day' } }).catch(() => {});
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

module.exports = { TIMEOUT_MIN, DEMO_PHONES, dispatchOrder, expireStaleOffers, acceptOffer, declineOffer, pickCourier, logDecision, notifyOffer, start };
