#!/usr/bin/env node
// שחזור גיבוי: node scripts/restore.js <backup.json> [--force]
// דורש DATABASE_URL (ואופציונלי PGSCHEMA) כמו השרת.
// בלי --force הסקריפט נעצר אם סכימת היעד אינה ריקה — הגנה ממחיקת פרוד בטעות.
const path = require('path');
const fs = require('fs');

(async () => {
  const file = process.argv[2];
  const force = process.argv.includes('--force');
  if (!file) { console.error('usage: node scripts/restore.js <backup.json> [--force]'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const { restoreAll } = require('../src/restore');
  const stats = await restoreAll(data, {
    databaseUrl: process.env.DATABASE_URL,
    schema: process.env.PGSCHEMA || null,
    force,
  });
  const total = Object.values(stats.tables).reduce((a, b) => a + b, 0);
  console.log(`[restore] done: ${total} rows across ${Object.keys(stats.tables).length} tables` +
    (stats.truncated ? ' (target truncated first)' : ''));
})().catch(e => { console.error('[restore] failed:', e.message); process.exit(1); });
