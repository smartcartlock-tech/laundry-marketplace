const express = require('express');
const { q, pool } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');
const { notifyUser } = require('../notify');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);

const FLOW = ['new','confirmed','picked_up','in_work','ready','out_for_delivery','delivered'];

// תור הזמנות חי
r.get('/orders', async (req, res) => {
  const { status } = req.query;
  const params = [req.tenant.id];
  let where = 'WHERE o.tenant_id=$1';
  if (status) { params.push(status); where += ` AND o.status=$${params.length}`; }
  const { rows } = await q(
    `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone,
       EXISTS(SELECT 1 FROM courier_offers co WHERE co.order_id=o.id AND co.status='offered') AS has_open_offer,
       (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty,'price',oi.price)) FROM order_items oi WHERE oi.order_id=o.id) AS items
     FROM orders o JOIN users u ON u.id=o.customer_id ${where} ORDER BY o.created_at DESC LIMIT 200`, params);
  res.json({ orders: rows });
});

// עדכון סטטוס הזמנה (כולל שיבוץ איסוף נקודות בעת השלמה)
r.post('/orders/:id/status', async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, note } = req.body || {};
    if (!FLOW.includes(status) && status !== 'cancelled') return res.status(400).json({ error: 'סטטוס לא חוקי' });
    const { rows: o } = await client.query('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.tenant.id]);
    const order = o[0];
    if (!order) { client.release(); return res.status(404).json({ error: 'הזמנה לא נמצאה' }); }
    const cur = FLOW.indexOf(order.status), nxt = FLOW.indexOf(status);
    if (status !== 'cancelled' && nxt <= cur) { client.release(); return res.status(409).json({ error: 'לא ניתן לחזור אחורה בסטטוס' }); }
    if (['picked_up','out_for_delivery','delivered'].includes(status) && !order.courier_id) {
      client.release(); return res.status(409).json({ error: 'יש לשבץ שליח להזמנה לפני מעבר לסטטוס זה' });
    }
    await client.query('BEGIN');
    await client.query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', [status, order.id]);
    await client.query('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,$2,$3,$4)',
      [order.id, status, req.user.id, note || null]);
    if (status === 'delivered' && order.points_earned > 0) {
      await client.query('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
        [order.tenant_id, order.customer_id, order.points_earned, 'צבירת נקודות מהזמנה', order.id]);
      if (order.payment_method === 'cash') {
        await client.query(`UPDATE orders SET payment_status='paid_cash' WHERE id=$1`, [order.id]);
      }
    }
    await client.query('COMMIT');
    const { rows: cust } = await q('SELECT id, phone FROM users WHERE id=$1', [order.customer_id]);
    if (cust[0]) {
      const HE = { confirmed:'אושרה', picked_up:'נאספה מהבית', in_work:'בעבודה', ready:'מוכנה', out_for_delivery:'בדרך אליך', delivered:'הוחזרה. תודה!', cancelled:'בוטלה' };
      notifyUser(cust[0].id, order.tenant_id, `הזמנתך ב${req.tenant.name} (#${order.id.slice(0,8)}) ${HE[status] || status}.`, cust[0].phone).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// מחירון
r.get('/items', async (req, res) => {
  const { rows } = await q('SELECT * FROM price_items WHERE tenant_id=$1 ORDER BY sort, category, name', [req.tenant.id]);
  res.json({ items: rows });
});
r.post('/items', async (req, res) => {
  const { name, price, category, unit } = req.body || {};
  if (!name || !(Number(price) >= 0)) return res.status(400).json({ error: 'שם ומחיר חובה' });
  const { rows } = await q(
    'INSERT INTO price_items(tenant_id, name, price, category, unit) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.tenant.id, name, price, category || 'כביסה', unit === 'kg' ? 'kg' : 'item']);
  res.status(201).json({ item: rows[0] });
});
r.patch('/items/:id', async (req, res) => {
  const { name, price, category, active } = req.body || {};
  const { rows } = await q(
    `UPDATE price_items SET name=COALESCE($1,name), price=COALESCE($2,price),
       category=COALESCE($3,category), active=COALESCE($4,active)
     WHERE id=$5 AND tenant_id=$6 RETURNING *`,
    [name ?? null, price ?? null, category ?? null, active ?? null, req.params.id, req.tenant.id]);
  if (!rows[0]) return res.status(404).json({ error: 'לא נמצא' });
  res.json({ item: rows[0] });
});
r.delete('/items/:id', async (req, res) => {
  await q('UPDATE price_items SET active=false WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
  res.json({ ok: true });
});

// חלונות איסוף/החזרה
r.get('/windows', async (req, res) => {
  const { rows } = await q('SELECT * FROM pickup_windows WHERE tenant_id=$1 ORDER BY weekday, start_time', [req.tenant.id]);
  res.json({ windows: rows });
});
r.post('/windows', async (req, res) => {
  const { weekday, start_time, end_time, capacity, kind } = req.body || {};
  if (weekday === undefined || !start_time || !end_time) return res.status(400).json({ error: 'יום ושעות חובה' });
  const { rows } = await q(
    'INSERT INTO pickup_windows(tenant_id, weekday, start_time, end_time, capacity, kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.tenant.id, weekday, start_time, end_time, capacity || 10, kind === 'delivery' ? 'delivery' : 'pickup']);
  res.status(201).json({ window: rows[0] });
});
r.delete('/windows/:id', async (req, res) => {
  await q('DELETE FROM pickup_windows WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
  res.json({ ok: true });
});

// הגדרות מכבסה
r.patch('/settings', async (req, res) => {
  const allowed = ['name','phone','address','city','services','hours','terms','delivery_fee','min_order','is_open','lat','lng'];
  const sets = [], params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${k}=$${params.length}`); }
  }
  if (!sets.length) return res.status(400).json({ error: 'אין שדות לעדכון' });
  params.push(req.tenant.id);
  const { rows } = await q(`UPDATE tenants SET ${sets.join(',')} WHERE id=$${params.length} RETURNING *`, params);
  delete rows[0].api_key;
  res.json({ tenant: rows[0] });
});

// דוחות בסיסיים
r.get('/stats', async (req, res) => {
  const tid = req.tenant.id;
  const [byStatus, revenue, customers, top] = await Promise.all([
    q(`SELECT status, count(*)::int AS n FROM orders WHERE tenant_id=$1 GROUP BY status`, [tid]),
    q(`SELECT COALESCE(sum(total),0)::numeric(10,2) AS total, count(*)::int AS orders,
       COALESCE(sum(total) FILTER (WHERE created_at > now() - interval '30 days'),0)::numeric(10,2) AS last30
       FROM orders WHERE tenant_id=$1 AND status <> 'cancelled'`, [tid]),
    q(`SELECT count(DISTINCT customer_id)::int AS customers,
       count(DISTINCT customer_id) FILTER (WHERE cnt.c > 1)::int AS returning
       FROM (SELECT customer_id, count(*) AS c FROM orders WHERE tenant_id=$1 AND status <> 'cancelled' GROUP BY 1) cnt`, [tid]),
    q(`SELECT oi.name, sum(oi.qty)::numeric(8,1) AS qty, sum(oi.qty*oi.price)::numeric(10,2) AS revenue
       FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE o.tenant_id=$1 AND o.status <> 'cancelled' GROUP BY 1 ORDER BY revenue DESC LIMIT 5`, [tid]),
  ]);
  res.json({ byStatus: byStatus.rows, revenue: revenue.rows[0], customers: customers.rows[0], topItems: top.rows });
});

// לקוחות המכבסה
r.get('/customers', async (req, res) => {
  const { rows } = await q(
    `SELECT u.id, u.name, u.phone, count(o.id)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS spent,
       max(o.created_at) AS last_order,
       (SELECT COALESCE(sum(p.delta),0)::int FROM points_ledger p WHERE p.tenant_id=$1 AND p.user_id=u.id) AS points
     FROM orders o JOIN users u ON u.id=o.customer_id
     WHERE o.tenant_id=$1 GROUP BY u.id, u.name, u.phone ORDER BY last_order DESC LIMIT 200`, [req.tenant.id]);
  res.json({ customers: rows });
});

// שליחים של המכבסה + שיבוץ ידני
r.get('/couriers', async (req, res) => {
  const { rows } = await q(
    `SELECT c.id, c.model, c.vehicle, c.areas, c.rating, u.name, u.phone,
       (SELECT count(*)::int FROM orders o WHERE o.courier_id=c.id AND o.status IN ('confirmed','picked_up','ready','out_for_delivery')) AS active_orders
     FROM couriers c JOIN users u ON u.id=c.user_id
     WHERE (c.tenant_id=$1 OR c.model='platform') AND c.approved ORDER BY c.model`, [req.tenant.id]);
  res.json({ couriers: rows });
});
r.post('/orders/:id/assign', async (req, res) => {
  const { courier_id } = req.body || {};
  const { rows: c } = await q(
    `SELECT c.*, u.id AS uid, u.phone FROM couriers c JOIN users u ON u.id=c.user_id
     WHERE c.id=$1 AND c.approved AND (c.tenant_id=$2 OR c.model='platform')`, [courier_id, req.tenant.id]);
  if (!c[0]) return res.status(404).json({ error: 'שליח לא נמצא או לא מאושר' });
  const { rows: o } = await q('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!o[0]) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  if (o[0].courier_id) return res.status(409).json({ error: 'להזמנה כבר שובץ שליח' });
  const { rows: openOff } = await q(`SELECT id FROM courier_offers WHERE order_id=$1 AND status='offered'`, [o[0].id]);
  if (openOff.length) return res.status(409).json({ error: 'כבר קיימת הצעת שיבוץ פתוחה להזמנה זו' });
  // שליח פרטי: שיבוץ מיידי. שליח משותף/פלטפורמה: הצעה לאישור
  if (c[0].model === 'private') {
    await q('UPDATE orders SET courier_id=$1, updated_at=now() WHERE id=$2', [courier_id, o[0].id]);
    await q('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,$2,$3,$4)',
      [o[0].id, o[0].status, req.user.id, 'שובץ שליח מכבסה']);
    notifyUser(c[0].uid, req.tenant.id, `שובצת לאיסוף/החזרה של הזמנה #${o[0].id.slice(0,8)} ב${req.tenant.name}. כתובת: ${o[0].address}`, c[0].phone).catch(() => {});
    return res.json({ ok: true, mode: 'assigned' });
  }
  const { rows: off } = await q(
    `INSERT INTO courier_offers(courier_id, order_id, kind) VALUES ($1,$2,'pickup') RETURNING *`, [courier_id, o[0].id]);
  notifyUser(c[0].uid, req.tenant.id, `הצעת שיבוץ חדשה מהפלטפורמה: הזמנה #${o[0].id.slice(0,8)} ב${req.tenant.name}. אשר/י באפליקציית השליח.`, c[0].phone).catch(() => {});
  res.json({ ok: true, mode: 'offered', offer: off[0] });
});

module.exports = r;
