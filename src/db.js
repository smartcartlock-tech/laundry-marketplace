const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('DATABASE_URL is required'); process.exit(1); }

const SCHEMA = process.env.PGSCHEMA || null; // הפרדת סכימה כשחולקים אינסטנס עם שירות אחר

const pool = new Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  max: 8,
  ...(SCHEMA ? { options: `-c search_path=${SCHEMA},public` } : {}),
});

async function q(text, params) { return pool.query(text, params); }

async function migrate() {
  if (SCHEMA) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] schema migrated' + (SCHEMA ? ` (schema ${SCHEMA})` : ''));
}

module.exports = { pool, q, migrate };
