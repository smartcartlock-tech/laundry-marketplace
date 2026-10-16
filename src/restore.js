// E2: שחזור גיבוי JSON (מ-scripts/backup.js או GET /api/admin/export) לתוך סכימה ריקה.
// עצמאי מ-src/db.js (pool משלו) כדי שאפשר יהיה לשחזר לכל DATABASE_URL/PGSCHEMA.
// סדר הכנסה: מיון טופולוגי לפי מפתחות זרים (לא דורש הרשאות superuser, עובד גם ב-Neon).
const { Pool } = require('pg');
const { runMigrations } = require('./migrate');

// המרת ערך מ-JSON של הגיבוי לצורה שה-driver מכניס נכון לפי סוג העמודה
function coerceValue(dataType, value) {
  if (value === null || value === undefined) return null;
  if (dataType === 'bytea') {
    // node-pg מחזיר bytea כ-Buffer; JSON.stringify הופך אותו ל-{type:'Buffer',data:[...]}
    if (Buffer.isBuffer(value)) return value;
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
    if (typeof value === 'string') return Buffer.from(value, 'base64');
    return null;
  }
  if (dataType === 'jsonb' || dataType === 'json') return JSON.stringify(value);
  return value; // text[] ומערכים אחרים — node-pg ממיר מערך JS לליטרל מערך; תאריכים עוברים כמחרוזות
}

function quoteIdent(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }

// מיון טופולוגי (Kahn) של טבלאות לפי תלויות FK; טבלאות במעגל נשארות בסוף בסדר אלפביתי
function topoSort(tables, deps) {
  const set = new Set(tables);
  const indeg = new Map(), out = new Map();
  for (const t of tables) { indeg.set(t, 0); out.set(t, []); }
  for (const [t, refs] of Object.entries(deps)) {
    if (!set.has(t)) continue;
    for (const ref of refs) {
      if (!set.has(ref) || ref === t) continue;
      out.get(ref).push(t);
      indeg.set(t, indeg.get(t) + 1);
    }
  }
  const ready = tables.filter(t => indeg.get(t) === 0).sort();
  const order = [];
  while (ready.length) {
    const t = ready.shift();
    order.push(t);
    for (const u of out.get(t)) {
      indeg.set(u, indeg.get(u) - 1);
      if (indeg.get(u) === 0) { ready.push(u); ready.sort(); }
    }
  }
  const rest = tables.filter(t => !order.includes(t)).sort();
  return { order, cyclic: rest };
}

