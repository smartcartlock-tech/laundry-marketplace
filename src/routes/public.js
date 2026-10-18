const express = require('express');
const crypto = require('crypto');
const bwip = require('bwip-js');
const jwt = require('jsonwebtoken');
const { q } = require('../db');
const r = express.Router();

// אימות אופציונלי: מחזיר user אם יש טוקן תקין, אחרת null (בלי להפיל בקשה ציבורית)
async function optionalUser(req) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return null;
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-insecure-secret');
    const { rows } = await q('SELECT id, token_version FROM users WHERE id=$1', [payload.uid]);
    if (!rows[0]) return null;
    // הרשאות: טוקן שבוטל (logout/ביטול גלובלי) לא מזכה יותר במחיר הסכם — בדיקת token_version כמו ב-requireAuth
    if ((payload.tv ?? -1) !== rows[0].token_version) return null;
    return rows[0];
  } catch (e) { return null; }
}
// ביצועים: מטמון קצר לנתונים ציבוריים (רשימת מכבסות/דף מכבסה) — חוסך חסימות בשרת החינמי
const pubCache = (res, sec=30) => res.set('Cache-Control', `public, max-age=${sec}`);

// רשימת מכבסות פתוחות ומאושרות למרקטפלייס
r.get('/laundries', async (req, res) => {
  const { q: query, service } = req.query;
  const params = [];
  let where = 'WHERE t.approved AND t.is_open IS NOT NULL AND NOT t.is_test'; // T112: טנאנטי בדיקות מוסתרים מהמרקטפלייס
  // חיפוש חופשי: שם, עיר, כתובת — וגם שירותים (E13: חיפוש לפי שירות, למשל "שטיח")
  if (query) { params.push(`%${query}%`); where += ` AND (t.name ILIKE $${params.length} OR t.city ILIKE $${params.length} OR t.address ILIKE $${params.length} OR EXISTS (SELECT 1 FROM unnest(t.services) sv WHERE sv ILIKE $${params.length}))`; }
  if (service) { params.push(service); where += ` AND $${params.length} = ANY(t.services)`; }
  const { rows } = await q(
    `SELECT t.id, t.slug, t.name, t.letter, t.color, t.city, t.address, t.services, t.rating, t.rating_count,
            t.delivery_fee, t.min_order, t.is_open, t.hours, t.lat, t.lng, t.turnaround_hours,
            (SELECT min(price) FROM price_items i WHERE i.tenant_id=t.id AND i.active AND i.unit='kg') AS from_kg,
            (SELECT min(price) FROM price_items i WHERE i.tenant_id=t.id AND i.active) AS from_price
     FROM tenants t ${where} ORDER BY t.created_at ASC LIMIT 100`, params);
  // דירוג אמיתי בלבד: מחושב מביקורות במערכת; מתחת ל-3 ביקורות מוצג "חדש" בצד לקוח
  const { rows: agg } = await q('SELECT tenant_id, round(avg(rating)::numeric,1) AS r, count(*)::int AS n FROM reviews GROUP BY tenant_id');
  const byT = Object.fromEntries(agg.map(a => [a.tenant_id, a]));
  for (const l of rows) { const a = byT[l.id]; l.rating = a ? Number(a.r) : null; l.rating_count = a ? a.n : 0; }
  rows.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  // T106: צפי החזרה משוער לכל כרטיס מכבסה (מהזמנה חדשה כרגע)
  {
    const { computeReturnEta, etaLabel } = require('../eta');
    const ids = rows.map(l => l.id);
    const { rows: wins } = ids.length ? await q(
      'SELECT tenant_id, weekday, start_time, end_time, kind FROM pickup_windows WHERE tenant_id = ANY($1)', [ids]) : { rows: [] };
    const wMap = {};
    for (const w of wins) (wMap[w.tenant_id] = wMap[w.tenant_id] || []).push(w);
    const now = new Date();
    for (const l of rows) {
      const at = computeReturnEta({ turnaroundHours: l.turnaround_hours ?? 24, windows: wMap[l.id] || [], order: {}, now });
      l.return_estimate_label = at ? etaLabel(at, now) : null;
    }
  }
  pubCache(res, 30);
  res.json({ laundries: rows });
});

