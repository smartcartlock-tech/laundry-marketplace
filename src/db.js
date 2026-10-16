const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('DATABASE_URL is required'); process.exit(1); }

const SCHEMA = process.env.PGSCHEMA || null; // הפרדת סכימה כשחולקים אינסטנס עם שירות אחר

const pool = new Pool({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: true }, // אימות תעודה מלא — הגנה מ-MITM מול Neon
  max: 8,
  ...(SCHEMA ? { options: `-c search_path=${SCHEMA},public` } : {}),
});

async function q(text, params) { return pool.query(text, params); }

async function migrate() {
  const { runMigrations } = require('./migrate');
  await runMigrations(pool, SCHEMA);
}

module.exports = { pool, q, migrate };
