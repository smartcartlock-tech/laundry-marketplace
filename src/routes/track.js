// G3b: מעקב הזמנה ציבורי לפי קוד — בלי התחברות. מחזיר סטטוס וציר זמן בלבד, בלי PII (כתובת/טלפון/שם לקוח).
// הקוד (8 תווים אקראיים) הוא הסמכה: מי שקיבל אותו מהלקוח רשאי לראות את הסטטוס.
const express = require('express');
const r = express.Router();
const { q } = require('../db');
const { limiter } = require('../ratelimit');

r.get('/:code', limiter('track', 30, 10 * 60 * 1000, (req) => req.ip), async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(code)) return res.status(404).json({ error: 'קוד מעקב לא נמצא' });
  const { rows } = await q(
    `SELECT o.id, o.status, o.created_at, o.pickup_at, o.delivery_at, o.delivery_code, o.tenant_id, t.name AS laundry_name, t.turnaround_hours
     FROM orders o JOIN tenants t ON t.id = o.tenant_id WHERE o.tracking_code = $1`, [code]);
  const o = rows[0];
  if (!o) return res.status(404).json({ error: 'קוד מעקב לא נמצא' });
  const { rows: events } = await q(
    'SELECT status, created_at FROM order_events WHERE order_id = $1 ORDER BY created_at', [o.id]);
  // T106: צפי החזרה גם במעקב הציבורי (תאריך משוער בלבד — לא PII)
  const { rows: wins } = await q(
    'SELECT weekday, start_time, end_time, kind FROM pickup_windows WHERE tenant_id=$1', [o.tenant_id]);
  const { computeReturnEta, etaLabel } = require('../eta');
  const now = new Date();
  const etaAt = computeReturnEta({ turnaroundHours: o.turnaround_hours ?? 24, windows: wins, order: o, now });
  // T93: קוד המסירה נחשף כאן — דף המעקב מוגן בקוד המעקב הסודי של הלקוח; השליח אינו מקבל אותו באף ממשק
  res.json({
    status: o.status, laundry_name: o.laundry_name,
    created_at: o.created_at, pickup_at: o.pickup_at, delivery_at: o.delivery_at,
    delivery_code: o.delivery_code,
    return_eta: etaAt ? etaAt.toISOString() : null,
    return_eta_label: etaAt ? etaLabel(etaAt, now) : null,
    events: events.map(e => ({ status: e.status, at: e.created_at })),
  });
});

module.exports = r;
