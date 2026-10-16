// שחזור אמיתי של גיבוי מוצפן: יוצרים גיבוי מהבסיס המקומי ומשחזרים אותו בפועל
// לסכימה נפרדת באותו אינסטנס (בלי לגעת בנתוני הבדיקה), ומשווים ספירות שורות בכל טבלה.
const { test } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';
process.env.BACKUP_KEY = process.env.BACKUP_KEY || Buffer.from('fedcba9876543210fedcba9876543210').toString('base64');

test('שחזור אמיתי: גיבוי → פענוח → סכימה נפרדת → ספירות זהות בכל הטבלאות', async (t) => {
  const { startApp } = require('./helpers');
  const { api, schema: appSchema } = await startApp(t);
  const admin = await api.login('+972500000001');
  const made = await api('/api/admin/backup/encrypted', { method: 'POST', token: admin });
  assert.equal(made.status, 201, JSON.stringify(made.json));

  const { pool } = require('../src/db');
  const { rows } = await pool.query(`SELECT payload FROM "${appSchema}".encrypted_backups WHERE id=$1`, [made.json.id]);
  const { restoreToSchema } = require('../src/restore');
  const schema = 'restore_test_' + Date.now().toString(36);
  const res = await restoreToSchema(rows[0].payload, { connectionString: process.env.DATABASE_URL, schema });
  assert.equal(res.ok, true, 'mismatches: ' + JSON.stringify(res.mismatches).slice(0, 300));
  assert.ok(res.tables > 10);
});
