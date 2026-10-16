// B2: קוד OTP נשמר כ-hash, קוד שגוי מוותר על ניסיונות, אחרי 10 ניסיונות הקוד ננעל
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');

test('B2: OTP — hash בלבד ב-DB, מגבלת 10 ניסיונות לקוד', async (t) => {
  const { api, schema } = await startApp(t);
  const phone = '+972500000401';

  const req1 = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
  assert.match(req1.json.demoCode, /^\d{6}$/);

  // ה-DB לא מכיל את הקוד הגלוי — רק hash
  const c = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  await c.connect();
  t.after(() => c.end());
  const { rows } = await c.query('SELECT code, code_hash, attempts FROM otp_codes WHERE target=$1', [phone]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, null, 'אין קוד גלוי ב-DB');
  assert.match(rows[0].code_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(rows[0].code_hash, req1.json.demoCode);

  // ניסיון שגוי — attempts עולה, עדיין לא ננעל
  const bad1 = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: '000000' } });
  assert.equal(bad1.status, 401);
  const { rows: after1 } = await c.query('SELECT attempts FROM otp_codes WHERE target=$1', [phone]);
  assert.equal(after1[0].attempts, 1);

  // קוד נכון עובד אחרי ניסיון שגוי
  const ok = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: req1.json.demoCode } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(ok.json.token);
});

test('B2: 10 ניסיונות שגויים נועלים את הקוד — גם הקוד הנכון נדחה', async (t) => {
  const { api, schema } = await startApp(t);
  const phone = '+972500000402';
  const req1 = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
  for (let i = 0; i < 3; i++) {
    const r = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: '000000' } });
    assert.equal(r.status, 401, 'attempt ' + i);
  }
  // מדמים הגעה לתקרה: 10 ניסיונות שגויים על אותו קוד (בלי לגעת במגבלת הקצב הכללית)
  const c = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  await c.connect();
  t.after(() => c.end());
  await c.query('UPDATE otp_codes SET attempts=10 WHERE target=$1', [phone]);
  const locked = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: req1.json.demoCode } });
  assert.equal(locked.status, 429, 'קוד ננעל אחרי 10 ניסיונות');
  assert.match(locked.json.error, /בקשו קוד חדש/);
  // קוד חדש נותן התחלה נקייה
  const req2 = await api('/api/auth/otp/request', { method: 'POST', body: { target: phone } });
  const ok = await api('/api/auth/otp/verify', { method: 'POST', body: { target: phone, code: req2.json.demoCode } });
  assert.equal(ok.status, 200);
});
