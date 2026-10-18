// E10.T2: דף תשלום דמו (pay link) — ללא סליקה אמיתית. הקישור הוא ה-capability (uuid בלתי ניחש).
const express = require('express');
const { q, pool } = require('../db');
const { buildReceiptPDF } = require('../receipt');
const { notifyUser } = require('../notify');
const { uuidParams } = require('../validate');

const r = express.Router();

// A2: תשלום דמו כבוי במצב pilot — לא מסמנים "שולם" על כסף שלא שולם
r.use((req, res, next) => {
  if (require('../config').isPilot) return res.status(403).json({ error: 'תשלום מקוון (דמו) כבוי במצב פיילוט' });
  next();
});

async function loadOrder(req, res) {
  const { rows: o } = await q(
    `SELECT o.*, t.name AS tenant_name, t.color, t.address AS tenant_address, t.city AS tenant_city, t.phone AS tenant_phone
     FROM orders o JOIN tenants t ON t.id=o.tenant_id WHERE o.id=$1`, [req.params.orderId]);
  if (!o[0]) { res.status(404).json({ error: 'הזמנה לא נמצאה' }); return null; }
  return o[0];
}

r.get('/:orderId', uuidParams('orderId'), async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  const { rows: items } = await q('SELECT name, price, qty FROM order_items WHERE order_id=$1', [order.id]);
  res.json({
    order: {
      id: order.id, short: order.id.slice(0, 8), tenant_name: order.tenant_name,
      status: order.status, payment_status: order.payment_status,
      subtotal: order.subtotal, delivery_fee: order.delivery_fee, discount: order.discount, total: order.total,
      created_at: order.created_at,
    },
    items,
    payable: !['cancelled'].includes(order.status) && order.payment_status === 'pending',
    demo: true,
  });
});

// אישור תשלום דמו — מסמן שולם בלבד, בלי חיוב אמיתי
r.post('/:orderId/confirm', uuidParams('orderId'), async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  if (order.status === 'cancelled') return res.status(409).json({ error: 'ההזמנה בוטלה' });
  if (order.payment_status !== 'pending') return res.status(409).json({ error: 'ההזמנה כבר שולמה' });
  const last4 = String((req.body || {}).card_last4 || '4242').replace(/\D/g, '').slice(-4);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: locked } = await client.query('SELECT * FROM orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [order.tenant_id, order.id]);
    if (locked[0].status === 'cancelled' || locked[0].payment_status !== 'pending') {
      await client.query('ROLLBACK'); return res.status(409).json({error:'ההזמנה בוטלה או שולמה'});
    }
    const {rows: paid} = await client.query(`UPDATE orders SET payment_method='demo_online', payment_status='paid_demo', updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [order.tenant_id, order.id]);
    await client.query('INSERT INTO order_events(order_id, status, note) VALUES ($1,$2,$3)',
      [order.id, order.status, `שולם בתשלום מקוון (דמו) · כרטיס ****${last4} — ללא סליקה אמיתית`]);
    const {rows: tenants} = await client.query('SELECT * FROM tenants WHERE id=$1', [order.tenant_id]);
    await require('../documents').issueDocumentsForOrder(client, {tenant:tenants[0],order:paid[0]});
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK'); console.error(e); return res.status(e.status || 500).json({error:e.error || 'שגיאת שרת'});
  } finally { client.release(); }
  const { rows: cust } = await q('SELECT id, phone FROM users WHERE id=$1', [order.customer_id]);
  if (cust[0]) notifyUser(cust[0].id, order.tenant_id, `התשלום (דמו) על ₪${order.total} להזמנה #${order.id.slice(0,8)} התקבל. תודה!`, cust[0].phone).catch(() => {});
  res.json({ ok: true, payment_status: 'paid_demo' });
});

// B5: אימות קצר (4 ספרות אחרונות של טלפון הלקוח) — רק אחריו נחשפים כתובת/טלפון.
// מוגבל בקצב לכל הזמנה כדי למנוע ניחוש brute-force של הקוד.
const { limiter } = require('../ratelimit');
const last4Of = (phone) => String(phone || '').replace(/\D/g, '').slice(-4);
async function verified(req, order) {
  const code = String((req.body && req.body.phone_last4) || req.query.v || '').replace(/\D/g, '');
  if (!code) return false;
  const { rows } = await q('SELECT phone FROM users WHERE id=$1', [order.customer_id]);
  return !!rows[0] && code.length === 4 && code === last4Of(rows[0].phone);
}

r.post('/:orderId/verify', uuidParams('orderId'), limiter('pay-verify', 10, 10 * 60 * 1000, req => req.params.orderId), async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  if (!(await verified(req, order))) return res.status(401).json({ error: 'קוד האימות שגוי' });
  const { rows: cust } = await q('SELECT phone FROM users WHERE id=$1', [order.customer_id]);
  res.json({ ok: true, address: order.address, phone: cust[0] ? cust[0].phone : null });
});

// קבלה-סיכום PDF אחרי תשלום (פומבי — הקישור הוא ה-capability).
// B5: בלי קוד אימות תקין (?v=1234) הקבלה ממוסכת — סכומים ומספר הזמנה בלבד, בלי PII של הלקוח.
r.get('/:orderId/receipt.pdf', uuidParams('orderId'), async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  const ok = await verified(req, order);
  const [items, cust] = await Promise.all([
    q('SELECT name, price, qty FROM order_items WHERE order_id=$1', [order.id]),
    ok ? q('SELECT name, phone, email FROM users WHERE id=$1', [order.customer_id]) : Promise.resolve({ rows: [{}] }),
  ]);
  const safeOrder = ok ? order : { ...order, address: 'מוסתר — לצפייה יש לאמת עם 4 הספרות האחרונות של הטלפון' };
  const tenant = { name: order.tenant_name, color: order.color, address: order.tenant_address, city: order.tenant_city, phone: order.tenant_phone };
  const doc = buildReceiptPDF({ order: safeOrder, items: items.rows, tenant, customer: cust.rows[0] || {} });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="receipt-${order.id.slice(0, 8)}.pdf"`);
  doc.pipe(res);
});

module.exports = r;
