// E10.T1: API בוט מרכזי — ניתוב לקוח למכבסה מתאימה והקצאת מפתח שיחה זמני.
// אימות: X-Api-Key של הפלטפורמה (platform_keys.bot_central; מוצג לאדמין ב-/api/admin/bot-central-key).
const express = require('express');
const { q } = require('../db');

const r = express.Router();
async function centralAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'missing api key' });
  const { rows } = await q('SELECT key FROM platform_keys WHERE name=$1', ['bot_central']);
  if (!rows[0] || rows[0].key !== key) return res.status(401).json({ error: 'invalid api key' });
  next();
}
r.use(centralAuth);

// מכבסות קרובות/מתאימות לפי עיר/חיפוש — ברירת מחדל: 3 המדורגות
r.get('/laundries', async (req, res) => {
  const { city, q: query } = req.query;
  const limit = Math.min(Number(req.query.limit) || 3, 10);
  const params = [];
  let where = 'WHERE t.approved AND t.is_open';
  if (city) { params.push(`%${city}%`); where += ` AND t.city ILIKE $${params.length}`; }
  if (query) { params.push(`%${query}%`); where += ` AND (t.name ILIKE $${params.length} OR t.city ILIKE $${params.length} OR $${params.length} = ANY(t.services))`; }
  params.push(limit);
  const { rows } = await q(
    `SELECT t.slug, t.name, t.city, t.address, t.services, t.delivery_fee, t.min_order, t.phone,
            (SELECT min(price) FROM price_items i WHERE i.tenant_id=t.id AND i.active) AS from_price,
            (SELECT round(avg(rating)::numeric,1) FROM reviews rv WHERE rv.tenant_id=t.id) AS rating,
            (SELECT count(*)::int FROM reviews rv WHERE rv.tenant_id=t.id) AS rating_count
     FROM tenants t ${where}
     ORDER BY rating DESC NULLS LAST, t.created_at ASC LIMIT $${params.length}`, params);
  res.json({ laundries: rows });
});

// handoff: יצירת הקשר שיחה בין הבוט המרכזי למכבסה נבחרת — מפתח API זמני (24 שעות) לשיחה זו בלבד
r.post('/handoff', async (req, res) => {
  const { phone, slug, name } = req.body || {};
  if (!phone || !slug) return res.status(400).json({ error: 'phone, slug required' });
  let p = String(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('0')) p = '+972' + p.slice(1);
  const { rows: t } = await q('SELECT id, slug, name FROM tenants WHERE slug=$1 AND approved', [slug]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const { rows: s } = await q(
    'INSERT INTO bot_sessions(phone, tenant_id) VALUES ($1,$2) RETURNING token, expires_at', [p, t[0].id]);
  res.status(201).json({
    session_key: s[0].token,
    expires_at: s[0].expires_at,
    tenant: { slug: t[0].slug, name: t[0].name },
    usage: 'השתמשו במפתח כ-X-Api-Key מול /api/bot/* — ההזמנות ישויכו לטלפון השיחה',
  });
});

module.exports = r;
