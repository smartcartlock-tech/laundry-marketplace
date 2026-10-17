// A4: ספק OTP מוחלף — בחירת ספק לפי OTP_PROVIDER/מצב, בלי הודעות אמיתיות (סימולציה דרך שרת בוט מדומה)
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { TEST_DB } = require('./helpers');

async function stubBot(t, reply) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      calls.push(JSON.parse(b || '{}'));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { url: `http://127.0.0.1:${srv.address().port}`, calls };
}

async function startWith(t, extraEnv) {
  const port = 5400 + (process.pid % 200) + Math.floor(Math.random() * 90);
  const schema = 'test_' + Math.random().toString(36).slice(2, 8);
  const env = { ...process.env, DATABASE_URL: TEST_DB, PGSCHEMA: schema, SEED_DEMO: 'false', DEMO_OTP: 'true',
    PORT: String(port), JWT_SECRET: 'test-secret', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '',
    BOT_OUTBOUND_URL: '', BOT_OUTBOUND_KEY: '', ...extraEnv };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env });
  const base = `http://127.0.0.1:${port}`;
  t.after(() => { try { child.kill('SIGKILL'); } catch (e) {} });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try { const r = await fetch(base + '/health'); if (r.ok) break; } catch (e) {}
    if (child.exitCode !== null) throw new Error('server exited early');
    await new Promise(r => setTimeout(r, 400));
  }
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
  return { base, post };
}

test('pilot + bot bridge: code goes through the bot, never shown on screen', async (t) => {
  const bot = await stubBot(t, { status: 'sent' });
  const { post } = await startWith(t, { APP_MODE: 'pilot', BOT_OUTBOUND_URL: bot.url, BOT_OUTBOUND_KEY: 'k' });
  const r = await post('/api/auth/otp/request', { target: '+972509920001' });
  assert.equal(r.status, 200);
  assert.equal(r.json.channel, 'whatsapp');
  assert.equal(r.json.demoCode, undefined, 'ב-pilot הקוד לא מוצג');
  assert.equal(bot.calls.length, 1, 'הקוד נשלח דרך גשר הבוט');
  assert.match(bot.calls[0].body, /\d{6}/, 'גוף ההודעה מכיל קוד בן 6 ספרות');
});

test('pilot + forced demo provider: blocked (503) — no code leak', async (t) => {
  const { post } = await startWith(t, { APP_MODE: 'pilot', OTP_PROVIDER: 'demo' });
  const r = await post('/api/auth/otp/request', { target: '+972509920002' });
  assert.equal(r.status, 503);
  assert.equal(r.json.demoCode, undefined);
});

test('pilot + bot down (auto): 503, no silent demo fallback', async (t) => {
  const { post } = await startWith(t, { APP_MODE: 'pilot', BOT_OUTBOUND_URL: 'http://127.0.0.1:1', BOT_OUTBOUND_KEY: 'k' });
  const r = await post('/api/auth/otp/request', { target: '+972509920003' });
  assert.equal(r.status, 503);
});

test('demo + bot simulated: code shown on screen (demo keeps working)', async (t) => {
  const bot = await stubBot(t, { status: 'simulated' });
  const { post } = await startWith(t, { APP_MODE: 'demo', BOT_OUTBOUND_URL: bot.url, BOT_OUTBOUND_KEY: 'k', OTP_SCREEN_CODE: 'true' }); // קוד על המסך רק עם דגל הבדיקות (כלל חדש 17.10)
  const r = await post('/api/auth/otp/request', { target: '+972509920004' });
  assert.equal(r.status, 200);
  assert.match(String(r.json.demoCode), /^\d{6}$/, 'בדמו הקוד מוצג כרגיל');
});
