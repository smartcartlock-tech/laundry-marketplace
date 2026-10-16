// A2: מיגרציות מגורסות — DB חדש ו-DB מדור-קדם מגיעים לאותה סכימה; הרצה חוזרת היא no-op
const { test } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { TEST_DB } = require('./helpers');

async function freshSchema(name) {
  const admin = new Pool({ connectionString: TEST_DB, max: 1 });
  await admin.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
  await admin.query(`CREATE SCHEMA ${name}`);
  await admin.end();
  return new Pool({ connectionString: TEST_DB, max: 4, options: `-c search_path=${name},public` });
}

const { runMigrations } = require('../src/migrate');

// הרשימה הצפויה נגזרת מהקבצים על הדיסק — מפתחים מוסיפים מיגרציות ממוספרות בקבצים חדשים בלבד
const fs = require('fs'), path = require('path');
const EXPECTED = fs.readdirSync(path.join(__dirname, '..', 'src', 'migrations'))
  .filter(f => /^\d+_.+\.sql$/.test(f)).sort().map(f => f.replace(/\.sql$/, ''));

test('A2: DB חדש — כל המיגרציות מיושמות ונרשמות; הרצה חוזרת no-op', async () => {
  const pool = await freshSchema('test_mig_fresh');
  await runMigrations(pool, 'test_mig_fresh');
  const { rows: applied } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(applied.map(r => r.version), EXPECTED);
  const { rows: t } = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='test_mig_fresh'`);
  assert.ok(t[0].n > 40, 'כל הטבלאות נוצרו: ' + t[0].n);
  // הרצה שנייה — בלי שגיאה ובלי שינוי
  await runMigrations(pool, 'test_mig_fresh');
  const { rows: again } = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
  assert.equal(again[0].n, EXPECTED.length);
  await pool.end();
});

test('A2: DB מדור-קדם (schema.sql ישירות, בלי טבלת מיגרציות) — baseline מסומן כמיושם ולא מורץ שוב', async () => {
  const pool = await freshSchema('test_mig_legacy');
  // סימולציית DB ישן: מיישמים את תוכן הבסיס ביד, בלי schema_migrations
  const fs = require('fs');
  const baseline = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'migrations', '001_baseline.sql'), 'utf8');
  await pool.query(baseline);
  await pool.query(`INSERT INTO tenants(slug, name, approved, is_open) VALUES ('mig-legacy', 'מכבסת מיגרציה', true, true)`);
  await runMigrations(pool, 'test_mig_legacy');
  const { rows: applied } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(applied.map(r => r.version), EXPECTED);
  // הנתון הקיים נשמר
  const { rows: ten } = await pool.query(`SELECT slug FROM tenants WHERE slug='mig-legacy'`);
  assert.equal(ten.length, 1);
  await pool.end();
});
