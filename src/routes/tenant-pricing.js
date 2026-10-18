// T121: שקילה/עדכון מחיר על ידי הבעלים — נכנס כהצעה שמחכה לאישור הלקוח לפני גבייה.
// החיוב מתעדכן רק אחרי שהלקוח מאשר (ראו orders.js /:id/price-update/respond).
const express = require('express');
const { q, pool } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');
const { notifyUser } = require('../notify');
const { uuidParams } = require('../validate');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);
r.use(require('../ratelimit').writeLimiter('tenant-write', 90));

r.post('/orders/:id/weight-update', uuidParams('id'), async (req, res) => {
  const lines = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  const note = String((req.body && req.body.note) || '').trim() || null;
  if (!lines.length) return res.status(400).json({ error: 'חסרים פריטים לעדכון' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: o } = await client.query('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.tenant.id]);
    const order = o[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'הזמנה לא נמצאה' }); }
    if (!['picked_up', 'in_work', 'ready'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'עדכון שקילה אפשרי רק אחרי איסוף ולפני יציאה למסירה' });
    }
    if (order.price_update && order.price_update.status === 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'כבר ממתין עדכון מחיר לאישור הלקוח' });
    }
    const { rows: cur } = await client.query('SELECT item_id, name, price, qty FROM order_items WHERE order_id=$1', [order.id]);
    const items = [];
    let subtotal = 0;
    for (const ln of lines) {
      const src = cur.find(c => c.item_id === ln.item_id);
      if (!src) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'פריט לא נמצא בהזמנה: ' + (ln.item_id || '') }); }
      const qty = Number(ln.qty);
      if (!(qty >= 0) || qty > 500) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'כמות לא תקינה עבור ' + src.name }); }
      if (qty === 0) continue; // פריט שהוסר בשקילה
      items.push({ item_id: src.item_id, name: src.name, price: Number(src.price), qty });
      subtotal += Number(src.price) * qty;
    }
    if (!items.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'לא ניתן לעדכן להזמנה ללא פריטים — השתמשו בביטול' }); }
    subtotal = +subtotal.toFixed(2);
    const total = Math.max(0, +(subtotal + Number(order.delivery_fee || 0) - Number(order.discount || 0)).toFixed(2));
    if (total === Number(order.total)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'הסכום לא השתנה — אין צורך בעדכון' }); }
    const pu = { from_total: Number(order.total), to_total: total, items, note, status: 'pending', requested_at: new Date().toISOString() };
    await client.query('UPDATE orders SET price_update=$1, updated_at=now() WHERE id=$2', [JSON.stringify(pu), order.id]);
    await client.query('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,$2,$3,$4)',
      [order.id, order.status, req.user.id, `עדכון שקילה: ₪${pu.from_total} → ₪${total} — ממתין לאישור הלקוח`]);
    await client.query('COMMIT');
    const { rows: cust } = await q('SELECT id, phone FROM users WHERE id=$1', [order.customer_id]);
    if (cust[0]) {
      notifyUser(cust[0].id, order.tenant_id,
        `עדכון מחיר אחרי שקילה בהזמנתך (#${order.id.slice(0, 8)}): ₪${pu.from_total} → ₪${total}${note ? ' — ' + note : ''}. נא לאשר במעקב ההזמנה.`,
        cust[0].phone, 'עדכון מחיר לאישור', { url: './#/orders/' + order.id }).catch(() => {});
    }
    res.json({ ok: true, price_update: pu });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
});

module.exports = r;
