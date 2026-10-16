const express = require('express');
const { q, pool } = require('../db');
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

// פרטי מכבסה מלאים לסקירת אדמין לפני אישור/דחייה
r.get('/tenants/:id', async (req, res) => {
  const { rows: t } = await q('SELECT id, slug, name, letter, phone, address, city, services, hours, terms, delivery_fee, min_order, approved, is_open, created_at FROM tenants WHERE id=$1', [req.params.id]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const [items, windows, members, orders] = await Promise.all([
    q('SELECT name, category, price, unit, active FROM price_items WHERE tenant_id=$1 ORDER BY sort, name', [t[0].id]),
    q('SELECT weekday, start_time, end_time, kind, capacity FROM pickup_windows WHERE tenant_id=$1 ORDER BY weekday, start_time', [t[0].id]),
    q(`SELECT u.name, u.phone, m.role FROM tenant_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1`, [t[0].id]),
    q('SELECT count(*)::int AS n FROM orders WHERE tenant_id=$1', [t[0].id]),
  ]);
  res.json({ tenant: t[0], items: items.rows, windows: windows.rows, members: members.rows, orders: orders.rows[0].n });
});

// דחייה: מחיקת מכבסה שלא אושרה (רק אם אין לה הזמנות)
r.post('/tenants/:id/reject', async (req, res) => {
  const { rows: t } = await q('SELECT id, name, approved FROM tenants WHERE id=$1', [req.params.id]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const { rows: oc } = await q('SELECT count(*)::int AS n FROM orders WHERE tenant_id=$1', [t[0].id]);
  if (oc[0].n > 0) return res.status(409).json({ error: 'למכבסה יש הזמנות — ניתן להשעות אבל לא למחוק' });
  await q('DELETE FROM points_ledger WHERE tenant_id=$1', [t[0].id]);
  await q('DELETE FROM price_items WHERE tenant_id=$1', [t[0].id]);
  await q('DELETE FROM pickup_windows WHERE tenant_id=$1', [t[0].id]);
  await q('DELETE FROM tenant_members WHERE tenant_id=$1', [t[0].id]);
  await q('DELETE FROM couriers WHERE tenant_id=$1', [t[0].id]);
  await q('DELETE FROM tenants WHERE id=$1', [t[0].id]);
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


// QA2.T9: מחיקת משתמש בדיקה יתום (כולל ההזמנות שלו) — לא חסימת מכבסות מאושרות בבעלותו
r.delete('/users/:phone', async (req, res) => {
  const phone = String(req.params.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'חסר טלפון' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: u } = await client.query('SELECT * FROM users WHERE phone=$1', [phone]);
    if (!u[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'משתמש לא נמצא' }); }
    const uid = u[0].id;
    const { rows: owned } = await client.query(
      `SELECT t.slug FROM tenant_members m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.role='owner' AND t.approved`, [uid]);
    if (owned.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'המשתמש בעלים של מכבסה מאושרת (' + owned.map(x => x.slug).join(', ') + ') — לא נמחק' }); }
    const { rows: orderIds } = await client.query('SELECT id FROM orders WHERE customer_id=$1', [uid]);
    const ids = orderIds.map(x => x.id);
    if (ids.length) {
      await client.query('DELETE FROM order_items WHERE order_id = ANY($1)', [ids]);
      await client.query('DELETE FROM order_events WHERE order_id = ANY($1)', [ids]);
      await client.query('DELETE FROM courier_offers WHERE order_id = ANY($1)', [ids]);
      await client.query('DELETE FROM points_ledger WHERE order_id = ANY($1)', [ids]);
      await client.query('DELETE FROM notifications WHERE order_id = ANY($1)', [ids]).catch(() => {});
      await client.query('DELETE FROM orders WHERE id = ANY($1)', [ids]);
    }
    await client.query('DELETE FROM points_ledger WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM reviews WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM notifications WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM tenant_members WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM otp_codes WHERE target=$1', [phone]).catch(() => {});
    await client.query('DELETE FROM users WHERE id=$1', [uid]);
    await client.query('COMMIT');
    res.json({ ok: true, deleted_orders: ids.length });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// QA2.T9: ניקוי הזמנות בדיקה מבוטלות (כתובת מכילה "בדיק"/"דמו") לפי מכבסה
r.post('/orders/purge-test', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: idsRows } = await client.query(
      `SELECT id FROM orders WHERE status='cancelled' AND (address ILIKE '%בדיק%' OR address ILIKE '%דמו%' OR notes ILIKE '%בדיק%')`);
    const ids = idsRows.map(x => x.id);
    if (ids.length) {
      await client.query('DELETE FROM order_items WHERE order_id = ANY($1)', [ids]);
      await client.query('DELETE FROM order_events WHERE order_id = ANY($1)', [ids]);
      await client.query('DELETE FROM courier_offers WHERE order_id = ANY($1)', [ids]);
      await client.query('UPDATE points_ledger SET order_id=NULL WHERE order_id = ANY($1)', [ids]);
      await client.query('UPDATE reviews SET order_id=NULL WHERE order_id = ANY($1)', [ids]);
      await client.query('DELETE FROM orders WHERE id = ANY($1)', [ids]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, purged: ids.length });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

module.exports = r;
