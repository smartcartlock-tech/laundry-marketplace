// E7: אדמין פלטפורמה מורחב — דשבורד מרכזי, צינור אונבורדינג, התראות SLA ומחלוקות
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { uuidParams } = require('../validate');

const r = express.Router();
r.use(requireAuth, requireAdmin);

const STAGES = ['agreement','pricing','bot','training','active'];

// E7.T1: דשבורד מנהל מרכזי — GMV חודשי, עמלות, SLA, מכבסות פעילות, פעילות B2B שבועית, התראות
r.get('/dashboard', async (req, res) => {
  const [gmv, comm, sla, laundries, b2b, alerts] = await Promise.all([
    q(`SELECT COALESCE(sum(total),0)::numeric(10,2) AS gmv, count(*)::int AS orders
       FROM orders WHERE status <> 'cancelled' AND created_at >= date_trunc('month', now())`, []),
    q(`SELECT COALESCE(sum(commission),0)::numeric(10,2) AS courier_commission,
              COALESCE(sum(gross),0)::numeric(10,2) AS courier_gross
       FROM courier_earnings WHERE created_at >= date_trunc('month', now())`, []),
    q(`SELECT count(*)::int AS pickups,
              count(*) FILTER (WHERE e.created_at <= o.pickup_at + interval '30 minutes')::int AS on_time
       FROM order_events e JOIN orders o ON o.id=e.order_id
       WHERE e.status='picked_up' AND o.pickup_at IS NOT NULL AND e.created_at > now() - interval '30 days'`, []),
    q(`SELECT count(*) FILTER (WHERE approved)::int AS approved,
              count(*) FILTER (WHERE approved AND EXISTS (
                SELECT 1 FROM orders o WHERE o.tenant_id=t.id AND o.created_at > now() - interval '30 days'))::int AS active_30d
       FROM tenants t`, []),
    q(`SELECT
        (SELECT count(*) FROM forum_posts WHERE created_at > now() - interval '7 days')::int AS posts,
        (SELECT count(*) FROM tenders WHERE created_at > now() - interval '7 days')::int AS tenders,
        (SELECT count(*) FROM tender_bids WHERE created_at > now() - interval '7 days')::int AS bids,
        (SELECT count(*) FROM purchase_groups WHERE created_at > now() - interval '7 days')::int AS purchase_groups,
        (SELECT count(*) FROM capacity_posts WHERE created_at > now() - interval '7 days')::int AS capacity_posts`, []),
    q(`SELECT count(*) FILTER (WHERE status='open')::int AS open,
              count(*) FILTER (WHERE status='open' AND kind IN ('late_pickup','late_delivery'))::int AS late,
              count(*) FILTER (WHERE status='open' AND kind='customer_issue')::int AS issues
       FROM sla_alerts`, []),
  ]);
  const s = sla.rows[0];
  res.json({
    month: { gmv: gmv.rows[0].gmv, orders: gmv.rows[0].orders,
             courier_commission: comm.rows[0].courier_commission, courier_gross: comm.rows[0].courier_gross },
    sla: { pickups_30d: s.pickups, on_time_pct: s.pickups ? Math.round(100 * s.on_time / s.pickups) : null },
    laundries: laundries.rows[0],
    b2b_weekly: b2b.rows[0],
    alerts: alerts.rows[0],
  });
});

// E7.T2: צינור אונבורדינג — רשימת מכבסות עם השלב הנוכחי
r.get('/onboarding', async (req, res) => {
  const { rows } = await q(
    `SELECT t.id, t.slug, t.name, t.city, t.approved, t.created_at,
            COALESCE(o.stage, 'agreement') AS stage, o.notes, o.updated_at AS stage_updated_at,
            t.accepted_terms_at, t.accepted_terms_version,
            (SELECT count(*) FROM price_items p WHERE p.tenant_id=t.id)::int AS price_items
     FROM tenants t LEFT JOIN tenant_onboarding o ON o.tenant_id=t.id
     ORDER BY t.created_at DESC`, []);
  const pipeline = {};
  for (const s of STAGES) pipeline[s] = rows.filter(x => x.stage === s).length;
  res.json({ tenants: rows, pipeline, stages: STAGES });
});

// E7.T2: עדכון שלב אונבורדינג (קדימה/אחורה) — מתועד
r.post('/onboarding/:tenantId/stage', async (req, res) => {
  const { stage, notes } = req.body || {};
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'שלב לא תקין: ' + STAGES.join(' | ') });
  const { rows } = await q(
    `INSERT INTO tenant_onboarding(tenant_id, stage, notes, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (tenant_id) DO UPDATE SET stage=$2, notes=COALESCE($3, tenant_onboarding.notes),
       updated_by=$4, updated_at=now()
     RETURNING *`,
    [req.params.tenantId, stage, notes || null, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  res.json({ onboarding: rows[0] });
});

