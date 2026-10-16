// דוחות וניתוח: הכנסות ליום, הזמנות לפי שירות, לקוחות חוזרים, ייצוא CSV.
// נתיבים: /api/t/:slug/analytics[.csv] (מכבסה) · /api/admin/analytics[.csv] (אדמין, אופציונלי ?tenant=slug)
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireAdmin, requireTenantMember } = require('../auth');
const { sendCsv } = require('../csv');

const TZ = 'Asia/Jerusalem';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// טווח: ?days=N (1-366) או ?from=YYYY-MM-DD&to=YYYY-MM-DD (כולל). ברירת מחדל: 30 ימים אחרונים.
function parseRange(query) {
  const day = d => d.toISOString().slice(0, 10);
  const today = new Date();
  let to = ISO.test(query.to || '') ? new Date(query.to + 'T00:00:00Z') : new Date(day(today) + 'T00:00:00Z');
  let from;
  if (ISO.test(query.from || '')) from = new Date(query.from + 'T00:00:00Z');
  else {
    const days = Math.min(366, Math.max(1, parseInt(query.days, 10) || 30));
    from = new Date(to.getTime() - (days - 1) * 86400000);
  }
  if (isNaN(from) || isNaN(to) || from > to) return null;
  if ((to - from) / 86400000 > 366) return null;
  return { from: day(from), to: day(to) };
}

async function buildAnalytics(tenantId, range) {
  // סינון: הזמנות שנוצרו בטווח (לפי יום ישראלי), ללא בוטלו. tenantId=null → כל הפלטפורמה.
  const base = `o.status <> 'cancelled' AND ($1::uuid IS NULL OR o.tenant_id=$1)
    AND (o.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date`;
  const p = [tenantId, range.from, range.to];
  const [daily, services, totals, cancelled, cust, top, tenants] = await Promise.all([
    q(`SELECT to_char((o.created_at AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') AS day, count(*)::int AS orders,
         COALESCE(sum(o.total),0)::numeric(10,2) AS revenue
       FROM orders o WHERE ${base} GROUP BY 1 ORDER BY 1`, p),
    q(`SELECT COALESCE(NULLIF(pi.category,''),'אחר') AS service, count(DISTINCT o.id)::int AS orders,
         COALESCE(sum(oi.qty),0)::numeric(10,1) AS qty, COALESCE(sum(oi.qty*oi.price),0)::numeric(10,2) AS revenue
       FROM orders o JOIN order_items oi ON oi.order_id=o.id LEFT JOIN price_items pi ON pi.id=oi.item_id
       WHERE ${base} GROUP BY 1 ORDER BY revenue DESC`, p),
    q(`SELECT count(*)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS revenue,
         COALESCE(avg(o.total),0)::numeric(10,2) AS avg_order FROM orders o WHERE ${base}`, p),
    q(`SELECT count(*)::int AS n FROM orders o WHERE o.status='cancelled' AND ($1::uuid IS NULL OR o.tenant_id=$1)
       AND (o.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date`, p),
    // לקוח "חוזר" = יש לו הזמנה קודמת (לפני תחילת הטווח) או יותר מהזמנה אחת בטווח. לפי מכבסה (או פלטפורמה).
    q(`WITH rng AS (
         SELECT o.customer_id, count(*) AS c, sum(o.total) AS spent FROM orders o WHERE ${base} GROUP BY 1),
       prev AS (
         SELECT DISTINCT o.customer_id FROM orders o WHERE o.status <> 'cancelled' AND ($1::uuid IS NULL OR o.tenant_id=$1)
           AND (o.created_at AT TIME ZONE '${TZ}')::date < $2::date)
       SELECT count(*)::int AS customers,
         count(*) FILTER (WHERE rng.c > 1 OR prev.customer_id IS NOT NULL)::int AS returning,
         COALESCE(sum(rng.spent) FILTER (WHERE rng.c > 1 OR prev.customer_id IS NOT NULL),0)::numeric(10,2) AS returning_revenue
       FROM rng LEFT JOIN prev ON prev.customer_id = rng.customer_id`, p),
    q(`SELECT u.name, count(*)::int AS orders, sum(o.total)::numeric(10,2) AS spent
       FROM orders o JOIN users u ON u.id=o.customer_id WHERE ${base} GROUP BY u.id, u.name
       HAVING count(*) > 1 ORDER BY orders DESC, spent DESC LIMIT 5`, p),
    tenantId ? { rows: [] } : q(`SELECT t.name, count(o.id)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS revenue
       FROM orders o JOIN tenants t ON t.id=o.tenant_id WHERE ${base} GROUP BY t.name ORDER BY revenue DESC LIMIT 20`, p),
  ]);
  // מילוי ימים ריקים כדי שהגרף יהיה רציף
  const map = Object.fromEntries(daily.rows.map(r => [r.day, r]));
  const series = [];
  for (let t = new Date(range.from + 'T00:00:00Z'); t <= new Date(range.to + 'T00:00:00Z'); t = new Date(t.getTime() + 86400000)) {
    const k = t.toISOString().slice(0, 10);
    series.push({ day: k, orders: map[k] ? map[k].orders : 0, revenue: map[k] ? Number(map[k].revenue) : 0 });
  }
  const c = cust.rows[0] || { customers: 0, returning: 0, returning_revenue: 0 };
  return {
    range, totals: { ...totals.rows[0], cancelled: cancelled.rows[0].n },
    daily: series, services: services.rows,
    customers: { ...c, repeat_pct: c.customers ? Math.round(c.returning / c.customers * 100) : 0, top: top.rows },
    by_tenant: tenants.rows,
  };
}
function csvRows(a, scopeName) {
  return [
    ['מסמך דמו — דוח אנליטיקה', scopeName, `${a.range.from} עד ${a.range.to}`],
    [],
    ['סיכום'], ['הזמנות', 'הכנסות ₪', 'ממוצע להזמנה ₪', 'בוטלו', 'לקוחות', 'לקוחות חוזרים', '% חוזרים'],
    [a.totals.orders, a.totals.revenue, a.totals.avg_order, a.totals.cancelled, a.customers.customers, a.customers.returning, a.customers.repeat_pct],
    [],
    ['הכנסות לפי יום'], ['תאריך', 'הזמנות', 'הכנסות ₪'],
    ...a.daily.map(d => [d.day, d.orders, d.revenue]),
    [],
    ['הזמנות לפי שירות'], ['שירות', 'הזמנות', 'כמות', 'הכנסות ₪'],
    ...a.services.map(s => [s.service, s.orders, s.qty, s.revenue]),
    ...(a.by_tenant.length ? [[], ['לפי מכבסה'], ['מכבסה', 'הזמנות', 'הכנסות ₪'], ...a.by_tenant.map(t => [t.name, t.orders, t.revenue])] : []),
  ];
}

