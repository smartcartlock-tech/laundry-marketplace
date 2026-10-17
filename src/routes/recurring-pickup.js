// T85: איסוף קבוע לצרכן — מנוי איסוף חוזר (שבועי/דו-שבועי) ללקוח פרטי.
// יצירה/רשימה בטנאנט + ניהול עצמי ב-/api/me; יצירת ההזמנות ב-src/consumer-recurring.js.
const express = require('express');
const { requireAuth } = require('../auth');
const { q } = require('../db');
const { audit } = require('../audit');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^\d{1,2}:\d{2}$/;

function cleanItems(items) {
  if (!Array.isArray(items)) return null;
  const out = [];
  for (const it of items) {
    if (!it || !uuid.test(String(it.item_id || ''))) return null;
    const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
    out.push({ item_id: it.item_id, qty });
  }
  return out.length ? out : null;
}

function validateBody(b) {
  const weekday = Number(b.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return 'יום שבוע לא תקין';
  const frequency = b.frequency === 'biweekly' ? 'biweekly' : 'weekly';
  if (b.pickup_time && !TIME.test(b.pickup_time)) return 'שעת איסוף לא תקינה';
  const address = String(b.address || '').trim();
  if (address.length < 3) return 'כתובת חסרה';
  const items = cleanItems(b.items);
  if (!items) return 'יש לבחור לפחות פריט אחד';
  return { weekday, frequency, pickup_time: b.pickup_time || null, address, items };
}

// --- נתיבי טנאנט: /api/t/:slug/recurring-pickup ---
const tenantRouter = express.Router({ mergeParams: true });
tenantRouter.use(requireAuth);
tenantRouter.use(async (req, res, next) => {
  try {
    const { rows } = await q('SELECT id FROM tenants WHERE slug=$1', [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
    req.recTenant = rows[0].id;
    next();
  } catch (e) { next(e); }
});

// יצירת מנוי (לקוח)
tenantRouter.post('/', async (req, res, next) => {
  try {
    const v = validateBody(req.body || {});
    if (typeof v === 'string') return res.status(400).json({ error: v });
    // פריטים חייבים להיות של הטנאנט ופעילים
    const ids = v.items.map(i => i.item_id);
    const { rows: ok } = await q('SELECT id FROM price_items WHERE tenant_id=$1 AND active AND id = ANY($2)', [req.recTenant, ids]);
    if (ok.length !== ids.length) return res.status(400).json({ error: 'פריט לא תקין או לא פעיל במכבסה' });
    const { rows: dup } = await q(
      `SELECT id FROM consumer_pickup_subscriptions WHERE user_id=$1 AND tenant_id=$2 AND weekday=$3 AND active`, [req.user.id, req.recTenant, v.weekday]);
    if (dup[0]) return res.status(409).json({ error: 'כבר קיים מנוי פעיל באותו יום — ניתן לערוך אותו' });
    const { rows } = await q(
      `INSERT INTO consumer_pickup_subscriptions(user_id, tenant_id, frequency, weekday, pickup_time, address, items, anchor_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,(now() AT TIME ZONE 'Asia/Jerusalem')::date) RETURNING *`,
      [req.user.id, req.recTenant, v.frequency, v.weekday, v.pickup_time, v.address, JSON.stringify(v.items)]);
    await audit(req, 'recurring_pickup.create', 'consumer_pickup_subscription', rows[0].id, { tenant_id: req.recTenant, weekday: v.weekday });
    res.status(201).json({ subscription: rows[0] });
  } catch (e) { next(e); }
});

// רשימת מנויים בטנאנט — בעל מכבסה/חבר צוות
tenantRouter.get('/', async (req, res, next) => {
  try {
    const { rows: mem } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [req.recTenant, req.user.id]);
    if (!mem[0]) return res.status(403).json({ error: 'אין הרשאה' });
    const { rows } = await q(
      `SELECT s.*, u.name AS customer_name FROM consumer_pickup_subscriptions s
       JOIN users u ON u.id=s.user_id WHERE s.tenant_id=$1 ORDER BY s.created_at DESC`, [req.recTenant]);
    res.json({ subscriptions: rows });
  } catch (e) { next(e); }
});

// --- נתיבי ניהול עצמי: /api/me/recurring-pickups ---
const meRouter = express.Router();
meRouter.use(requireAuth);

meRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT s.id, s.tenant_id, t.name AS tenant_name, t.slug, s.frequency, s.weekday, s.pickup_time,
              s.address, s.items, s.active, s.last_run_on, s.created_at
       FROM consumer_pickup_subscriptions s JOIN tenants t ON t.id=s.tenant_id
       WHERE s.user_id=$1 ORDER BY s.created_at DESC`, [req.user.id]);
    res.json({ subscriptions: rows });
  } catch (e) { next(e); }
});

meRouter.patch('/:id', async (req, res, next) => {
  try {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'מזהה לא תקין' });
    const b = req.body || {};
    const sets = [], params = [req.params.id, req.user.id];
    if (typeof b.active === 'boolean') { params.push(b.active); sets.push(`active=$${params.length}`); }
    if (b.weekday !== undefined || b.frequency !== undefined || b.pickup_time !== undefined || b.address !== undefined || b.items !== undefined) {
      if (b.weekday !== undefined) {
        const wd = Number(b.weekday);
        if (!Number.isInteger(wd) || wd < 0 || wd > 6) return res.status(400).json({ error: 'יום שבוע לא תקין' });
        params.push(wd); sets.push(`weekday=$${params.length}`);
      }
      if (b.frequency !== undefined) { params.push(b.frequency === 'biweekly' ? 'biweekly' : 'weekly'); sets.push(`frequency=$${params.length}`); }
      if (b.pickup_time !== undefined) {
        if (b.pickup_time && !TIME.test(b.pickup_time)) return res.status(400).json({ error: 'שעת איסוף לא תקינה' });
        params.push(b.pickup_time || null); sets.push(`pickup_time=$${params.length}`);
      }
      if (b.address !== undefined) {
        const a = String(b.address).trim();
        if (a.length < 3) return res.status(400).json({ error: 'כתובת חסרה' });
        params.push(a); sets.push(`address=$${params.length}`);
      }
      if (b.items !== undefined) {
        const items = cleanItems(b.items);
        if (!items) return res.status(400).json({ error: 'יש לבחור לפחות פריט אחד' });
        // ולידציית שייכות פריטים לטנאנט של המנוי
        const { rows: own } = await q('SELECT tenant_id FROM consumer_pickup_subscriptions WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
        if (!own[0]) return res.status(404).json({ error: 'מנוי לא נמצא' });
        const ids = items.map(i => i.item_id);
        const { rows: ok } = await q('SELECT id FROM price_items WHERE tenant_id=$1 AND active AND id = ANY($2)', [own[0].tenant_id, ids]);
        if (ok.length !== ids.length) return res.status(400).json({ error: 'פריט לא תקין או לא פעיל במכבסה' });
        params.push(JSON.stringify(items)); sets.push(`items=$${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'אין שדות לעדכון' });
    const { rows } = await q(
      `UPDATE consumer_pickup_subscriptions SET ${sets.join(', ')} WHERE id=$1 AND user_id=$2 RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ error: 'מנוי לא נמצא' });
    await audit(req, 'recurring_pickup.update', 'consumer_pickup_subscription', rows[0].id, { fields: sets.length });
    res.json({ subscription: rows[0] });
  } catch (e) { next(e); }
});

meRouter.delete('/:id', async (req, res, next) => {
  try {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'מזהה לא תקין' });
    const { rows } = await q('DELETE FROM consumer_pickup_subscriptions WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'מנוי לא נמצא' });
    await audit(req, 'recurring_pickup.cancel', 'consumer_pickup_subscription', rows[0].id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = { tenantRouter, meRouter };