async function restoreAll(data, { databaseUrl, schema, force = false, log = console.log } = {}) {
  if (!data || !data.tables || typeof data.tables !== 'object') throw new Error('backup JSON חסר tables');
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
    max: 4,
    ...(schema ? { options: `-c search_path=${schema},public` } : {}),
  });
  const stats = { tables: {}, skipped: [], cyclic: [], truncated: false };

  // הגנה: לא משחזרים לתוך סכימה לא-ריקה בלי force (מניעת מחיקת פרוד בטעות).
  // הבדיקה רצה לפני בניית הסכימה, כי המיגרציות עצמן מזריעות שורות ברירת-מחדל (platform_settings).
  const wantedAll = Object.keys(data.tables);
  let nonEmpty = [];
  {
    const pre = await pool.connect();
    try {
      if (schema) await pre.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
      const { rows: tables } = await pre.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1)`, [wantedAll]);
      for (const r of tables) {
        const { rows } = await pre.query(`SELECT EXISTS(SELECT 1 FROM ${quoteIdent(r.tablename)} LIMIT 1) AS has`);
        if (rows[0].has) nonEmpty.push(r.tablename);
      }
    } finally { pre.release(); }
  }
  if (nonEmpty.length && !force) {
    await pool.end();
    throw new Error(`הסכימה אינה ריקה (${nonEmpty.length} טבלאות עם נתונים, למשל ${nonEmpty.slice(0, 3).join(', ')}). הרץ שוב עם force=true לאחר שווידאת שזו סכימת היעד הנכונה.`);
  }

  // בניית הסכימה מהמיגרציות המגורסות (baseline + כל הקבצים הממוספרים לפי סדר)
  await runMigrations(pool, schema);
  const client = await pool.connect();
  try {

    const { rows: existing } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`);
    const existingSet = new Set(existing.map(r => r.tablename));
    const wanted = wantedAll.filter(t => existingSet.has(t));
    stats.skipped = wantedAll.filter(t => !existingSet.has(t));

    // מטא-דאטה של עמודות ותלויות FK
    const { rows: cols } = await client.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema()`);
    const colMeta = new Map(); // table -> Map(col -> data_type)
    for (const c of cols) {
      if (!colMeta.has(c.table_name)) colMeta.set(c.table_name, new Map());
      colMeta.get(c.table_name).set(c.column_name, c.data_type);
    }
    const { rows: fks } = await client.query(
      `SELECT tc.table_name AS t, ccu.table_name AS ref
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()`);
    const deps = {};
    for (const f of fks) { (deps[f.t] = deps[f.t] || new Set()).add(f.ref); }
    const depsObj = Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, [...v]]));
    const { order, cyclic } = topoSort(wanted, depsObj);
    stats.cyclic = cyclic;

    // מעגלי FK (למשל tenders.winner_bid_id <-> tender_bids.tender_id): לא ניתן לסדר
    // הכנסה שמקיימת את שני הצדדים, ועמודת FK בתוך-מעגל יכולה להיות NOT NULL.
    // פתרון: הורדת האילוצים בתוך-המעגל לפני ההכנסה והחזרתם אחריה (DDL טרנזקציוני,
    // דורש בעלות על הטבלה בלבד — עובד ב-Neon בלי superuser). החזרה מאמתת את הנתונים.
    const cyclicSet = new Set(cyclic);
    let droppedConstraints = [];
    if (cyclic.length) {
      const { rows: fkCols } = await client.query(
        `SELECT tc.constraint_name, tc.table_name AS t, kcu.column_name AS col,
                ccu.table_name AS ref, ccu.column_name AS ref_col, rc.update_rule, rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema AND kcu.table_name = tc.table_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
         JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()
         ORDER BY tc.constraint_name, kcu.ordinal_position`);
      const byName = new Map();
      for (const f of fkCols) {
        if (!cyclicSet.has(f.t) || !cyclicSet.has(f.ref)) continue;
        if (!byName.has(f.constraint_name)) {
          byName.set(f.constraint_name, { name: f.constraint_name, t: f.t, ref: f.ref, cols: [], refCols: [], updateRule: f.update_rule, deleteRule: f.delete_rule });
        }
        byName.get(f.constraint_name).cols.push(f.col);
        byName.get(f.constraint_name).refCols.push(f.ref_col);
      }
      droppedConstraints = [...byName.values()];
    }
    await client.query('BEGIN');
    try {
      // תמיד מנקים את טבלאות היעד לפני ההכנסה: בסכימה טרייה זה מסיר שורות ברירת-מחדל
      // ש-schema.sql זרע (platform_settings), ובכפייה (force) זה מנקה נתונים קיימים.
      await client.query(`TRUNCATE ${wanted.map(quoteIdent).join(', ')} CASCADE`);
      stats.truncated = nonEmpty.length > 0;
      for (const c of droppedConstraints) {
        await client.query(`ALTER TABLE ${quoteIdent(c.t)} DROP CONSTRAINT ${quoteIdent(c.name)}`);
      }
      const insertRows = async (t, rows) => {
        const meta = colMeta.get(t);
        const jsonCols = Object.keys(rows[0]).filter(c => meta.has(c));
        const colList = jsonCols.map(quoteIdent).join(', ');
        const casts = jsonCols.map(c => (meta.get(c) === 'jsonb' || meta.get(c) === 'json') ? '::' + meta.get(c) : '');
        let inserted = 0;
        const CHUNK = 100;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const values = [];
          const tuples = chunk.map((row, ri) => '(' + jsonCols.map((c, ci) => {
            values.push(coerceValue(meta.get(c), row[c]));
            return `$${ri * jsonCols.length + ci + 1}${casts[ci]}`;
          }).join(', ') + ')');
          await client.query(`INSERT INTO ${quoteIdent(t)} (${colList}) VALUES ${tuples.join(', ')}`, values);
          inserted += chunk.length;
        }
        return inserted;
      };
      for (const t of [...order, ...cyclic]) {
        const rows = Array.isArray(data.tables[t]) ? data.tables[t] : [];
        stats.tables[t] = rows.length ? await insertRows(t, rows) : 0;
      }
      // החזרת אילוצי FK בתוך-המעגל — החזרה מצליחה רק אם כל ההפניות שלמות (בדיקת תקינות מובנית)
      for (const c of droppedConstraints) {
        const rules = (c.deleteRule && c.deleteRule !== 'NO ACTION' ? ` ON DELETE ${c.deleteRule}` : '') +
                      (c.updateRule && c.updateRule !== 'NO ACTION' ? ` ON UPDATE ${c.updateRule}` : '');
        await client.query(
          `ALTER TABLE ${quoteIdent(c.t)} ADD CONSTRAINT ${quoteIdent(c.name)} FOREIGN KEY (${c.cols.map(quoteIdent).join(', ')}) REFERENCES ${quoteIdent(c.ref)} (${c.refCols.map(quoteIdent).join(', ')})${rules}`);
      }
      // schema_migrations משקף את מצב הקבצים הנוכחי (גם אם הגיבוי ישן יותר)
      const fs2 = require('fs');
      const migDir = require('path').join(__dirname, 'migrations');
      for (const f of fs2.readdirSync(migDir).filter(f => /^\d+_.+\.sql$/.test(f)).sort()) {
        await client.query(`INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING`, [f.replace(/\.sql$/, '')]);
      }
      // איפוס רצפים (serial) כדי שהכנסות חדשות לא יתנגשו במזהים ששוחזרו
      for (const t of wanted) {
        const meta = colMeta.get(t);
        for (const [col] of meta) {
          const { rows: seq } = await client.query(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [t, col]);
          if (seq[0] && seq[0].seq) {
            await client.query(
              `SELECT setval($1, COALESCE((SELECT MAX(${quoteIdent(col)}) FROM ${quoteIdent(t)}), 1))`,
              [seq[0].seq]);
          }
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    log(`[restore] ${Object.values(stats.tables).reduce((a, b) => a + b, 0)} rows -> ${wanted.length} tables` +
      (stats.skipped.length ? ` (skipped unknown: ${stats.skipped.join(', ')})` : '') +
      (stats.cyclic.length ? ` (FK cycle fallback: ${stats.cyclic.join(', ')})` : ''));
    return stats;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { restoreAll, coerceValue, topoSort };
