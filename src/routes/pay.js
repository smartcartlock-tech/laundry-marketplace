// E10.T2: דף תשלום דמו (pay link) — ללא סליקה אמיתית. הקישור הוא ה-capability (uuid בלתי ניחש).
const express = require('express');
const { q } = require('../db');
const { buildReceiptPDF } = require('../receipt');
const { notifyUser } = require('../notify');

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

r.get('/:orderId', async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  const { rows: items } = await q('SELECT name, price, qty FROM order_items WHERE order_id=$1', [order.id]);
  res.json({
    order: {
      id: order.id, short: order.id.slice(0, 8), tenant_name: order.tenant_name,
      status: order.status, payment_status: order.payment_status,
      subtotal: order.subtotal, delivery_fee: order.delivery_fee, discount: order.discount, total: order.total,
      created_at: order.created_at, address: order.address,
    },
    items,
    payable: !['cancelled'].includes(order.status) && order.payment_status === 'pending',
    demo: true,
  });
});

// אישור תשלום דמו — מסמן שולם בלבד, בלי חיוב אמיתי
r.post('/:orderId/confirm', async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  if (order.status === 'cancelled') return res.status(409).json({ error: 'ההזמנה בוטלה' });
  if (order.payment_status !== 'pending') return res.status(409).json({ error: 'ההזמנה כבר שולמה' });
  const last4 = String((req.body || {}).card_last4 || '4242').replace(/\D/g, '').slice(-4);
  await q(`UPDATE orders SET payment_method='demo_online', payment_status='paid_demo', updated_at=now() WHERE id=$1`, [order.id]);
  await q('INSERT INTO order_events(order_id, status, note) VALUES ($1,$2,$3)',
    [order.id, order.status, `שולם בתשלום מקוון (דמו) · כרטיס ****${last4} — ללא סליקה אמיתית`]);
  const { rows: cust } = await q('SELECT id, phone FROM users WHERE id=$1', [order.customer_id]);
  if (cust[0]) notifyUser(cust[0].id, order.tenant_id, `התשלום (דמו) על ₪${order.total} להזמנה #${order.id.slice(0,8)} התקבל. תודה!`, cust[0].phone).catch(() => {});
  res.json({ ok: true, payment_status: 'paid_demo' });
});

// קבלה-סיכום PDF אחרי תשלום (פומבי — הקישור הוא ה-capability)
r.get('/:orderId/receipt.pdf', async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  const [items, cust] = await Promise.all([
    q('SELECT name, price, qty FROM order_items WHERE order_id=$1', [order.id]),
    q('SELECT name, phone, email FROM users WHERE id=$1', [order.customer_id]),
  ]);
  const tenant = { name: order.tenant_name, color: order.color, address: order.tenant_address, city: order.tenant_city, phone: order.tenant_phone };
  const doc = buildReceiptPDF({ order, items: items.rows, tenant, customer: cust[0] || {} });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="receipt-${order.id.slice(0, 8)}.pdf"`);
  doc.pipe(res);
});

module.exports = r;