async function handle(req, res, tenant, csv) {
  const range = parseRange(req.query);
  if (!range) return res.status(400).json({ error: 'טווח תאריכים לא תקין (עד 366 ימים)' });
  const a = await buildAnalytics(tenant ? tenant.id : null, range);
  if (csv) return sendCsv(res, `analytics-${range.from}_${range.to}.csv`, csvRows(a, tenant ? tenant.name : 'כל הפלטפורמה'));
  res.json(a);
}

// דוח שליחים וזמני טיפול: לפי שליח (הזמנות, נמסרו, שווי, זמן איסוף→מסירה) וסיכום זמני טיפול כלליים (דקות).
async function buildOps(tenantId, range) {
  const base = `o.status <> 'cancelled' AND ($1::uuid IS NULL OR o.tenant_id=$1)
    AND (o.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date`;
  const p = [tenantId, range.from, range.to];
  const evCte = `WITH ord AS (SELECT o.id, o.courier_id, o.total, o.status, o.created_at FROM orders o WHERE ${base}),
    ev AS (SELECT e.order_id,
        min(e.created_at) FILTER (WHERE e.status='confirmed') AS conf,
        min(e.created_at) FILTER (WHERE e.status='picked_up') AS pu,
        min(e.created_at) FILTER (WHERE e.status='delivered') AS del
      FROM order_events e JOIN ord ON ord.id=e.order_id GROUP BY e.order_id)`;
  const mins = (a, b) => `round(avg(extract(epoch FROM (${b} - ${a}))/60) FILTER (WHERE ${a} IS NOT NULL AND ${b} IS NOT NULL AND ${b} >= ${a}))::int`;
  const [couriers, summary] = await Promise.all([
    q(`${evCte}
       SELECT COALESCE(u.name,'ללא שליח') AS courier, count(*)::int AS orders,
         count(*) FILTER (WHERE ord.status='delivered')::int AS delivered,
         COALESCE(sum(ord.total) FILTER (WHERE ord.status='delivered'),0)::numeric(10,2) AS value,
         ${mins('ev.pu', 'ev.del')} AS avg_pickup_to_delivery_min
       FROM ord LEFT JOIN ev ON ev.order_id=ord.id
       LEFT JOIN couriers c ON c.id=ord.courier_id LEFT JOIN users u ON u.id=c.user_id
       GROUP BY c.id, u.name ORDER BY delivered DESC, orders DESC LIMIT 50`, p),
    q(`${evCte}
       SELECT count(*)::int AS orders, count(*) FILTER (WHERE ord.status='delivered')::int AS delivered,
         ${mins('ord.created_at', 'ev.conf')} AS avg_to_confirm_min,
         ${mins('ord.created_at', 'ev.pu')} AS avg_to_pickup_min,
         ${mins('ord.created_at', 'ev.del')} AS avg_to_delivery_min
       FROM ord LEFT JOIN ev ON ev.order_id=ord.id`, p),
  ]);
  return { range, couriers: couriers.rows, handling: summary.rows[0] };
}
function opsCsv(o, scopeName) {
  const h = o.handling;
  return [
    ['מסמך דמו — דוח שליחים וזמני טיפול', scopeName, `${o.range.from} עד ${o.range.to}`],
    [],
    ['זמני טיפול (דקות, ממוצע)'], ['הזמנות', 'נמסרו', 'עד אישור', 'עד איסוף', 'עד מסירה'],
    [h.orders, h.delivered, h.avg_to_confirm_min ?? '', h.avg_to_pickup_min ?? '', h.avg_to_delivery_min ?? ''],
    [],
    ['לפי שליח'], ['שליח', 'הזמנות', 'נמסרו', 'שווי הזמנות ₪', 'איסוף עד מסירה (דקות)'],
    ...o.couriers.map(c => [c.courier, c.orders, c.delivered, c.value, c.avg_pickup_to_delivery_min ?? '']),
  ];
}
async function handleOps(req, res, tenant, csv) {
  const range = parseRange(req.query);
  if (!range) return res.status(400).json({ error: 'טווח תאריכים לא תקין (עד 366 ימים)' });
  const o = await buildOps(tenant ? tenant.id : null, range);
  if (csv) return sendCsv(res, `analytics-couriers-${range.from}_${range.to}.csv`, opsCsv(o, tenant ? tenant.name : 'כל הפלטפורמה'));
  res.json(o);
}

