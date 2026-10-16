// תיקוני שלמות נתונים: signature/sha256 write-once, ייצוא בלי encrypted_backups,
// PUT פיננסים חלקי, פענוח בטוח, דוח שלמות בלי תיקון אוטומטי
const { test, before } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/laundry_test';
process.env.BACKUP_KEY = process.env.BACKUP_KEY || Buffer.from('fedcba9876543210fedcba9876543210').toString('base64');

// אפליקציה משותפת לכל הבדיקות בקובץ (ה-pool נקשר לסכימה שלה ב-require הראשון);
// ההקשר של before חי עד סוף הקובץ, ולכן ה-t.after של השרת לא הורס את הבדיקות הבאות
let CTX = null;
before(async (t) => {
  CTX = await startApp(t);
  process.env.PGSCHEMA = CTX.schema;
});
function app() { return CTX; }

test('יחידה: safeDecryptField מחזיר null על מידע פגום בלי לזרוק', () => {
  const { safeDecryptField, encryptField } = require('../src/fieldcrypto');
  assert.equal(safeDecryptField('v1.garbage.bad.data', 't'), null);
  const good = encryptField('1234');
  assert.equal(safeDecryptField(good, 't'), '1234');
});

test('טריגר: signature/sha256 write-once (NULL->ערך מותר, החלפה נדחית)', async (t) => {
  app();
  const { pool } = require('../src/db');
  const { rows: tn } = await pool.query('SELECT id FROM tenants LIMIT 1');
  const { rows: us } = await pool.query('SELECT id FROM users LIMIT 1');
  const { rows: d } = await pool.query(
    `INSERT INTO documents(tenant_id, customer_id, kind, doc_year, doc_number, amount, vat, total, issued_at, signature)
     VALUES ($1,$2,'receipt',2026,900001,100,17,117,now(),'orig-sig') RETURNING id`, [tn[0].id, us[0].id]);
  const id = d[0].id;
  // NULL -> ערך מותר (backfill)
  await pool.query('UPDATE documents SET sha256=$2 WHERE id=$1', [id, 'a'.repeat(64)]);
  // החלפות נדחות
  await assert.rejects(pool.query('UPDATE documents SET sha256=$2 WHERE id=$1', [id, 'b'.repeat(64)]), /write-once/);
  await assert.rejects(pool.query(`UPDATE documents SET signature='tampered' WHERE id=$1`, [id]), /write-once/);
  // מחיקה נדחית
  await assert.rejects(pool.query('DELETE FROM documents WHERE id=$1', [id]), /immutable/);
});

test('ייצוא admin לא כולל encrypted_backups / schema_migrations', async (t) => {
  const { api } = app();
  const admin = await api.login('+972500000001');
  const ex = await api('/api/admin/export', { token: admin });
  assert.equal(ex.status, 200);
  assert.ok(!('encrypted_backups' in ex.json.tables), 'encrypted_backups מוחרגת');
  assert.ok(!('schema_migrations' in ex.json.tables), 'schema_migrations מוחרגת');
});

test('PUT פיננסים חלקי: שדות שלא נשלחו נשמרים', async (t) => {
  const { api } = app();
  const owner = await api.login('+972500000003');
  const put1 = await api('/api/t/achuza/financials', { method: 'PUT', token: owner, body: { bank_code: '12', account_number: '999888' } });
  assert.equal(put1.status, 200, JSON.stringify(put1.json));
  const put2 = await api('/api/t/achuza/financials', { method: 'PUT', token: owner, body: { beneficiary: 'משה' } });
  assert.equal(put2.status, 200, JSON.stringify(put2.json));
  const { pool } = require('../src/db');
  const { safeDecryptField } = require('../src/fieldcrypto');
  const { rows } = await pool.query(`SELECT f.* FROM tenant_financials f JOIN tenants te ON te.id=f.tenant_id WHERE te.slug='achuza'`);
  assert.ok(rows[0], 'שורת financials קיימת');
  assert.equal(safeDecryptField(rows[0].account_number_enc), '999888', 'account_number נשמר אחרי PUT חלקי');
  assert.equal(safeDecryptField(rows[0].beneficiary_enc), 'משה');
});

test('דוח שלמות: לא מתקן, מחזיר רשימות', async (t) => {
  app();
  const { pool } = require('../src/db');
  const { rows: tn } = await pool.query('SELECT id FROM tenants LIMIT 1');
  const { rows: us } = await pool.query('SELECT id FROM users LIMIT 1');
  const { rows: d } = await pool.query(
    `INSERT INTO documents(tenant_id, customer_id, kind, doc_year, doc_number, amount, vat, total, issued_at, signature)
     VALUES ($1,$2,'receipt',2026,900002,100,17,117,now(),'bad-signature') RETURNING id`, [tn[0].id, us[0].id]);
  const { migrateDocumentIntegrity } = require('../src/documents');
  const rep = await migrateDocumentIntegrity();
  assert.ok(Array.isArray(rep.badSig) && Array.isArray(rep.badHash) && Array.isArray(rep.noPdf));
  assert.ok(rep.badSig.some(b => b.id === d[0].id), 'המסמך התקול מדווח');
  // לא תוקן: החתימה הרעה נשארה
  const { rows: after } = await pool.query('SELECT signature FROM documents WHERE id=$1', [d[0].id]);
  assert.equal(after[0].signature, 'bad-signature');
});
