// שחזור גיבוי מוצפן לבסיס/סכימה נפרדת — אימות שחזור אמיתי (לא רק פענוח).
// תהליך: פענוח payload → סכימת יעד טרייה עם כל ה-migrations → הכנסת כל השורות (FK מושבת זמנית) → השוואת ספירות.
const { Client } = require('pg');
const { decryptBuffer } = require('./backup-crypto');

async function restoreToSchema(payload, { connectionString, schema }) {
  const data = JSON.parse(decryptBuffer(payload).toString('utf8'));
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await db.query(`SET search_path TO "${schema}", public`);
    // DDL מלא מכל המיגרציות
    // טבלאות שנוצרות עצלתית בקוד (לא במיגרציות) — כרגע רק error_log (src/errlog.js)
    await db.query(`CREATE TABLE IF NOT EXISTS error_log (
      id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      method TEXT, path TEXT, status INT, message TEXT, stack TEXT, user_id TEXT, ip TEXT)`);
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, 'migrations');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      await db.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    // מפת טיפוסי עמודות (לסידור מערכים/JSON לפי הטיפוס האמיתי)
    const { rows: colRows } = await db.query(
      `SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema=$1`, [schema]);
    const colType = {};
    for (const r of colRows) colType[r.table_name + '.' + r.column_name] = r.udt_name;
    const toPg = (t, c, v) => {
      const ty = colType[t + '.' + c];
      if (v === null || v === undefined) return null;
      if (ty && ty.startsWith('_') && Array.isArray(v)) {
        return '{' + v.map(x => x === null ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';
      }
      if ((ty === 'json' || ty === 'jsonb') && typeof v === 'object') return JSON.stringify(v);
      if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))) return JSON.stringify(v);
      return v;
    };
    // הכנסת שורות: FK מושבת, טבלאות ריקות, טעינה בבאצ'ים
    await db.query(`SET session_replication_role = 'replica'`);
    const tables = Object.keys(data.tables);
    for (const t of tables) {
      const rows = data.tables[t];
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const colList = cols.map(c => `"${c}"`).join(',');
      const BATCH = 100;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const ph = chunk.map((_, r) => '(' + cols.map((_, c) => `$${r * cols.length + c + 1}`).join(',') + ')').join(',');
        const vals = chunk.flatMap(row => cols.map(c => toPg(t, c, row[c])));
        await db.query(`INSERT INTO "${t}" (${colList}) VALUES ${ph} ON CONFLICT DO NOTHING`, vals);
      }
    }
    await db.query(`SET session_replication_role = 'origin'`);
    // השוואת ספירות
    const counts = {};
    for (const t of tables) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM "${t}"`);
      counts[t] = { expected: data.tables[t].length, actual: rows[0].n };
    }
    const mismatches = Object.entries(counts).filter(([, c]) => c.expected !== c.actual);
    return { ok: mismatches.length === 0, mismatches, tables: tables.length, exported_at: data.exported_at };
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await db.end();
  }
}

module.exports = { restoreToSchema };
