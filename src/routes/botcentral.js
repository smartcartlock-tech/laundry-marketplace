// E10.T1: API בוט מרכזי — ניתוב לקוח למכבסה מתאימה והקצאת מפתח שיחה זמני.
// אימות: X-Api-Key של הפלטפורמה (platform_keys.bot_central; מוצג לאדמין ב-/api/admin/bot-central-key).
const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');

const r = express.Router();
r.use(require('../ratelimit').limiter('botcentral', 120, 60 * 1000, (req) => req.ip)); // ממצא 7: rate limit
async function centralAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'missing api key' });
  // ממצא 7: השוואת hash מול hash (המפתח הגלוי מוצג לאדמין פעם אחת ביצירה/רוטציה)
  const keyHash = crypto.createHash('sha256').update(String(key)).digest('hex');
  const { rows } = await q('SELECT key, key_hash FROM platform_keys WHERE name=$1', ['bot_central']);
  // שורה שנוצרה בלי hash (מעבר) — מגבבים במקום פעם אחת
  if (rows[0] && !rows[0].key_hash) {
    rows[0].key_hash = crypto.createHash('sha256').update(String(rows[0].key)).digest('hex');
    await q('UPDATE platform_keys SET key_hash=$1 WHERE name=$2', [rows[0].key_hash, 'bot_central']);
  }
  const a = Buffer.from(keyHash), b = Buffer.from(String(rows[0] && rows[0].key_hash || ''));
  if (!rows[0] || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'invalid api key' });
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
  // ממצא 7: הטוקן נוצר כאן, נשמר רק כ-hash, ומוחזר לבוט פעם אחת בתגובה
  const plainToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');
  const { rows: s } = await q(
    'INSERT INTO bot_sessions(phone, tenant_id, token, token_hash) VALUES ($1,$2,NULL,$3) RETURNING expires_at',
    [p, t[0].id, tokenHash]);
  res.status(201).json({
    session_key: plainToken,
    expires_at: s[0].expires_at,
    tenant: { slug: t[0].slug, name: t[0].name },
    usage: 'השתמשו במפתח כ-X-Api-Key מול /api/bot/* — ההזמנות ישויכו לטלפון השיחה',
  });
});

module.exports = r;
