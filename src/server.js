const express = require('express');
const path = require('path');
const { migrate, q } = require('./db');

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', async (req, res) => {
  try { await q('SELECT 1'); res.json({ ok: true, ts: new Date().toISOString() }); }
  catch (e) { res.status(500).json({ ok: false }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/public'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/verify', require('./routes/verify'));
app.use('/api/t/:slug', require('./routes/tenant'));
app.use('/api/courier', require('./routes/courier'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/onboard', require('./routes/onboard'));
app.use('/api/bot', require('./routes/bot'));
app.use('/api/community', require('./routes/community'));
app.use('/api/bot-central', require('./routes/botcentral'));
app.use('/api/pay', require('./routes/pay'));
app.use('/api/subscriptions', require('./routes/subscriptions'));

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

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
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'server error' }); });

const PORT = process.env.PORT || 3000;
(async () => {
  await migrate();
  if (process.env.SEED_DEMO === 'true') {
    const { rows } = await q('SELECT count(*)::int AS n FROM tenants');
    if (rows[0].n === 0) { await require('./seed').run(); console.log('[db] demo seed done'); }
  }
  app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
})().catch(e => { console.error('boot failed', e); process.exit(1); });
