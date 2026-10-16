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