const r = express.Router();
const t = express.Router({ mergeParams: true });
t.use(requireAuth, requireTenantMember);
t.get('/analytics', (req, res) => handle(req, res, req.tenant, false));
t.get('/analytics.csv', (req, res) => handle(req, res, req.tenant, true));
t.get('/analytics/couriers', (req, res) => handleOps(req, res, req.tenant, false));
t.get('/analytics/couriers.csv', (req, res) => handleOps(req, res, req.tenant, true));
r.use('/t/:slug', t);

const adm = express.Router();
adm.use(requireAuth, requireAdmin);
async function adminTenant(req, res) {
  if (!req.query.tenant) return null;
  const { rows } = await q('SELECT id, name FROM tenants WHERE slug=$1', [req.query.tenant]);
  if (!rows[0]) { res.status(404).json({ error: 'מכבסה לא נמצאה' }); return false; }
  return rows[0];
}
adm.get('/analytics', async (req, res) => { const tn = await adminTenant(req, res); if (tn !== false) handle(req, res, tn, false); });
adm.get('/analytics.csv', async (req, res) => { const tn = await adminTenant(req, res); if (tn !== false) handle(req, res, tn, true); });
adm.get('/analytics/couriers', async (req, res) => { const tn = await adminTenant(req, res); if (tn !== false) handleOps(req, res, tn, false); });
adm.get('/analytics/couriers.csv', async (req, res) => { const tn = await adminTenant(req, res); if (tn !== false) handleOps(req, res, tn, true); });
r.use('/admin', adm);

module.exports = r;
module.exports.parseRange = parseRange;
