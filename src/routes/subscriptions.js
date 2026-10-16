// E2: מנוי כביסה חודשי — API ללקוח: תוכניות, הצטרפות (תשלום דמו), שדרוג, השהיה, ביטול.
const express = require('express');
const { q, pool } = require('../db');
const { requireAuth } = require('../auth');
const { ensureCurrentPeriod } = require('../subscriptions');

const r = express.Router();
r.use(requireAuth);

async function findTenant(slug) {
  const { rows } = await q('SELECT * FROM tenants WHERE slug=$1 AND approved', [slug]);
  return rows[0] || null;
}

// תוכניות מנוי פעילות של מכבסה
r.get('/plans/:slug', async (req, res) => {
  const tenant = await findTenant(req.params.slug);
  if (!tenant) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const { rows } = await q(
    'SELECT * FROM subscription_plans WHERE tenant_id=$1 AND active ORDER BY sort, price', [tenant.id]);
  res.json({ plans: rows });
});

// הצטרפות למנוי (תשלום דמו). מנוי מושהה מתחדש עם התוכנית החדשה; מנוי פעיל דורש שדרוג.
r.post('/join', async (req, res) => {
  const { slug, plan_id } = req.body || {};
  if (!slug || !plan_id) return res.status(400).json({ error: 'חסרים פרטים' });
  const tenant = await findTenant(slug);
  if (!tenant) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const { rows: p } = await q('SELECT * FROM subscription_plans WHERE id=$1 AND tenant_id=$2 AND active', [plan_id, tenant.id]);
  const plan = p[0];
  if (!plan) return res.status(404).json({ error: 'תוכנית לא נמצאה' });

  const { rows: ex } = await q(
    `SELECT * FROM subscriptions WHERE tenant_id=$1 AND user_id=$2 AND status <> 'cancelled'`, [tenant.id, req.user.id]);
  const existing = ex[0];
  if (existing && existing.status === 'active') return res.status(409).json({ error: 'כבר יש לך מנוי פעיל במכבסה זו' });

  let sub;
  if (existing) { // paused -> חידוש עם התוכנית החדשה ותקופה חדשה
    const { rows } = await q(
      `UPDATE subscriptions SET plan_id=$1, status='active', auto_renew=true, payment_status='paid_demo',
         period_start=CURRENT_DATE, period_end=CURRENT_DATE + INTERVAL '1 month', bags_used=0, updated_at=now()
       WHERE id=$2 RETURNING *`, [plan.id, existing.id]);
    sub = rows[0];
    await q('INSERT INTO subscription_usage(subscription_id, bags, note) VALUES ($1,0,$2)', [sub.id, 'חידוש הצטרפות למנוי (תשלום דמו)']);
  } else {
    const { rows } = await q(
      `INSERT INTO subscriptions(tenant_id, plan_id, user_id) VALUES ($1,$2,$3) RETURNING *`, [tenant.id, plan.id, req.user.id]);
    sub = rows[0];
    await q('INSERT INTO subscription_usage(subscription_id, bags, note) VALUES ($1,0,$2)', [sub.id, 'הצטרפות למנוי (תשלום דמו)']);
  }
  res.status(201).json({ subscription: sub, plan });
});

// המנויים שלי (עם יתרת שקים ותוכנית)
r.get('/mine', async (req, res) => {
  const { rows } = await q(
    `SELECT s.*, p.name AS plan_name, p.bags_per_month, p.kg_per_bag, p.price AS plan_price, p.perks,
            t.name AS tenant_name, t.slug, t.color, t.letter
     FROM subscriptions s
     JOIN subscription_plans p ON p.id=s.plan_id
     JOIN tenants t ON t.id=s.tenant_id
     WHERE s.user_id=$1 ORDER BY s.created_at DESC`, [req.user.id]);
  const out = [];
  for (const sub of rows) {
    const cur = await ensureCurrentPeriod({ query: (a, b) => q(a, b) }, sub);
    out.push({ ...cur, bags_remaining: Math.max(0, Number(cur.bags_per_month) - Number(cur.bags_used)) });
  }
  res.json({ subscriptions: out });
});

async function mySub(req, res) {
  const { rows } = await q('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!rows[0]) { res.status(404).json({ error: 'מנוי לא נמצא' }); return null; }
  return rows[0];
}

// שדרוג/שינוי תוכנית (מנוי פעיל בלבד)
r.post('/:id/upgrade', async (req, res) => {
  const sub = await mySub(req, res); if (!sub) return;
  if (sub.status !== 'active') return res.status(409).json({ error: 'שדרוג אפשרי רק למנוי פעיל' });
  const { plan_id } = req.body || {};
  const { rows: p } = await q('SELECT * FROM subscription_plans WHERE id=$1 AND tenant_id=$2 AND active', [plan_id, sub.tenant_id]);
  if (!p[0]) return res.status(404).json({ error: 'תוכנית לא נמצאה' });
  const { rows } = await q('UPDATE subscriptions SET plan_id=$1, updated_at=now() WHERE id=$2 RETURNING *', [plan_id, sub.id]);
  await q('INSERT INTO subscription_usage(subscription_id, bags, note) VALUES ($1,0,$2)', [sub.id, `שינוי תוכנית ל"${p[0].name}"`]);
  res.json({ subscription: rows[0] });
});

// השהיה
r.post('/:id/pause', async (req, res) => {
  const sub = await mySub(req, res); if (!sub) return;
  if (sub.status !== 'active') return res.status(409).json({ error: 'רק מנוי פעיל ניתן להשהיה' });
  const { rows } = await q(`UPDATE subscriptions SET status='paused', updated_at=now() WHERE id=$1 RETURNING *`, [sub.id]);
  await q('INSERT INTO subscription_usage(subscription_id, bags, note) VALUES ($1,0,$2)', [sub.id, 'השהיית מנוי']);
  res.json({ subscription: rows[0] });
});

// חידוש מהשהיה
r.post('/:id/resume', async (req, res) => {
  const sub = await mySub(req, res); if (!sub) return;
  if (sub.status !== 'paused') return res.status(409).json({ error: 'המנוי אינו מושהה' });
  const { rows } = await q(`UPDATE subscriptions SET status='active', updated_at=now() WHERE id=$1 RETURNING *`, [sub.id]);
  await q('INSERT INTO subscription_usage(subscription_id, bags, note) VALUES ($1,0,$2)', [sub.id, 'חידוש מנוי מהשהיה']);
  res.json({ subscription: rows[0] });
});

// ביטול — עוצר חידוש אוטומטי
r.post('/:id/cancel', async (req, res) => {
  const sub = await mySub(req, res); if (!sub) return;
  if (sub.status === 'cancelled') return res.status(409).json({ error: 'המנוי כבר בוטל' });
  const { rows } = await q(
    `UPDATE subscriptions SET status='cancelled', auto_renew=false, updated_at=now() WHERE id=$1 RETURNING *`, [sub.id]);
  await q('INSERT INTO subscription_usage(subscription_id, bags, note) VALUES ($1,0,$2)', [sub.id, 'ביטול מנוי — החידוש הופסק']);
  res.json({ subscription: rows[0] });
});

// היסטוריית ניצול
r.get('/:id/usage', async (req, res) => {
  const sub = await mySub(req, res); if (!sub) return;
  const { rows } = await q(
    `SELECT u.*, o.id AS order_short FROM subscription_usage u LEFT JOIN orders o ON o.id=u.order_id
     WHERE u.subscription_id=$1 ORDER BY u.created_at DESC LIMIT 100`, [sub.id]);
  res.json({ usage: rows });
});

module.exports = r;
