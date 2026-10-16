// A2: ראנר מיגרציות מגורסות. כל קובץ ב-src/migrations מורץ פעם אחת לפי סדר שם
// ונרשם ב-schema_migrations. DB קיים (יש טבלאות אבל אין טבלת מיגרציות) מסומן
// כמיושם-baseline בלי להריץ שוב. מיגרציה חדשה = קובץ חדש עם מספר רץ בלבד.
const fs = require('fs');
const path = require('path');

async function runMigrations(pool, schema) {
  if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const { rows: hasTable } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name='schema_migrations'
       AND table_schema = current_schema()`);
  if (!hasTable.length) {
    // DB קיים מדור-קדם: אם tenants כבר קיימת — הבסיס הופעל בעבר, רק רושמים
    const { rows: legacy } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name='tenants' AND table_schema = current_schema()`);
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    if (legacy.length) {
      await pool.query(`INSERT INTO schema_migrations(version) VALUES ('001_baseline') ON CONFLICT DO NOTHING`);
      console.log('[db] legacy database detected — baseline marked as applied');
    }
  }
  const { rows: applied } = await pool.query('SELECT version FROM schema_migrations');
  const done = new Set(applied.map(r => r.version));
  for (const f of files) {
    const version = f.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      await pool.query('COMMIT');
      console.log(`[db] migration applied: ${version}`);
    } catch (e) {
      await pool.query('ROLLBACK').catch(() => {});
      throw new Error(`migration ${version} failed: ${e.message}`);
    }
  }
  console.log('[db] schema migrated' + (schema ? ` (schema ${schema})` : ''));
}

module.exports = { runMigrations };

// הרצה ידנית: node src/migrate.js
if (require.main === module) {
  const { pool } = require('./db');
  runMigrations(pool, process.env.PGSCHEMA || null).then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
}
