// API לבוט הוואטסאפ של CleanShop — אותן הזמנות, אותו סטטוס, אותו מועדון.
const express = require('express');
const { q, pool } = require('../db');
const { notifyUser } = require('../notify');

const r = express.Router();

async function botAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'missing api key' });
  const { rows } = await q('SELECT * FROM tenants WHERE api_key=$1 AND approved', [key]);
  if (!rows[0]) return res.status(401).json({ error: 'invalid api key' });
  req.tenant = rows[0];
  next();
}
r.use(botAuth);

r.get('/pricelist', async (req, res) => {
  const { rows } = await q('SELECT id, name, category, price, unit FROM price_items WHERE tenant_id=$1 AND active ORDER BY sort, name', [req.tenant.id]);
  res.json({ tenant: { slug: req.tenant.slug, name: req.tenant.name, delivery_fee: req.tenant.delivery_fee, min_order: req.tenant.min_order }, items: rows });
});

r.get('/windows', async (req, res) => {
  const { rows } = await q('SELECT weekday, start_time, end_time, capacity, kind FROM pickup_windows WHERE tenant_id=$1 ORDER BY weekday, start_time', [req.tenant.id]);
  res.json({ windows: rows });
});

// יצירת הזמנה מהבוט — לקוח מזוהה לפי טלפון
r.post('/orders', async (req, res) => {
  const client = await pool.connect();
  try {
    const { phone, name, items, address, pickup_at, notes } = req.body || {};
    if (!phone || !Array.isArray(items) || !items.length || !address) return res.status(400).json({ error: 'phone, items, address required' });
    let p = String(phone).replace(/[^\d+]/g, '');
    if (p.startsWith('0')) p = '+972' + p.slice(1);
    let { rows: u } = await client.query('SELECT * FROM users WHERE phone=$1', [p]);
    if (!u[0]) u = (await client.query('INSERT INTO users(phone, name) VALUES ($1,$2) RETURNING *', [p, name || null])).rows;
    const user = u[0];
    const ids = items.map(i => i.item_id);
    const { rows: dbItems } = await client.query('SELECT * FROM price_items WHERE tenant_id=$1 AND active AND id = ANY($2)', [req.tenant.id, ids]);
    let subtotal = 0; const lines = [];
    for (const it of items) {
      const db = dbItems.find(d => d.id === it.item_id);
      if (!db) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'unknown item ' + it.item_id }); }
      const qty = Number(it.qty) || 1;
      subtotal += Number(db.price) * qty;
      lines.push({ item_id: db.id, name: db.name, price: db.price, qty });
    }
    const fee = Number(req.tenant.delivery_fee) || 0;
    const total = subtotal + fee;
    const points = Math.floor(total * Number(req.tenant.points_earn_rate || 0));
    const { rows: o } = await client.query(
      `INSERT INTO orders(tenant_id, customer_id, source, address, pickup_at, subtotal, delivery_fee, total, points_earned, notes)
       VALUES ($1,$2,'bot',$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.tenant.id, user.id, address, pickup_at || null, subtotal, fee, total, points, notes || null]);
    for (const ln of lines) {
      await client.query('INSERT INTO order_items(order_id, item_id, name, price, qty) VALUES ($1,$2,$3,$4,$5)',
        [o[0].id, ln.item_id, ln.name, ln.price, ln.qty]);
    }
    await client.query(`INSERT INTO order_events(order_id, status, note) VALUES ($1,'new','הזמנה מהבוט')`, [o[0].id]);
    await client.query('COMMIT');
    notifyUser(user.id, req.tenant.id, `הזמנתך ב${req.tenant.name} התקבלה (#${o[0].id.slice(0,8)}) — סה״כ ₪${total}.`, user.phone).catch(() => {});
    res.status(201).json({ order_id: o[0].id, total, points_earned: points });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); res.status(500).json({ error: 'server error' });
  } finally { client.release(); }
});

r.get('/orders/:id', async (req, res) => {
  const { rows } = await q(
    `SELECT o.id, o.status, o.total, o.pickup_at, o.delivery_at, o.created_at FROM orders o
     WHERE o.id=$1 AND o.tenant_id=$2`, [req.params.id, req.tenant.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json({ order: rows[0] });
});

// סטטוס אחרון ללקוח לפי טלפון (לשימוש הבוט בשאלת "מה נשמע ההזמנה שלי")
r.get('/customers/:phone/latest-order', async (req, res) => {
  let p = String(req.params.phone).replace(/[^\d+]/g, '');
  if (p.startsWith('0')) p = '+972' + p.slice(1);
  const { rows } = await q(
    `SELECT o.id, o.status, o.total, o.created_at FROM orders o JOIN users u ON u.id=o.customer_id
     WHERE o.tenant_id=$1 AND u.phone=$2 ORDER BY o.created_at DESC LIMIT 1`, [req.tenant.id, p]);
  res.json({ order: rows[0] || null });
});

module.exports = r;