// E7.T3: סריקת איחורים — יוצרת התראות SLA אידמפוטנטית להזמנות שחורגות מהסף
r.post('/sla/sync', async (req, res) => {
  const latePickup = await q(
    `INSERT INTO sla_alerts(order_id, tenant_id, kind, details)
     SELECT o.id, o.tenant_id, 'late_pickup', 'איסוף לא בוצע מעל שעתיים אחרי חלון האיסוף המתוכנן'
     FROM orders o
     WHERE o.status IN ('new','confirmed') AND o.pickup_at < now() - interval '2 hours'
     ON CONFLICT DO NOTHING RETURNING id`, []);
  const lateDelivery = await q(
    `INSERT INTO sla_alerts(order_id, tenant_id, kind, details)
     SELECT o.id, o.tenant_id, 'late_delivery', 'משלוח לא הושלם מעל שעתיים אחרי מועד המסירה המתוכנן'
     FROM orders o
     WHERE o.status IN ('picked_up','in_work','ready','out_for_delivery') AND o.delivery_at IS NOT NULL AND o.delivery_at < now() - interval '2 hours'
     ON CONFLICT DO NOTHING RETURNING id`, []);
  const disputes = await q(
    `INSERT INTO sla_alerts(order_id, tenant_id, kind, details)
     SELECT NULL, e.tenant_id, 'courier_dispute', 'מחלוקת תשלום שליח: ברוטו ₪' || e.gross || ' נטו ₪' || e.net
     FROM courier_earnings e WHERE e.status='disputed'
       AND NOT EXISTS (SELECT 1 FROM sla_alerts a WHERE a.kind='courier_dispute' AND a.tenant_id IS NOT DISTINCT FROM e.tenant_id
                       AND a.details LIKE '%' || e.gross || '%' AND a.status='open')
     RETURNING id`, []);
  res.json({ created: { late_pickup: latePickup.rowCount, late_delivery: lateDelivery.rowCount, courier_dispute: disputes.rowCount } });
});

// E7.T3: תור טיפול — כל ההתראות עם פרטי הזמנה/מכבסה/לקוח
r.get('/sla', async (req, res) => {
  const status = req.query.status === 'all' ? null : (req.query.status || 'open');
  const { rows } = await q(
    `SELECT a.*, t.name AS tenant_name, o.address AS order_address, o.status AS order_status,
            o.pickup_at, o.delivery_at, u.name AS customer_name, u.phone AS customer_phone,
            h.name AS handled_by_name
     FROM sla_alerts a
     LEFT JOIN tenants t ON t.id=a.tenant_id
     LEFT JOIN orders o ON o.id=a.order_id
     LEFT JOIN users u ON u.id=o.customer_id
     LEFT JOIN users h ON h.id=a.handled_by
     ${status ? 'WHERE a.status=$1' : ''}
     ORDER BY a.status='handled', a.created_at DESC LIMIT 100`,
    status ? [status] : []);
  res.json({ alerts: rows });
});

// E7.T3: טיפול מתועד בהתראה
r.post('/sla/:id/handle', uuidParams('id'), async (req, res) => {
  const { note } = req.body || {};
  const { rows } = await q(
    `UPDATE sla_alerts SET status='handled', handled_by=$2, handled_at=now(), handle_note=$3
     WHERE id=$1 AND status='open' RETURNING *`,
    [req.params.id, req.user.id, note || null]);
  if (!rows[0]) return res.status(404).json({ error: 'התראה לא נמצאה או שכבר טופלה' });
  res.json({ alert: rows[0] });
});

// E7.T3: פתיחה מחדש של התראה שטופלה בטעות
r.post('/sla/:id/reopen', uuidParams('id'), async (req, res) => {
  const { rows } = await q(
    `UPDATE sla_alerts SET status='open', handled_by=NULL, handled_at=NULL, handle_note=NULL
     WHERE id=$1 AND status='handled' RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'התראה לא נמצאה או שאינה טופלה' });
  res.json({ alert: rows[0] });
});

// E9.T1: גישור אדמין — תקלות שהסלימה מכבסה (mediation) או כל התקלות
r.get('/issues', async (req, res) => {
  const onlyMed = req.query.mediation === '1';
  const { rows } = await q(
    `SELECT r.id, r.order_id, r.kind, r.text, r.status, r.mediation, r.resolution_note, r.created_at, r.updated_at,
            t.name AS tenant_name, t.slug AS tenant_slug, u.name AS customer_name, u.phone AS customer_phone,
            (SELECT count(*) FROM issue_report_photos p WHERE p.report_id=r.id)::int AS photos,
            (SELECT json_agg(p.id) FROM issue_report_photos p WHERE p.report_id=r.id) AS photo_ids
     FROM issue_reports r JOIN tenants t ON t.id=r.tenant_id JOIN users u ON u.id=r.customer_id
     ${onlyMed ? 'WHERE r.mediation AND r.status<>$1' : ''}
     ORDER BY r.mediation DESC, r.status='resolved', r.created_at DESC LIMIT 100`,
    onlyMed ? ['resolved'] : []);
  res.json({ issues: rows });
});

r.post('/issues/:id/handle', uuidParams('id'), async (req, res) => {
  const { status, note } = req.body || {};
  if (!['in_progress','resolved'].includes(status)) return res.status(400).json({ error: 'סטטוס: in_progress | resolved' });
  const { rows } = await q(
    `UPDATE issue_reports SET status=$2, resolution_note=COALESCE($3, resolution_note), handled_by=$4, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [req.params.id, status, note || null, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'דיווח לא נמצא' });
  res.json({ issue: rows[0] });
});

module.exports = r;
