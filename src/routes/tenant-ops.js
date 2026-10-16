// C5: סיכום יום תפעולי — נאספו/נמסרו/באיחור היום, חלוקה לפי שליח (נתוני orders + order_events בלבד)
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);

const DAY = `(now() AT TIME ZONE 'Asia/Jerusalem')::date`;

r.get('/ops/daily-summary', async (req, res) => {
  const tid = req.tenant.id;
  const [created, picked, delivered, late, perCourier] = await Promise.all([
    q(`SELECT count(*)::int AS n FROM orders WHERE tenant_id=$1 AND (created_at AT TIME ZONE 'Asia/Jerusalem')::date=${DAY}`, [tid]),
    q(`SELECT count(DISTINCT e.order_id)::int AS n FROM order_events e JOIN orders o ON o.id=e.order_id
       WHERE o.tenant_id=$1 AND e.status='picked_up' AND (e.created_at AT TIME ZONE 'Asia/Jerusalem')::date=${DAY}`, [tid]),
    q(`SELECT count(DISTINCT e.order_id)::int AS n FROM order_events e JOIN orders o ON o.id=e.order_id
       WHERE o.tenant_id=$1 AND e.status='delivered' AND (e.created_at AT TIME ZONE 'Asia/Jerusalem')::date=${DAY}`, [tid]),
    q(`SELECT o.id, o.address, o.status, o.delivery_at, u.name AS customer_name
       FROM orders o JOIN users u ON u.id=o.customer_id
       WHERE o.tenant_id=$1 AND o.delivery_at IS NOT NULL AND o.delivery_at < now()
         AND o.status NOT IN ('delivered','cancelled') ORDER BY o.delivery_at LIMIT 50`, [tid]),
    q(`SELECT c.id, u.name,
         count(DISTINCT e1.order_id)::int AS picked_today,
         count(DISTINCT e2.order_id)::int AS delivered_today,
         count(DISTINCT o.id) FILTER (WHERE o.status NOT IN ('delivered','cancelled'))::int AS active
       FROM couriers c
       JOIN users u ON u.id=c.user_id
       JOIN orders o ON o.courier_id=c.id AND o.tenant_id=$1
       LEFT JOIN order_events e1 ON e1.order_id=o.id AND e1.status='picked_up' AND (e1.created_at AT TIME ZONE 'Asia/Jerusalem')::date=${DAY}
       LEFT JOIN order_events e2 ON e2.order_id=o.id AND e2.status='delivered' AND (e2.created_at AT TIME ZONE 'Asia/Jerusalem')::date=${DAY}
       GROUP BY c.id, u.name ORDER BY delivered_today DESC, picked_today DESC`, [tid]),
  ]);
  res.json({
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }),
    created_today: created.rows[0].n,
    picked_today: picked.rows[0].n,
    delivered_today: delivered.rows[0].n,
    late: late.rows,
    couriers: perCourier.rows,
  });
});

module.exports = r;

/* C1: מצב "עסוק" — השהייה/חידוש קבלת הזמנות */
r.get('/ops/state', async (req, res) => {
  const { rows: t } = await q('SELECT paused_until FROM tenants WHERE id=$1', [req.tenant.id]);
  const { rows: cl } = await q("SELECT to_char(day,'YYYY-MM-DD') AS day, note FROM tenant_closures WHERE tenant_id=$1 ORDER BY day", [req.tenant.id]);
  res.json({ paused_until: t[0].paused_until, closures: cl });
});
r.post('/ops/pause', async (req, res) => {
  const minutes = Math.min(Math.max(Number(req.body && req.body.minutes) || 120, 15), 60 * 24 * 7);
  const { rows } = await q('UPDATE tenants SET paused_until=now()+($2||\' minutes\')::interval WHERE id=$1 RETURNING paused_until', [req.tenant.id, String(minutes)]);
  res.json({ paused_until: rows[0].paused_until });
});
r.post('/ops/resume', async (req, res) => {
  await q('UPDATE tenants SET paused_until=NULL WHERE id=$1', [req.tenant.id]);
  res.json({ ok: true });
});

/* C3: ימי סגירה/חגים */
r.post('/ops/closures', async (req, res) => {
  const { day, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return res.status(400).json({ error: 'תאריך לא תקין (YYYY-MM-DD)' });
  await q('INSERT INTO tenant_closures(tenant_id, day, note) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, day) DO UPDATE SET note=EXCLUDED.note', [req.tenant.id, day, (note || '').slice(0, 120) || null]);
  res.status(201).json({ ok: true });
});
r.delete('/ops/closures/:day', async (req, res) => {
  await q('DELETE FROM tenant_closures WHERE tenant_id=$1 AND day=$2', [req.tenant.id, req.params.day]);
  res.json({ ok: true });
});

/* C1+C3 צד ציבורי: מצב השהייה וימי סגירה (מידע גלוי גם כך — שעות/סגירה) */
const publicRouter = express.Router();
publicRouter.get('/laundry/:slug/ops-state', async (req, res) => {
  const { rows: t } = await q('SELECT paused_until FROM tenants WHERE slug=$1 AND approved', [req.params.slug]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const { rows: cl } = await q("SELECT to_char(c.day,'YYYY-MM-DD') AS day, c.note FROM tenant_closures c JOIN tenants tn ON tn.id=c.tenant_id WHERE tn.slug=$1 AND c.day >= CURRENT_DATE ORDER BY c.day", [req.params.slug]);
  res.json({ paused_until: t[0].paused_until, closures: cl });
});
module.exports.publicRouter = publicRouter;
