// הצפנה ברמת שדה לנתונים פיננסיים + הרשאת "בעלים בלבד"
process.env.NODE_ENV = 'test';
process.env.FIELD_ENC_KEY = process.env.FIELD_ENC_KEY || Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
process.env.BACKUP_KEY = process.env.BACKUP_KEY || Buffer.from('fedcba9876543210fedcba9876543210').toString('base64');
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');
const { encryptField, decryptField, maskField } = require('../src/fieldcrypto');

test('fieldcrypto: round-trip, איתור שיבוש, הסתרה', () => {
  const enc = encryptField('12-345-678901');
  assert.ok(enc.startsWith('v1.'), enc);
  assert.ok(!enc.includes('678901'), 'אין plaintext במוצפן');
  assert.equal(decryptField(enc), '12-345-678901');
  assert.equal(maskField(enc), '••••8901');
  assert.throws(() => decryptField(enc.slice(0, -3) + 'AAA'), 'שיבוש מתגלה');
  assert.equal(decryptField('legacy-plain'), 'legacy-plain', 'קריאה שקופה של מידע ישן');
});

test('financials: בעלים כותב/קורא מוסתר; staff/זר/לקוח נדחים; ב-DB אין plaintext', async (t) => {
  const { api, schema } = await startApp(t);
  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test' });
  await db.connect(); t.after(() => db.end());
  await db.query(`SET search_path TO ${schema}, public`);

  const owner = await api.login('+972500000911');
  // יצירת מכבסה לבעלים דרך onboarding ידני: נשתמש במכבסת דמו ונוסיף את owner כבעלים
  const { rows: [ten] } = await db.query(`INSERT INTO tenants(slug, name) VALUES ('fintest', 'מכבסת פין-טסט') RETURNING id`);
  await db.query(`INSERT INTO tenant_members(tenant_id, user_id, role)
    SELECT $1, id, 'owner' FROM users WHERE phone='+972500000911'`, [ten.id]);

  const put = await api('/api/t/fintest/financials', { method: 'PUT', token: owner,
    body: { bank_code: '10', branch: '800', account_number: '123456789', iban: 'IL550108000000012345678', beneficiary: 'מכבסת פין-טסט בע"מ' } });
  assert.equal(put.status, 200, JSON.stringify(put.json));

  const get = await api('/api/t/fintest/financials', { token: owner });
  assert.equal(get.status, 200);
  assert.equal(get.json.financials.account_number, '••••6789');
  assert.equal(get.json.financials.iban, '••••5678');
  assert.ok(get.json.has_data);

  const raw = await db.query('SELECT account_number_enc, iban_enc FROM tenant_financials WHERE tenant_id=$1', [ten.id]);
  assert.ok(raw.rows[0].account_number_enc.startsWith('v1.'));
  assert.ok(!raw.rows[0].iban_enc.includes('IL55010800'), 'אין IBAN גלוי ב-DB');

  // staff לא נכנס
  const staff = await api.login('+972500000912');
  await db.query(`INSERT INTO tenant_members(tenant_id, user_id, role)
    SELECT $1, id, 'staff' FROM users WHERE phone='+972500000912'`, [ten.id]);
  assert.equal((await api('/api/t/fintest/financials', { token: staff })).status, 403);
  assert.equal((await api('/api/t/fintest/financials', { method: 'PUT', token: staff, body: {} })).status, 403);
  // זר לגמרי
  const stranger = await api.login('+972500000913');
  assert.equal((await api('/api/t/fintest/financials', { token: stranger })).status, 403);
});