// פרופיל מכבסה: פרטים + מחירון + חלונות + ביקורות
r.get('/laundries/:slug', async (req, res) => {
  const { rows: t } = await q('SELECT * FROM tenants WHERE slug=$1 AND approved', [req.params.slug]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const [items, windows, reviews, plans] = await Promise.all([
    q('SELECT id, name, category, price, unit, subscription_eligible FROM price_items WHERE tenant_id=$1 AND active ORDER BY sort, category, name', [t[0].id]),
    q('SELECT weekday, start_time, end_time, capacity, kind FROM pickup_windows WHERE tenant_id=$1 ORDER BY weekday, start_time', [t[0].id]),
    q(`SELECT r.rating, r.text, r.tags, r.created_at, u.name AS author FROM reviews r LEFT JOIN users u ON u.id=r.user_id
       WHERE r.tenant_id=$1 AND r.target_courier_id IS NULL ORDER BY r.created_at DESC LIMIT 20`, [t[0].id]),
    q('SELECT id, name, bags_per_month, kg_per_bag, price, extra_bag_price, perks FROM subscription_plans WHERE tenant_id=$1 AND active ORDER BY sort, price', [t[0].id]),
  ]);
  const ten = t[0]; delete ten.api_key; ten.has_logo = !!ten.logo; delete ten.logo; delete ten.logo_mime;
  // לקוח משויך לחשבון עסקי פעיל רואה את מחיר ההסכם בקטלוג (גובר על המחירון הרגיל)
  const viewer = await optionalUser(req);
  if (viewer) {
    const { rows: bp } = await q(
      `SELECT bp.item_id, bp.price FROM business_prices bp
       JOIN business_accounts ba ON ba.id=bp.account_id AND ba.active AND ba.tenant_id=$1
       JOIN business_account_users bau ON bau.account_id=ba.id AND bau.user_id=$2`, [ten.id, viewer.id]);
    if (bp.length) {
      const byId = Object.fromEntries(bp.map(x => [x.item_id, Number(x.price)]));
      for (const it of items.rows) if (byId[it.id] !== undefined) { it.price = byId[it.id]; it.agreement_price = true; }
      ten.agreement_pricing = true;
    }
  }
  // דירוג אמיתי מהמערכת בלבד
  if (reviews.rows.length) {
    ten.rating = Math.round(reviews.rows.reduce((s, r) => s + r.rating, 0) / reviews.rows.length * 10) / 10;
    ten.rating_count = reviews.rows.length;
  } else { ten.rating = null; ten.rating_count = 0; }
  // T106: צפי החזרה משוער להזמנה חדשה — מוצג בדף המכבסה ובצ'ק-אאוט
  {
    const { computeReturnEta, etaLabel } = require('../eta');
    const now = new Date();
    const at = computeReturnEta({ turnaroundHours: ten.turnaround_hours ?? 24, windows: windows.rows, order: {}, now });
    ten.return_estimate_label = at ? etaLabel(at, now) : null;
  }
  // D2: ETag על כל המטען — טעינה חוזרת של דף מכבסה מקבלת 304 בלי גוף (חוסך את רוב התעבורה)
  const payload = { laundry: ten, items: items.rows, windows: windows.rows, reviews: reviews.rows, plans: plans.rows };
  const etag = 'W/"' + crypto.createHash('sha256').update(JSON.stringify(payload)).digest('base64url') + '"';
  // הרשאות: קטלוג עם מחיר הסכם אישי (או בקשה מזוהה בכלל) — לא נשמר במטמון ציבורי משותף
  if (ten.agreement_pricing || req.headers.authorization) res.set('Cache-Control', 'private, no-store');
  else pubCache(res, 30);
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.json(payload);
});

// E14.T2: השוואת מחירים — לכל פריט במכבסה, המחיר הזול ביותר אצל מתחרים (אותו שם + אותה יחידה)
r.get('/laundries/:slug/price-compare', async (req, res) => {
  const { rows: t } = await q('SELECT id FROM tenants WHERE slug=$1 AND approved', [req.params.slug]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const { rows } = await q(
    `SELECT i.name, i.unit, i.price AS my_price, o.price AS other_price, ot.slug, ot.name AS laundry_name
     FROM price_items i
     JOIN price_items o ON o.name=i.name AND o.unit=i.unit AND o.active AND o.tenant_id<>i.tenant_id
     JOIN tenants ot ON ot.id=o.tenant_id AND ot.approved
     WHERE i.tenant_id=$1 AND i.active`, [t[0].id]);
  const best = {};
  for (const row of rows) {
    if (Number(row.other_price) >= Number(row.my_price)) continue;
    const k = row.name + '|' + row.unit;
    if (!best[k] || Number(row.other_price) < best[k].other_price) {
      best[k] = { other_price: Number(row.other_price), my_price: Number(row.my_price), slug: row.slug, laundry_name: row.laundry_name };
    }
  }
  res.json({ compare: best });
});

// E3: לוגו מכבסה (ציבורי)
r.get('/laundries/:slug/logo', async (req, res) => {
  const { rows } = await q('SELECT logo, logo_mime FROM tenants WHERE slug=$1 AND approved', [req.params.slug]);
  if (!rows[0] || !rows[0].logo) return res.status(404).json({ error: 'אין לוגו' });
  res.setHeader('content-type', rows[0].logo_mime || 'image/png');
  res.setHeader('cache-control', 'public, max-age=300');
  res.send(rows[0].logo);
});

// E3: manifest דינמי לאפליקציית המותג הלבן
r.get('/laundries/:slug/manifest.webmanifest', async (req, res) => {
  const { rows } = await q('SELECT name, slogan, color, logo FROM tenants WHERE slug=$1 AND approved', [req.params.slug]);
  if (!rows[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const t = rows[0];
  const base = '/b/' + req.params.slug;
  const icons = t.logo
    ? [{ src: '/api/laundries/' + req.params.slug + '/logo', sizes: 'any', type: 'image/png', purpose: 'any' }]
    : [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }];
  res.setHeader('content-type', 'application/manifest+json');
  res.json({
    name: t.name, short_name: t.name, description: t.slogan || undefined,
    start_url: base, scope: base, display: 'standalone', dir: 'rtl', lang: 'he',
    background_color: '#f5f8f9', theme_color: t.color || '#0e7a8a', icons,
  });
});

function brandedUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.headers.host}/b/${req.params.slug}`;
}

// E3.T3: QR לסניף — מוביל לדף הממותג
r.get('/laundries/:slug/qr.png', async (req, res) => {
  const { rows } = await q('SELECT 1 FROM tenants WHERE slug=$1 AND approved', [req.params.slug]);
  if (!rows[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const png = await bwip.toBuffer({ bcid: 'qrcode', text: brandedUrl(req), scale: 6, margin: 2 });
  res.setHeader('content-type', 'image/png');
  res.setHeader('cache-control', 'public, max-age=3600');
  res.send(png);
});

// E3.T3: כרטיס הדפסה לסניף
r.get('/laundries/:slug/card', async (req, res) => {
  const { rows } = await q('SELECT name, slogan, color, logo FROM tenants WHERE slug=$1 AND approved', [req.params.slug]);
  if (!rows[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  const t = rows[0];
  const escH = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>כרטיס סניף — ${escH(t.name)}</title>
<style>body{font-family:Arial,sans-serif;background:#fff;text-align:center;padding:30px}
.card{display:inline-block;border:2px solid ${escH(t.color || '#0e7a8a')};border-radius:16px;padding:28px 34px;max-width:340px}
h1{color:${escH(t.color || '#0e7a8a')};font-size:24px;margin:8px 0 2px}.s{color:#555;font-size:13px;margin-bottom:14px}
img{width:220px;height:220px}.u{direction:ltr;font-size:12px;color:#333;margin-top:8px}.pw{font-size:11px;color:#999;margin-top:14px}
@media print{.np{display:none}}</style></head><body>
<div class="card">
${t.logo ? `<img src="/api/laundries/${req.params.slug}/logo" style="width:70px;height:70px;object-fit:contain">` : ''}
<h1>${escH(t.name)}</h1>${t.slogan ? `<div class="s">${escH(t.slogan)}</div>` : ''}
<img src="/api/laundries/${req.params.slug}/qr.png" alt="QR">
<div class="u">${escH(brandedUrl(req))}</div>
<div class="s" style="margin-top:10px">סרקו להזמנת כביסה באפליקציה שלנו</div>
<div class="pw">מופעל ע״י מכבסה בקליק</div>
</div><div class="np" style="margin-top:16px"><button id="cardPrint" type="button">הדפסה</button></div>
<script src="/js/branch-card.js"></script></body></html>`);
});

// קונפיגורציה ציבורית ל-PWA
r.get('/config', (req, res) => {
  const { MODE, isDemo, SCREEN_OTP } = require('../config');
  res.json({
    mode: MODE,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    demoOtp: SCREEN_OTP(),
    whatsappOtp: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_WHATSAPP_FROM),
  });
});

module.exports = r;
