const express = require('express');
const { q } = require('../db');
const r = express.Router();

// רשימת מכבסות פתוחות ומאושרות למרקטפלייס
r.get('/laundries', async (req, res) => {
  const { q: query, service } = req.query;
  const params = [];
  let where = 'WHERE t.approved AND t.is_open IS NOT NULL';
  if (query) { params.push(`%${query}%`); where += ` AND (t.name ILIKE $${params.length} OR t.city ILIKE $${params.length} OR t.address ILIKE $${params.length})`; }
  if (service) { params.push(service); where += ` AND $${params.length} = ANY(t.services)`; }
  const { rows } = await q(
    `SELECT t.id, t.slug, t.name, t.letter, t.color, t.city, t.address, t.services, t.rating, t.rating_count,
            t.delivery_fee, t.min_order, t.is_open, t.lat, t.lng,
            (SELECT min(price) FROM price_items i WHERE i.tenant_id=t.id AND i.active AND i.unit='kg') AS from_kg,
            (SELECT min(price) FROM price_items i WHERE i.tenant_id=t.id AND i.active) AS from_price
     FROM tenants t ${where} ORDER BY t.created_at ASC LIMIT 100`, params);
  // דירוג אמיתי בלבד: מחושב מביקורות במערכת; מתחת ל-3 ביקורות מוצג "חדש" בצד לקוח
  const { rows: agg } = await q('SELECT tenant_id, round(avg(rating)::numeric,1) AS r, count(*)::int AS n FROM reviews GROUP BY tenant_id');
  const byT = Object.fromEntries(agg.map(a => [a.tenant_id, a]));
  for (const l of rows) { const a = byT[l.id]; l.rating = a ? Number(a.r) : null; l.rating_count = a ? a.n : 0; }
  rows.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  res.json({ laundries: rows });
});

// פרופיל מכבסה: פרטים + מחירון + חלונות + ביקורות
r.get('/laundries/:slug', async (req, res) => {
  const { rows: t } = await q('SELECT * FROM tenants WHERE slug=$1 AND approved', [req.params.slug]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const [items, windows, reviews] = await Promise.all([
    q('SELECT id, name, category, price, unit FROM price_items WHERE tenant_id=$1 AND active ORDER BY sort, category, name', [t[0].id]),
    q('SELECT weekday, start_time, end_time, capacity, kind FROM pickup_windows WHERE tenant_id=$1 ORDER BY weekday, start_time', [t[0].id]),
    q(`SELECT r.rating, r.text, r.created_at, u.name AS author FROM reviews r LEFT JOIN users u ON u.id=r.user_id
       WHERE r.tenant_id=$1 AND r.target_courier_id IS NULL ORDER BY r.created_at DESC LIMIT 20`, [t[0].id]),
  ]);
  const ten = t[0]; delete ten.api_key;
  // דירוג אמיתי מהמערכת בלבד
  if (reviews.rows.length) {
    ten.rating = Math.round(reviews.rows.reduce((s, r) => s + r.rating, 0) / reviews.rows.length * 10) / 10;
    ten.rating_count = reviews.rows.length;
  } else { ten.rating = null; ten.rating_count = 0; }
  res.json({ laundry: ten, items: items.rows, windows: windows.rows, reviews: reviews.rows });
});

// קונפיגורציה ציבורית ל-PWA
r.get('/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    demoOtp: process.env.DEMO_OTP !== 'false',
    whatsappOtp: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_WHATSAPP_FROM),
  });
});

module.exports = r;
