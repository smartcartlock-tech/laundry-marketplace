// T84: authenticated tenant-scoped internal reminders. Recipient comes from the order.
const express = require('express');
const { requireAuth } = require('../auth');
const { q } = require('../db');
const { enqueue, KINDS } = require('../reminders');
const { isDemo } = require('../config');
const { audit } = require('../audit');
const r = express.Router({ mergeParams: true });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
r.use(requireAuth);
r.use(require('../ratelimit').writeLimiter('reminders', 60));
r.use(async (req, res, next) => {
  if (!isDemo) return res.status(403).json({ error: 'תזכורות זמינות בדמו בלבד' });
  try {
    const { rows } = await q('SELECT id FROM tenants WHERE slug=$1', [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
    req.reminderTenant = rows[0].id;
    next();
  } catch (e) { next(e); }
});
r.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(`SELECT id,order_id,kind,payload,scheduled_at,delivered_at,status,created_at
      FROM reminder_outbox WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100`, [req.reminderTenant, req.user.id]);
    res.json({ reminders: rows, internal_only: true });
  } catch (e) { next(e); }
});
r.post('/', async (req, res, next) => {
  try {
    const { order_id, kind, scheduled_at, idempotency_key } = req.body || {};
    if (!uuid.test(String(order_id)) || !KINDS.has(kind) || typeof scheduled_at !== 'string' ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(scheduled_at) || !Number.isFinite(Date.parse(scheduled_at)) ||
        Date.parse(scheduled_at) > Date.now() + 366 * 86400000 ||
        typeof idempotency_key !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(idempotency_key)) {
      return res.status(400).json({ error: 'נתוני תזכורת לא תקינים; יש לציין זמן עם אזור זמן ומפתח ייחודי' });
    }
    const tenantId = req.reminderTenant;
    const { rows } = await q(`SELECT o.*,c.user_id AS courier_user FROM orders o
      LEFT JOIN couriers c ON c.id=o.courier_id AND c.approved=true WHERE o.tenant_id=$1 AND o.id=$2`, [tenantId, order_id]);
    const o = rows[0];
    if (!o) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
    const userId = kind === 'courier' ? o.courier_user : o.customer_id;
    const { rows: member } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [tenantId, req.user.id]);
    if (req.user.id !== userId && !member.length) return res.status(403).json({ error: 'אין הרשאה להזמנה' });
    if (!userId || ['cancelled','delivered'].includes(o.status) ||
      (kind === 'order_ready' && o.status !== 'ready') ||
      (kind === 'pickup_tomorrow' && (!o.pickup_at || !['new','confirmed'].includes(o.status))) ||
      (kind === 'courier' && !['confirmed','ready','out_for_delivery'].includes(o.status))) {
      return res.status(409).json({ error: 'מצב ההזמנה אינו מתאים לתזכורת' });
    }
    const eventAt = kind === 'pickup_tomorrow' ? o.pickup_at : kind === 'courier' ? (o.status === 'confirmed' ? o.pickup_at : o.delivery_at) : null;
    if (kind === 'courier' && !eventAt) return res.status(409).json({ error: 'חסר מועד למשימה' });
    const key = `manual:${req.user.id}:${idempotency_key}`;
    const reminder = await enqueue(q, { tenantId, userId, orderId: order_id, kind, scheduledAt: scheduled_at, key,
      payload: eventAt ? { event_at: eventAt } : {} });
    if (!reminder) {
      const { rows: existing } = await q('SELECT * FROM reminder_outbox WHERE tenant_id=$1 AND idempotency_key=$2', [tenantId, key]);
      const e = existing[0];
      if (!e || e.order_id !== order_id || e.kind !== kind || new Date(e.scheduled_at).getTime() !== Date.parse(scheduled_at))
        return res.status(409).json({ error: 'המפתח כבר שימש לתזכורת אחרת' });
      return res.json({ reminder: e, duplicate: true, internal_only: true });
    }
    await audit(req, 'reminder.create', 'reminder', reminder.id, { tenant_id: tenantId, internal_only: true });
    res.status(201).json({ reminder, internal_only: true });
  } catch (e) { next(e); }
});
r.delete('/:id', async (req, res, next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'מזהה לא תקין' });
  try {
    const { rows } = await q(`UPDATE reminder_outbox SET status='cancelled' WHERE tenant_id=$1 AND id=$2
      AND user_id=$3 AND status='pending' RETURNING id`, [req.reminderTenant, req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'תזכורת ממתינה לא נמצאה' });
    await audit(req, 'reminder.cancel', 'reminder', rows[0].id, { tenant_id: req.reminderTenant });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
module.exports = r;
