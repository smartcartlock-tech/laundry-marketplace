const express = require('express');
const { q } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const r = express.Router();
r.use(requireAuth, requireAdmin);

r.get('/overview', async (req, res) => {
  const [tenants, orders, users, couriers] = await Promise.all([
    q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE approved)::int AS approved,
        count(*) FILTER (WHERE NOT approved)::int AS pending FROM tenants`),
    q(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status NOT IN ('delivered','cancelled'))::int AS active,
        COALESCE(sum(total) FILTER (WHERE status <> 'cancelled'),0)::numeric(10,2) AS gmv FROM orders`),
    q(`SELECT count(*)::int AS total FROM users`),
    q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE approved)::int AS approved,
        count(*) FILTER (WHERE NOT approved)::int AS pending FROM couriers`),
  ]);
  res.json({ tenants: tenants.rows[0], orders: orders.rows[0], users: users.rows[0], couriers: couriers.rows[0] });
});

r.get('/tenants', async (req, res) => {
  const { rows } = await q(
    `SELECT t.id, t.slug, t.name, t.city, t.approved, t.is_open, t.created_at,
       (SELECT count(*)::int FROM orders o WHERE o.tenant_id=t.id) AS orders,
       (SELECT COALESCE(sum(o.total),0)::numeric(10,2) FROM orders o WHERE o.tenant_id=t.id AND o.status<>'cancelled') AS gmv
     FROM tenants t ORDER BY t.approved, t.created_at DESC`, []);
  res.json({ tenants: rows });
});

r.post('/tenants/:id/approve', async (req, res) => {
  await q('UPDATE tenants SET approved=true WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});
r.post('/tenants/:id/suspend', async (req, res) => {
  await q('UPDATE tenants SET approved=false WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

r.get('/couriers', async (req, res) => {
  const { rows } = await q(
    `SELECT c.id, c.model, c.vehicle, c.areas, c.approved, c.rating, c.created_at, u.name, u.phone, t.name AS tenant_name
     FROM couriers c JOIN users u ON u.id=c.user_id LEFT JOIN tenants t ON t.id=c.tenant_id
     ORDER BY c.approved, c.created_at DESC`, []);
  res.json({ couriers: rows });
});
r.post('/couriers/:id/approve', async (req, res) => {
  await q('UPDATE couriers SET approved=true WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});
r.post('/couriers/:id/suspend', async (req, res) => {
  await q('UPDATE couriers SET approved=false WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

r.get('/orders', async (req, res) => {
  const { rows } = await q(
    `SELECT o.id, o.status, o.total, o.created_at, t.name AS tenant_name, u.name AS customer_name
     FROM orders o JOIN tenants t ON t.id=o.tenant_id JOIN users u ON u.id=o.customer_id
     ORDER BY o.created_at DESC LIMIT 100`, []);
  res.json({ orders: rows });
});

// רישום שליח פלטפורמה (על ידי אדמין) או שליח מכבסה (על ידי אדמין לצורך אונבורדינג)
r.post('/couriers/register', async (req, res) => {
  const { phone, name, model, tenant_slug, vehicle, areas } = req.body || {};
  if (!phone || !name) return res.status(400).json({ error: 'טלפון ושם חובה' });
  let p = String(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('0')) p = '+972' + p.slice(1);
  let { rows: u } = await q('SELECT * FROM users WHERE phone=$1', [p]);
  if (!u[0]) u = (await q(`INSERT INTO users(phone, name, role) VALUES ($1,$2,'courier') RETURNING *`, [p, name])).rows;
  else await q(`UPDATE users SET role='courier' WHERE id=$1`, [u[0].id]);
  let tenantId = null;
  if (tenant_slug) {
    const { rows: t } = await q('SELECT id FROM tenants WHERE slug=$1', [tenant_slug]);
    tenantId = t[0]?.id || null;
  }
  const mdl = ['private','shared','platform'].includes(model) ? model : (tenantId ? 'private' : 'platform');
  const { rows: c } = await q(
    'INSERT INTO couriers(user_id, tenant_id, model, vehicle, areas, approved) VALUES ($1,$2,$3,$4,$5,true) RETURNING *',
    [u[0].id, tenantId, mdl, vehicle || null, areas || []]);
  res.status(201).json({ courier: c[0] });
});

module.exports = r;
