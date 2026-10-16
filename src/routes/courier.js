const express = require('express');
const { q, pool } = require('../db');
const { requireAuth, requireCourier } = require('../auth');
const { notifyUser } = require('../notify');

const r = express.Router();
r.use(requireAuth, requireCourier);

// הצעות שיבוץ ממתינות
r.get('/offers', async (req, res) => {
  const { rows } = await q(
    `SELECT f.id AS offer_id, f.kind, f.created_at, o.id AS order_id, o.address, o.pickup_at, o.delivery_at,
            o.status, o.total, t.name AS tenant_name, t.address AS tenant_address, t.city AS tenant_city,
            (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty)) FROM order_items oi WHERE oi.order_id=o.id) AS items
     FROM courier_offers f JOIN orders o ON o.id=f.order_id JOIN tenants t ON t.id=o.tenant_id
     WHERE f.courier_id=$1 AND f.status='offered' ORDER BY f.created_at DESC`, [req.courier.id]);
  res.json({ offers: rows });
});

r.post('/offers/:id/accept', async (req, res) => {
  const { rows } = await q(
    `UPDATE courier_offers SET status='accepted', responded_at=now()
     WHERE id=$1 AND courier_id=$2 AND status='offered' RETURNING *`, [req.params.id, req.courier.id]);
  if (!rows[0]) return res.status(404).json({ error: 'הצעה לא נמצאה או כבר טופלה' });
  await q('UPDATE orders SET courier_id=$1, updated_at=now() WHERE id=$2', [req.courier.id, rows[0].order_id]);
  await q(`UPDATE courier_offers SET status='expired' WHERE order_id=$1 AND id<>$2 AND status='offered'`,
    [rows[0].order_id, rows[0].id]);
  await q('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,(SELECT status FROM orders WHERE id=$1),$2,$3)',
    [rows[0].order_id, req.user.id, 'שליח אישר שיבוץ']);
  res.json({ ok: true });
});

r.post('/offers/:id/decline', async (req, res) => {
  const { rows } = await q(
    `UPDATE courier_offers SET status='declined', responded_at=now()
     WHERE id=$1 AND courier_id=$2 AND status='offered' RETURNING id`, [req.params.id, req.courier.id]);
  if (!rows[0]) return res.status(404).json({ error: 'הצעה לא נמצאה או כבר טופלה' });
  res.json({ ok: true }); // דחייה אינה פוגעת בדירוג (לפי האיפיון)
});

// מסלול היום: כל ההזמנות ששובצו לשליח ועדיין פעילות
r.get('/route', async (req, res) => {
  const { rows } = await q(
    `SELECT o.id, o.status, o.address, o.lat, o.lng, o.pickup_at, o.delivery_at, o.total, o.payment_method,
            t.name AS tenant_name, t.address AS tenant_address, t.lat AS tenant_lat, t.lng AS tenant_lng,
            u.name AS customer_name, u.phone AS customer_phone,
            (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty)) FROM order_items oi WHERE oi.order_id=o.id) AS items
     FROM orders o JOIN tenants t ON t.id=o.tenant_id JOIN users u ON u.id=o.customer_id
     WHERE o.courier_id=$1 AND o.status IN ('confirmed','picked_up','ready','out_for_delivery')
     ORDER BY COALESCE(o.pickup_at, o.created_at)`, [req.courier.id]);
  res.json({ route: rows });
});

// סימון איסוף/מסירה על ידי שליח (עם תמונה אופציונלית)
r.post('/orders/:id/mark', async (req, res) => {
  const { action, photo_url, note } = req.body || {};
  const map = { picked_up: 'picked_up', out_for_delivery: 'out_for_delivery', delivered: 'delivered' };
  const newStatus = map[action];
  if (!newStatus) return res.status(400).json({ error: 'action: picked_up | delivered' });
  const { rows: o } = await q('SELECT * FROM orders WHERE id=$1 AND courier_id=$2', [req.params.id, req.courier.id]);
  const order = o[0];
  if (!order) return res.status(404).json({ error: 'הזמנה לא משובצת אליך' });
  const allowed = { picked_up: ['confirmed'], out_for_delivery: ['ready'], delivered: ['out_for_delivery', 'ready'] };
  if (!allowed[newStatus].includes(order.status)) return res.status(409).json({ error: `לא ניתן לסמן מתוך סטטוס ${order.status}` });
  await q('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', [newStatus, order.id]);
  await q('INSERT INTO order_events(order_id, status, actor_id, note, photo_url) VALUES ($1,$2,$3,$4,$5)',
    [order.id, newStatus, req.user.id, note || null, photo_url || null]);
  if (newStatus === 'delivered' && order.points_earned > 0) {
    await q('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
      [order.tenant_id, order.customer_id, order.points_earned, 'צבירת נקודות מהזמנה', order.id]);
    if (order.payment_method === 'cash') await q(`UPDATE orders SET payment_status='paid_cash' WHERE id=$1`, [order.id]);
  }
  if (newStatus === 'delivered') {
    const { issueDocumentsForOrder } = require('../documents');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: tt } = await client.query('SELECT * FROM tenants WHERE id=$1', [order.tenant_id]);
      const { rows: ord } = await client.query('SELECT * FROM orders WHERE id=$1', [order.id]);
      await issueDocumentsForOrder(client, { tenant: tt[0], order: ord[0], actorId: req.user.id });
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('[documents] issue failed', e.message); }
    finally { client.release(); }
  }
  const { rows: cust } = await q('SELECT id, phone FROM users WHERE id=$1', [order.customer_id]);
  const HE = { picked_up: 'נאספה על ידי השליח', out_for_delivery: 'בדרך אליך', delivered: 'סומנה כהוחזרה. תודה!' };
  if (cust[0]) notifyUser(cust[0].id, order.tenant_id, `הזמנתך (#${order.id.slice(0,8)}) ${HE[newStatus]}.`, cust[0].phone).catch(() => {});
  res.json({ ok: true });
});

// פרופיל שליח + סטטיסטיקה
r.get('/profile', async (req, res) => {
  const { rows: stats } = await q(
    `SELECT count(*) FILTER (WHERE status='delivered')::int AS delivered,
            count(*) FILTER (WHERE status IN ('confirmed','picked_up','ready','out_for_delivery'))::int AS active
     FROM orders WHERE courier_id=$1`, [req.courier.id]);
  res.json({ courier: req.courier, stats: stats[0] });
});

module.exports = r;
