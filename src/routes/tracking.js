// T82: מעקב שליח חי במפה + ETA.
// פרטיות: ping מתקבל רק מהשליח המשובץ ורק כשההזמנה out_for_delivery;
// GET חושף מיקום רק במהלך מסירה, מוחק pings של הזמנה שהסתיימה (קריאה = טריגר ניקוי),
// ומחזיר שם פרטי בלבד של השליח. retention: מחיקת pings מעל 24 שעות בכל קריאה/כתיבה (lazy, בלי pg_cron).
// פרוקסי אריחי OSM באותו מקור — CSP (img-src 'self') חוסם טעינה ישירה מהלקוח.
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireCourier } = require('../auth');
const { limiter } = require('../ratelimit');

const r = express.Router();

const RETENTION = "interval '24 hours'";
async function prune() {
  await q(`DELETE FROM courier_pings WHERE ts < now() - ${RETENTION}`).catch(() => {});
}

// --- שליח: שידור מיקום (מוגבל קצב) ---
r.post('/ping', requireAuth, requireCourier,
  limiter('courier-ping', 20, 60 * 1000, (req) => 'u' + req.user.id),
  async (req, res) => {
    const { order_id, lat, lon, accuracy } = req.body || {};
    const la = Number(lat), lo = Number(lon);
    if (!order_id || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180)
      return res.status(400).json({ error: 'מיקום לא תקין' });
    const acc = accuracy === undefined || accuracy === null ? null : Number(accuracy);
    const { rows: c } = await q('SELECT id FROM couriers WHERE user_id=$1', [req.user.id]);
    if (!c[0]) return res.status(403).json({ error: 'אינך רשום כשליח' });
    const { rows: o } = await q('SELECT id, tenant_id, status, courier_id FROM orders WHERE id=$1', [order_id]);
    const order = o[0];
    if (!order || order.courier_id !== c[0].id) return res.status(403).json({ error: 'ההזמנה אינה משובצת אליך' });
    if (order.status !== 'out_for_delivery') return res.status(409).json({ error: 'שיתוף מיקום פעיל רק בזמן מסירה' });
    await prune();
    await q('INSERT INTO courier_pings (tenant_id, courier_id, order_id, lat, lon, accuracy) VALUES ($1,$2,$3,$4,$5,$6)',
      [order.tenant_id, c[0].id, order.id, la, lo, Number.isFinite(acc) ? acc : null]);
    res.json({ ok: true });
  });

// --- לקוח/ציבורי: מצב מעקב לפי קוד ההזמנה (הקוד הוא ההסמכה, כמו /api/track) ---
r.get('/:code/state', limiter('track-state', 45, 10 * 60 * 1000, (req) => req.ip), async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(code)) return res.status(404).json({ error: 'קוד מעקב לא נמצא' });
  const { rows } = await q(
    `SELECT o.id, o.status, o.tenant_id, u.name AS courier_name
     FROM orders o LEFT JOIN couriers cr ON cr.id=o.courier_id LEFT JOIN users u ON u.id=cr.user_id
     WHERE o.tracking_code=$1`, [code]);
  const o = rows[0];
  if (!o) return res.status(404).json({ error: 'קוד מעקב לא נמצא' });
  await prune();
  if (o.status !== 'out_for_delivery') {
    if (['delivered', 'cancelled'].includes(o.status))
      await q('DELETE FROM courier_pings WHERE order_id=$1', [o.id]).catch(() => {}); // מחיקה אחרי מסירה/ביטול
    return res.json({ status: o.status, position: null });
  }
  const { rows: p } = await q(
    'SELECT lat, lon, accuracy, ts FROM courier_pings WHERE order_id=$1 AND tenant_id=$2 ORDER BY ts DESC LIMIT 1',
    [o.id, o.tenant_id]);
  const firstName = (o.courier_name || '').trim().split(/\s+/)[0] || null;
  res.json({
    status: o.status,
    courier_first_name: firstName,
    position: p[0] ? { lat: p[0].lat, lon: p[0].lon, accuracy: p[0].accuracy, at: p[0].ts } : null,
  });
});

// --- פרוקסי אריחי OSM (same-origin בגלל CSP) עם cache בזיכרון ו-User-Agent מזהה ---
const tileCache = new Map();
const TILE_MAX = 500;
r.get('/tiles/:z/:x/:y.png', limiter('tiles', 240, 60 * 1000, (req) => req.ip), async (req, res) => {
  const { z, x, y } = req.params;
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y)) return res.status(400).end();
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) { res.set('Content-Type', 'image/png'); return res.send(hit); }
  try {
    const up = await fetch(`https://tile.openstreetmap.org/${key}.png`, {
      headers: { 'User-Agent': 'laundry-marketplace-demo/1.0 (demo map, contact: demo)' },
    });
    if (!up.ok) return res.status(502).end();
    const buf = Buffer.from(await up.arrayBuffer());
    if (tileCache.size >= TILE_MAX) tileCache.delete(tileCache.keys().next().value);
    tileCache.set(key, buf);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (e) { res.status(502).end(); }
});

module.exports = r;
