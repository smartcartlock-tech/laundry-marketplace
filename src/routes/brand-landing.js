// G3: עמוד נחיתה ממותג לכל מכבסה — /b/:slug. SSR מלא (מוכן לשיתוף: OG/Twitter meta פר-מכבסה),
// עם לוגו, שעות, אזור/תנאי שירות, מחירון וכפתור הזמנה שמוביל לאפליקציית המותג הלבן ב-/b/:slug/app.
// דמו בלבד: מוצג באנר דמו כש-APP_MODE=demo.
const express = require('express');
const r = express.Router();
const path = require('path');
const { q } = require('../db');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function hoursRows(hours) {
  const h = hours || {};
  if (!Object.keys(h).length) return '<tr><td>כל ימי השבוע</td><td>זמינות מלאה</td></tr>';
  return [0, 1, 2, 3, 4, 5, 6].map(d => {
    const rs = h[d];
    const txt = rs && rs.length ? rs.map(x => `${esc(x[0])}–${esc(x[1])}`).join(', ') : 'סגור';
    return `<tr><td>יום ${WD[d]}</td><td>${txt}</td></tr>`;
  }).join('');
}

function openNow(t) {
  if (!t.is_open) return false;
  const h = t.hours || {};
  if (!Object.keys(h).length) return true;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const rs = h[now.getDay()];
  if (!rs || !rs.length) return false;
  const hm = now.getHours() * 60 + now.getMinutes();
  return rs.some(x => {
    const m = String(x[0]).match(/(\d+):(\d+)/), n = String(x[1]).match(/(\d+):(\d+)/);
    return m && n && hm >= m[1] * 60 + +m[2] && hm <= n[1] * 60 + +n[2];
  });
}

r.get('/:slug/app', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html')));

r.get('/:slug', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT id, slug, name, letter, color, slogan, phone, address, city, services, hours,
              delivery_fee, min_order, is_open, rating, rating_count, logo IS NOT NULL AS has_logo
       FROM tenants WHERE slug = $1 AND approved`, [req.params.slug]);
    const t = rows[0];
    if (!t) return next(); // נתיב לא קיים — נופל ל-SPA/404 הרגיל
    const { rows: items } = await q(
      'SELECT name, price, unit FROM price_items WHERE tenant_id = $1 AND active ORDER BY name LIMIT 60', [t.id]);
    const { MODE } = require('../config');
    const color = /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '#0e7a8a';
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const url = `${proto}://${req.headers.host}/b/${encodeURIComponent(t.slug)}`;
    const appUrl = url + '/app';
    const shareUrl = url + '?utm_source=share&utm_medium=link&utm_campaign=branch';
    const desc = t.slogan || `כביסה באיסוף ומשלוח מ${t.name}${t.city ? ' ב' + t.city : ''} — מחירון שקוף והזמנה בקליק`;
    const open = openNow(t);
    const priceRows = items.map(i =>
      `<tr><td>${esc(i.name)}</td><td>₪${Number(i.price).toFixed(2)}${i.unit === 'item' ? '' : ' ל־ק״ג'}</td></tr>`).join('');
    const services = (t.services || []).map(s => `<span class="chip">${esc(s)}</span>`).join('');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.name)} — כביסה באיסוף ומשלוח</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="${esc(color)}">
