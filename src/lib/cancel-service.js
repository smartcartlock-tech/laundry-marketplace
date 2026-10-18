// T11: שירות ביטול משותף לכל נתיבי הביטול (אפליקציה, בוט) — אותן החזרות (נקודות/קופון/מכסת מנוי)
// ואותה התראה לבעלי המכבסה (T10). נתיב הביטול של בעל המכבסה (tenant.js) נשאר כפי שהוא — מחוץ לטווח המשימה.
const { pool } = require('../db');
const { restoreBags } = require('../subscriptions');
const { notifyUser } = require('../notify');
const { renderTemplateByKey } = require('../usermessages');

// מבטל הזמנה עם נעילת שורה ואילוץ סטטוס אופטימי (מנצח אחד בלבד במרוץ).
// מחזיר { ok:true, order, refunds } או { error, status } בלי לזרוק.
async function cancelOrder({ orderId, tenantId = null, actorId = null, note = 'בוטלה על ידי הלקוח', allowedStatuses = ['new', 'confirmed'], notifyLaundry = true }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT o.*, t.name AS tenant_name, t.slug AS tenant_slug FROM orders o JOIN tenants t ON t.id=o.tenant_id
       WHERE o.id=$1 ${tenantId ? 'AND o.tenant_id=$2' : ''} FOR UPDATE`,
      tenantId ? [orderId, tenantId] : [orderId]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return { error: 'הזמנה לא נמצאה', status: 404 }; }
    if (!allowedStatuses.includes(order.status)) { await client.query('ROLLBACK'); return { error: 'לא ניתן לבטל לאחר איסוף', status: 409 }; }

    await client.query(`UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1`, [order.id]);
    await client.query(`INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,'cancelled',$2,$3)`, [order.id, actorId, note]);

    // החזרות — זהות בכל הנתיבים
    const refunds = await applyCancelRefunds(client, order);
    await client.query('COMMIT');

    // T10: התראה לבעלי/צוות המכבסה — קוד מעקב + פירוט החזרים (push + מרכז הודעות דרך notifyUser)
    if (notifyLaundry) notifyLaundryCancelled(order, refunds).catch(() => {});
    // T24: אישור ביטול בכתב ללקוח — נשאר במרכז ההודעות גם אחרי שהטוסט נעלם
    notifyCustomerCancelled(order, refunds).catch(() => {});
    return { ok: true, order, refunds };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[cancel-service]', e);
    return { error: 'שגיאת שרת', status: 500 };
  } finally { client.release(); }
}

// החזרות ביטול בתוך טרנזקציה פתוחה (client חיצוני) — משמש גם את נתיב ביטול הבעלים ב-tenant.js (T11 המשך)
async function applyCancelRefunds(client, order) {
  const credits = await require('../documents').refundCancelledOrder(client,order); // T98: documents + simulated refund, no provider

  const refunds = { points: 0, coupon: false, bags: false, demo_document_credits: credits.map(d=>d.id) };
  if (Number(order.points_redeemed) > 0) {
    await client.query('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
      [order.tenant_id, order.customer_id, Number(order.points_redeemed), 'החזר נקודות בעקבות ביטול הזמנה', order.id]);
    refunds.points = Number(order.points_redeemed);
  }
  if (order.coupon_id) {
    await client.query('UPDATE coupons SET used_count = GREATEST(0, used_count - 1) WHERE id=$1', [order.coupon_id]);
    refunds.coupon = true;
  }
  if (order.subscription_id) {
    await restoreBags(client, order.id);
    refunds.bags = true;
  }
  return refunds;
}

function refundsHe(refunds) {
  const parts = [];
  if (refunds.points > 0) parts.push(`הוחזרו ${refunds.points} נקודות`);
  if (refunds.coupon) parts.push('הקופון שוחרר');
  if (refunds.bags) parts.push('מכסת המנוי שוחזרה');
  return parts.length ? parts.join(' · ') : 'אין החזרים';
}

async function notifyLaundryCancelled(order, refunds) {
  const { q } = require('../db');
  const { rows: members } = await q(
    'SELECT u.id, u.phone FROM tenant_members tm JOIN users u ON u.id = tm.user_id WHERE tm.tenant_id=$1', [order.tenant_id]);
  if (!members.length) return;
  const { rows: cust } = await q('SELECT name FROM users WHERE id=$1', [order.customer_id]);
  const code = order.tracking_code || String(order.id).slice(0, 8);
  const vars = { 'קוד': code, 'לקוח': (cust[0] && cust[0].name) || 'לקוח/ה', 'סכום': order.total, 'החזרים': refundsHe(refunds) };
  const t = await renderTemplateByKey('laundry_order_cancelled', vars);
  const body = t ? t.body : `הזמנה ${code} בוטלה על ידי ${vars['לקוח']} — ${vars['החזרים']}.`;
  for (const m of members) await notifyUser(m.id, order.tenant_id, body, m.phone, t ? t.title : undefined);
}

async function notifyCustomerCancelled(order, refunds) {
  const { q } = require('../db');
  const { rows: cust } = await q('SELECT id, phone FROM users WHERE id=$1', [order.customer_id]);
  if (!cust[0]) return;
  const code = order.tracking_code || String(order.id).slice(0, 8);
  const vars = { 'קוד': code, 'מכבסה': order.tenant_name || '', 'החזרים': refundsHe(refunds) };
  const t = await renderTemplateByKey('customer_order_cancelled', vars);
  const body = t ? t.body : `ביטלת את ההזמנה ${code}. ${vars['החזרים']}.`;
  await notifyUser(cust[0].id, order.tenant_id, body, cust[0].phone, t ? t.title : undefined);
}

module.exports = { cancelOrder, applyCancelRefunds, refundsHe };
