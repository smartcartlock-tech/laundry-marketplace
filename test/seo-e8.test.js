const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startApp } = require('./helpers');

test('E8.T2: דף SEO לעיר — HTML מלא, title/description/canonical דינמיים', async (t) => {
  const { base } = await startApp(t);
  const r = await fetch(base + '/area/' + encodeURIComponent('חיפה'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.ok(html.includes('<title>מכבסות בחיפה'), 'title דינמי');
  assert.ok(html.includes('name="description"'), 'description');
  assert.ok(html.includes('rel="canonical" href="'), 'canonical');
  assert.ok(html.includes('/area/%D7%97%D7%99%D7%A4%D7%94') || html.includes('/area/חיפה'), 'canonical מצביע לדף העיר');
  assert.ok(html.includes('מכבסת הכרמל'), 'מכבסה אמיתית מה-DB מופיעה');
  assert.ok(html.includes('dir="rtl"'), 'RTL');
  // עיר לא קיימת — 404 (דרישת QA)
  const empty = await fetch(base + '/area/' + encodeURIComponent('עיירת פלא'));
  assert.equal(empty.status, 404);
});

test('E8.T2: sitemap.xml ו-robots.txt תקינים', async (t) => {
  const { base } = await startApp(t);
  const sm = await fetch(base + '/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get('content-type'), /xml/);
  const xml = await sm.text();
  assert.ok(xml.startsWith('<?xml version="1.0"'));
  assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  assert.ok(xml.includes('/area/'), 'כולל דפי ערים');
  assert.ok(xml.includes('/laundry/achuza'), 'כולל מכבסות');
  const rb = await fetch(base + '/robots.txt');
  assert.equal(rb.status, 200);
  const robots = await rb.text();
  assert.ok(robots.includes('User-agent: *'));
  assert.ok(robots.includes('Sitemap: '), 'robots מפנה ל-sitemap');
  assert.ok(robots.includes('Disallow: /api/'), 'API חסום לסריקה');
});

test('E8.T1: גרסת דסקטופ — פריסה רחבה ב-1280px+ ללא שבירת מובייל', async () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.ok(css.includes('@media(min-width:1280px)'), 'breakpoint דסקטופ 1280px');
  assert.ok(css.includes('.home-grid'), 'רשת כרטיסים');
  assert.ok(css.includes('.home-side'), 'סרגל סינון');
  assert.ok(css.includes('@media(min-width:900px)'), 'breakpoint ביניים נשמר');
  assert.ok(css.includes('@media (max-width:640px)'), 'מובייל לא נשבר');
  const app = fs.readdirSync(path.join(__dirname, '..', 'public', 'js')).map(f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n'); // app.js פוצל למודולים (F1)
  assert.ok(app.includes('class="home-wrap"'), 'מבנה דסקטופ בעמוד הבית');
  assert.ok(app.includes('function homeFilter()'), 'סינון שירות/דירוג/זמינות');
});
