// E8.T2: דפי SEO לפי עיר/שכונה — HTML משרת מלא, sitemap.xml, robots.txt
const express = require('express');
const { q } = require('../db');

const r = express.Router();
const BASE = () => (process.env.APP_BASE_URL || 'https://laundry-marketplace-ay5h.onrender.com').replace(/\/$/, '');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page({ title, description, canonical, body }) {
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<style>
body{font-family:'Noto Sans Hebrew','Segoe UI',Arial,sans-serif;background:#f5f8f9;color:#17303a;margin:0}
header{background:linear-gradient(120deg,#0a4f5c,#12869b);color:#fff;padding:28px 20px;text-align:center}
header h1{margin:0 0 6px;font-size:26px}header p{margin:0;opacity:.85;font-size:14px}
main{max-width:920px;margin:0 auto;padding:20px 16px 40px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.card{background:#fff;border:1px solid #e2eaee;border-radius:14px;padding:16px;text-decoration:none;color:inherit;display:block;box-shadow:0 1px 4px rgba(0,0,0,.04)}
.card b{font-size:16px}.mut{color:#6b7d88;font-size:13px;margin-top:5px}
.tag{display:inline-block;background:#e6f4f6;color:#0e7a8a;border-radius:12px;font-size:11.5px;padding:2px 9px;margin-inline-start:6px}
.cta{display:block;text-align:center;background:#0e7a8a;color:#fff;border-radius:12px;padding:14px;text-decoration:none;font-weight:700;margin-top:22px}
nav.cities{margin:0 0 18px;font-size:13px}nav.cities a{color:#0e7a8a;text-decoration:none;margin-inline-end:10px}
</style></head><body>${body}</body></html>`;
}

async function laundriesByCity(city) {
  const { rows } = await q(
    `SELECT t.slug, t.name, t.city, t.address, t.services, t.is_open, t.delivery_fee, t.min_order,
            (SELECT min(price) FROM price_items i WHERE i.tenant_id=t.id AND i.active) AS from_price,
            (SELECT round(avg(rating)::numeric,1) FROM reviews rv WHERE rv.tenant_id=t.id) AS rating,
            (SELECT count(*) FROM reviews rv WHERE rv.tenant_id=t.id)::int AS rating_count
     FROM tenants t WHERE t.approved AND t.city ILIKE $1 ORDER BY t.name`, [city]);
  return rows;
}

function laundryCards(rows) {
  if (!rows.length) return '<p class="mut">עדיין אין מכבסות פעילות באזור זה — הצטרפו אלינו ונהיו הראשונים.</p>';
  return '<div class="grid">' + rows.map(l => `<a class="card" href="/#/laundry/${esc(l.slug)}">
  <b>${esc(l.name)}</b>${l.is_open ? '<span class="tag">פתוח</span>' : '<span class="tag" style="background:#fdeaea;color:#c22">סגור</span>'}
  <div class="mut">${l.rating_count >= 3 ? `★ ${l.rating} (${l.rating_count} ביקורות) · ` : ''}${esc(l.address || l.city || '')}</div>
  <div class="mut">${(l.services || []).map(esc).join(' · ') || 'כביסה וניקוי יבש'}</div>
  <div class="mut">שליחות ₪${l.delivery_fee || 0}${Number(l.min_order) > 0 ? ' · מינימום ₪' + l.min_order : ''}${l.from_price ? ' · החל מ־₪' + l.from_price : ''}</div>
 </a>`).join('') + '</div>';
}

r.get('/area/:city', async (req, res) => {
  const city = decodeURIComponent(req.params.city).trim();
  if (!city || city.length > 60) return res.status(404).send('not found');
  const rows = await laundriesByCity(city);
  const { rows: cities } = await q('SELECT DISTINCT city FROM tenants WHERE approved AND city IS NOT NULL ORDER BY city', []);
  const title = `מכבסות ב${city} — איסוף ומשלוח | מכבסה בקליק`;
  const description = rows.length
    ? `${rows.length} מכבסות ב${city} עם איסוף ומשלוח עד הבית: ${rows.slice(0, 3).map(x => x.name).join(', ')}${rows.length > 3 ? ' ועוד' : ''}. הזמנה אונליין, מחירון שקוף, תשלום מאובטח.`
    : `מכבסות ב${city} עם איסוף ומשלוח עד הבית. הזמנה אונליין דרך מכבסה בקליק.`;
  res.type('html').send(page({
    title, description, canonical: `${BASE()}/area/${encodeURIComponent(city)}`,
    body: `<header><h1>מכבסות ב${esc(city)}</h1><p>איסוף ומשלוח עד הבית · הזמנה אונליין · מחירון שקוף</p></header>
<main>
 <nav class="cities">${cities.filter(c => c.city !== city).map(c => `<a href="/area/${encodeURIComponent(c.city)}">מכבסות ב${esc(c.city)}</a>`).join('')}</nav>
 ${laundryCards(rows)}
 <a class="cta" href="/">להזמנה במכבסה בקליק ←</a>
</main>` }));
});

r.get('/sitemap.xml', async (req, res) => {
  const { rows } = await q('SELECT slug, city FROM tenants WHERE approved ORDER BY created_at', []);
  const cities = [...new Set(rows.map(x => x.city).filter(Boolean))];
  const urls = [
    { loc: BASE() + '/', priority: '1.0' },
    ...cities.map(c => ({ loc: `${BASE()}/area/${encodeURIComponent(c)}`, priority: '0.8' })),
    ...rows.map(x => ({ loc: `${BASE()}/laundry/${x.slug}`, priority: '0.7' })),
  ];
  res.type('application/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => ` <url><loc>${esc(u.loc)}</loc><changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n');
});

r.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /api/
Sitemap: ${BASE()}/sitemap.xml
`);
});

module.exports = r;
