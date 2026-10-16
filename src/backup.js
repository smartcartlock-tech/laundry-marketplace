// גיבוי/ייצוא נתונים: dump של כל טבלאות הסכימה הנוכחית ל-JSON אחד.
// משמש גם את scripts/backup.js (CLI) וגם את GET /api/admin/export.
const { q } = require('./db');

// טבלאות מערכת שאינן חלק מהייצוא: encrypted_backups (מכילה גיבויים קודמים — גידול ריבועי)
// ו-schema_migrations (מצב פנימי של רץ המיגרציות, משוחזר מהקבצים).
const EXCLUDED = ['encrypted_backups', 'schema_migrations'];

async function listTables() {
  const { rows } = await q(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> ALL($1) ORDER BY tablename`,
    [EXCLUDED]);
  return rows.map(r => r.tablename);
}

async function exportAll() {
  const tables = await listTables();
  const out = { exported_at: new Date().toISOString(), tables: {} };
  for (const t of tables) {
    const { rows } = await q(`SELECT * FROM "${t}"`);
    out.tables[t] = rows;
  }
  return out;
}

module.exports = { listTables, exportAll };
