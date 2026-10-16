// B3: מפתחות בוט נשמרים כ-hash בלבד — GET לא חושף, רוטציה מחזירה פעם אחת, מפתח ישן מת
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp, TEST_DB } = require('./helpers');
const { Client } = require('pg');
const crypto = require('crypto');

test('B3: מפתחות מגובבים ב-DB; רוטציה מחזירה גלוי פעם אחת; ישן מת; חדש עובד', async (t) => {
  const { api, schema } = await startApp(t);
  const admin = await api.login('+972500000001');

  const db = new Client({ connectionString: TEST_DB, options: `-c search_path=${schema},public` });
  await db.connect();
  t.after(() => db.end());
  const { rows: ten } = await db.query(`SELECT id, api_key, api_key_hash FROM tenants WHERE slug='achuza'`);
  assert.equal(ten[0].api_key, null, 'אין מפתח גלוי ב-DB');
  // DB טרי (seed אחרי מיגרציה): עדיין אין מפתח בכלל — מתחילים מרוטציה. DB קיים (פרוד) מגובב במקום.
  assert.equal(ten[0].api_key_hash, null);

  // GET לא מחזיר מפתח — רק מטא
  const meta = await api(`/api/admin/tenants/${ten[0].id}/apikey`, { token: admin });
  assert.equal(meta.status, 200);
  assert.equal(meta.json.api_key, undefined, 'GET לא חושף מפתח');
  assert.equal(meta.json.has_key, false);

  // רוטציה: מחזירה גלוי פעם אחת, הגלוי עובד, והישן (שהיה ב-DB כ-hash) מת
  const rot = await api(`/api/admin/tenants/${ten[0].id}/apikey/rotate`, { method: 'POST', token: admin });
  assert.equal(rot.status, 200);
  const key = rot.json.api_key;
  assert.match(key, /^[0-9a-f]{48}$/);

  const { rows: after } = await db.query(`SELECT api_key, api_key_hash FROM tenants WHERE id=$1`, [ten[0].id]);
  assert.equal(after[0].api_key, null, 'גם אחרי רוטציה אין גלוי ב-DB');
  assert.equal(after[0].api_key_hash, crypto.createHash('sha256').update(key).digest('hex'));
  assert.match(after[0].api_key_hash, /^[0-9a-f]{64}$/, 'שמור sha256 בלבד');

  const ok = await api('/api/bot/pricelist', { apiKey: key });
  assert.equal(ok.status, 200, 'המפתח החדש עובד מול /api/bot');
  const bad = await api('/api/bot/pricelist', { apiKey: 'f'.repeat(48) });
  assert.equal(bad.status, 401);

  // GET שוב — לא חושף גם אחרי רוטציה
  const meta2 = await api(`/api/admin/tenants/${ten[0].id}/apikey`, { token: admin });
  assert.equal(meta2.json.api_key, undefined);
});
