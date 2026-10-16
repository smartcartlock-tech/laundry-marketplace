const express = require('express');
const path = require('path');
const { migrate, q } = require('./db');

const app = express();
app.disable('x-powered-by');
// כותרות אבטחה מתונות (בלי תלות חדשה) — SPA עם inline handlers, לכן CSP מתיר inline
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob:; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; font-src 'self'; object-src 'none'; base-uri 'self'");
  next();
});
// ביצועים: דחיסת gzip/deflate לכל התגובות (app.js לבדו ~165KB → ~35KB)
app.use(require('compression')());
app.use(express.json({ limit: '2mb' }));

app.get('/health', async (req, res) => {
  try { await q('SELECT 1'); res.json({ ok: true, ts: new Date().toISOString() }); }
  catch (e) { res.status(500).json({ ok: false }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/public'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/orders', require('./routes/order-reports')); // E7.T3+E9.T1: דיווחי תקלות לקוח
app.use('/api', require('./routes/issue-photos')); // E9.T1: תמונות תקלה
app.use('/api/documents', require('./routes/documents'));
app.use('/api/verify', require('./routes/verify'));
app.use('/api/t/:slug/business-accounts', require('./routes/business'));
app.use('/api/t/:slug', require('./routes/tenant'));
app.use('/api/t/:slug', require('./routes/issues')); // E9.T1: טיפול מכבסה בתקלות
app.use('/api/t/:slug', require('./routes/tenant-label')); // C4: תווית/דף איסוף PDF
app.use('/api/t/:slug', require('./routes/tenant-ops')); // C5: סיכום יום תפעולי
app.use('/api/t/:slug', require('./routes/tenant-checklist')); // B1: צ'ק-ליסט מוכנות
app.use('/api/courier', require('./routes/courier'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin', require('./routes/adminplus')); // E7: dashboard/onboarding/sla
app.use('/api/admin', require('./routes/errlog')); // ניטור: יומן תקלות לאדמין
app.use('/api/admin', require('./routes/backup')); // גיבוי: ייצוא נתונים מלא לאדמין
app.use('/api/onboard', require('./routes/onboard'));
app.use('/api/bot', require('./routes/bot'));
app.use('/api/community', require('./routes/community'));
app.use('/api/bot-central', require('./routes/botcentral'));
app.use('/api/pay', require('./routes/pay'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/addresses', require('./routes/addresses')); // E13.T2: כתובות שמורות
app.use('/api/cart', require('./routes/cart')); // E14.T1: עגלה בענן
app.use('/api', require('./routes/push')); // E9.T3: web push

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

app.get('/favicon.ico', (req, res) => res.redirect(301, '/icon-192.png'));
app.use('/', require('./routes/seo')); // E8.T2: /area/:city, sitemap.xml, robots.txt

// PWA סטטי + נפילה ל-index.html לנתיבי SPA
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (/icon-\d+\.png$|manifest\.webmanifest$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
    else res.setHeader('Cache-Control', 'no-cache'); // html/css/js/sw תמיד עם אימות מחדש מול השרת
  }
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
// E4.T2: job הזמנות חוזרות — רץ בהפעלה ואחת לשעה (שרת יחיד ב-Render)
const { generateDueOrders } = require('./recurring');
const runRecurring = () => generateDueOrders(require('./db').q).catch(e => console.error('[recurring]', e.message));
const { issueMonthlyInvoices } = require('./billing');
require('./retention').startRetention(); // C3: מחיקת נתונים שפגו/ישנים
const runMonthlyBilling = () => issueMonthlyInvoices(require('./db').q).catch(e => console.error('[billing]', e.message));
setTimeout(runMonthlyBilling, 20000);
setInterval(runMonthlyBilling, 60 * 60 * 1000);
setTimeout(runRecurring, 15000);
setInterval(runRecurring, 60 * 60 * 1000);

app.use(require('./errlog').errorHandler);

const PORT = process.env.PORT || 3000;
(async () => {
  await migrate();
  await require('./documents').migrateDocumentIntegrity().catch(e => console.error('[documents] integrity migration failed:', e.message));
  await require('./errlog').migrateErrorLog().catch(e => console.error('[errlog] migration failed:', e.message));
  if (process.env.SEED_DEMO === 'true') {
    const { rows } = await q('SELECT count(*)::int AS n FROM tenants');
    if (rows[0].n === 0) { await require('./seed').run(); console.log('[db] demo seed done'); }
  }
  app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
})().catch(e => { console.error('boot failed', e); process.exit(1); });