<link rel="manifest" href="/api/laundries/${encodeURIComponent(t.slug)}/manifest.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="מכבסה בקליק">
<meta property="og:title" content="${esc(t.name)} — כביסה באיסוף ומשלוח">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${t.has_logo ? `<meta property="og:image" content="${proto}://${req.headers.host}/api/laundries/${encodeURIComponent(t.slug)}/logo">` : ''}
<meta name="twitter:card" content="summary">
<style>
:root{--c:${esc(color)}}
*{box-sizing:border-box}body{margin:0;font-family:Arial,'Segoe UI',sans-serif;background:#f5f8f9;color:#1d2b30}
.hero{background:linear-gradient(135deg,var(--c),#0a4b55);color:#fff;padding:34px 18px 26px;text-align:center}
.hero img{width:84px;height:84px;object-fit:contain;background:#fff;border-radius:18px;padding:8px}
.letter{width:84px;height:84px;border-radius:18px;background:#ffffff2e;display:inline-flex;align-items:center;justify-content:center;font-size:40px;font-weight:800}
h1{margin:12px 0 2px;font-size:26px}.slogan{opacity:.92;font-size:15px;margin:2px 0 10px}
.badge{display:inline-block;background:${open ? '#1fa04c' : '#b23b3b'};border-radius:999px;padding:4px 14px;font-size:13px;font-weight:700}
.rate{font-size:13px;opacity:.9;margin-top:8px}
.wrap{max-width:640px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:14px;padding:16px 18px;margin:12px 0;box-shadow:0 1px 4px #0001}
.card h2{font-size:17px;margin:0 0 10px;color:var(--c)}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:7px 4px;border-top:1px solid #eef2f4}td:last-child{text-align:left;direction:ltr}
.chip{display:inline-block;background:#0e7a8a14;color:var(--c);border:1px solid #0e7a8a33;border-radius:999px;padding:3px 12px;font-size:13px;margin:2px}
.cta{display:block;background:linear-gradient(120deg,var(--c),#0a4b55);color:#fff;text-align:center;text-decoration:none;font-size:19px;font-weight:800;padding:16px;border-radius:14px;margin:14px 0;box-shadow:0 2px 8px #0002}
.sub{display:block;text-align:center;color:var(--c);font-size:14px;text-decoration:none;margin:6px 0}
.mut{color:#6b7a80;font-size:13px}
.demo{background:#c07a1a;color:#fff;text-align:center;font-size:12px;padding:6px;position:sticky;top:0;z-index:5}
.foot{text-align:center;color:#93a3a9;font-size:12px;margin:18px 0}
</style></head><body>
${MODE === 'demo' ? '<div class="demo">סביבת דמו — הנתונים להמחשה בלבד · אין חיוב ואין משלוח אמיתיים</div>' : ''}
<div class="hero">
 ${t.has_logo ? `<img src="/api/laundries/${encodeURIComponent(t.slug)}/logo" alt="${esc(t.name)}">` : `<span class="letter">${esc(t.letter || t.name[0])}</span>`}
 <h1>${esc(t.name)}</h1>
 ${t.slogan ? `<div class="slogan">${esc(t.slogan)}</div>` : ''}
 <span class="badge">${open ? 'פתוח עכשיו — מקבלים הזמנות' : 'סגור כרגע'}</span>
 ${t.rating_count ? `<div class="rate">★ ${Number(t.rating).toFixed(1)} (${t.rating_count} דירוגים)</div>` : ''}
</div>
<div class="wrap">
 <a class="cta" href="${esc(appUrl)}">הזמנת כביסה עכשיו 🧺</a>
 <div class="card"><h2>אזור ותנאי שירות</h2>
  <div>${esc(t.address || '')}${t.city ? `, ${esc(t.city)}` : ''}</div>
  <div class="mut" style="margin-top:4px">משלוח: ₪${Number(t.delivery_fee).toFixed(2)}${Number(t.min_order) > 0 ? ` · מינימום הזמנה ₪${Number(t.min_order).toFixed(2)}` : ' · אין מינימום הזמנה'}</div>
  ${services ? `<div style="margin-top:8px">${services}</div>` : ''}
  ${t.phone ? `<div class="mut" style="margin-top:8px" dir="ltr">${esc(t.phone)}</div>` : ''}
 </div>
 <div class="card"><h2>שעות פעילות</h2><table>${hoursRows(t.hours)}</table></div>
 ${items.length ? `<div class="card"><h2>מחירון</h2><table>${priceRows}</table></div>` : ''}
 <a class="sub" href="/api/laundries/${encodeURIComponent(t.slug)}/card">🖨️ כרטיס QR להדפסה</a>
 <a class="sub" href="${esc(shareUrl)}">🔗 קישור לשיתוף העמוד</a>
 <div class="foot">מופעל ע״י מכבסה בקליק — כל המכבסות באזורך במקום אחד</div>
</div>
</body></html>`);
  } catch (e) { console.error(e); res.status(500).send('שגיאת שרת'); }
});

module.exports = r;
