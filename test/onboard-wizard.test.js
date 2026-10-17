// B3: טיוטת אשף הקמה (שמירה/שחזור/מחיקה) + חילוץ Gemini מדומה (GEMINI_BASE_URL לשרת סטאב — בלי קריאה אמיתית)
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { Pool } = require('pg');
const { startApp, TEST_DB } = require('./helpers');

// PNG מינימלי תקין (1x1) כדי לעבור את verifyFile
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('draft: save, restore, delete — per user', async (t) => {
  const { api, schema } = await startApp(t);
  const pool = new Pool({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  t.after(() => pool.end());
  const token = await api.login('+972509950001', 'מקים טיוטה');
  const other = await api.login('+972509950002', 'אחר');

  let r = await api('/api/onboard/draft', { method: 'POST', token, body: { draft: { name: 'מכבסת טיוטה', items: [{ name: 'חולצה', price: 12 }] } } });
  assert.equal(r.status, 200);
  let g = await api('/api/onboard/draft', { token });
  assert.equal(g.json.draft.name, 'מכבסת טיוטה');
  assert.equal(g.json.draft.items.length, 1);
  assert.ok(g.json.updated_at);

  g = await api('/api/onboard/draft', { token: other });
  assert.equal(g.json.draft, null, 'טיוטה לא דולפת בין משתמשים');

  r = await api('/api/onboard/draft', { method: 'POST', token, body: { draft: { name: 'גרסה חדשה' } } });
  assert.equal(r.status, 200);
  g = await api('/api/onboard/draft', { token });
  assert.equal(g.json.draft.name, 'גרסה חדשה', 'upsert מעדכן');

  r = await api('/api/onboard/draft', { method: 'DELETE', token });
  assert.equal(r.status, 200);
  g = await api('/api/onboard/draft', { token });
  assert.equal(g.json.draft, null);

  r = await api('/api/onboard/draft', { method: 'POST', body: { draft: { name: 'x' } } });
  assert.equal(r.status, 401, 'דורש התחברות');
});

test('extract: mocked Gemini returns confidence fields end-to-end', async (t) => {
  // שרת Gemini מדומה
  const geminiReply = { candidates: [{ content: { parts: [{ text: JSON.stringify({
    name: 'מכבסת הבדיקה', phone: '0501234567', city: 'תל אביב',
    items: [{ name: 'חולצה', price: 12, unit: 'item', category: 'כביסה', confidence: 'high' },
            { name: 'מעיל', price: 45, unit: 'item', category: 'ניקוי יבש', confidence: 'low' }],
    hours: { 0: [['08:00', '20:00']] }, hours_confidence: 'low', terms: 'תקנון לדוגמה', delivery_fee: 15, notes: 'דולגו 2 פריטים',
  }) }] } }] };
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(geminiReply)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());

  const port = 5500 + (process.pid % 200) + Math.floor(Math.random() * 90);
  const schema = 'test_' + Math.random().toString(36).slice(2, 8);
  const env = { ...process.env, DATABASE_URL: TEST_DB, PGSCHEMA: schema, SEED_DEMO: 'true', DEMO_OTP: 'true', OTP_SCREEN_CODE: 'true',
    PORT: String(port), JWT_SECRET: 'test-secret', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '',
    GEMINI_API_KEY: 'fake-key', GEMINI_BASE_URL: `http://127.0.0.1:${srv.address().port}/` };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env });
  t.after(() => { try { child.kill('SIGKILL'); } catch (e) {} });
  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try { const r = await fetch(base + '/health'); if (r.ok) break; } catch (e) {}
    if (child.exitCode !== null) throw new Error('server exited early');
    await new Promise(r => setTimeout(r, 400));
  }
  const login = async () => {
    const req = await (await fetch(base + '/api/auth/otp/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: '+972509950003' }) })).json();
    const ver = await (await fetch(base + '/api/auth/otp/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: '+972509950003', code: req.demoCode, name: 'מקים' }) })).json();
    return ver.token;
  };
  const token = await login();
  const fd = new FormData();
  fd.append('files', new Blob([PNG_1PX], { type: 'image/png' }), 'price.png');
  const r = await fetch(base + '/api/onboard/extract', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.draft.items.length, 2);
  assert.equal(d.draft.items[1].confidence, 'low', 'רמת ביטחון עוברת מקצה לקצה');
  assert.equal(d.draft.hours_confidence, 'low');
  assert.equal(d.draft.delivery_fee, 15);
});
