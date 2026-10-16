#!/usr/bin/env node
// גיבוי ידני: node scripts/backup.js [קובץ-יעד]
// דורש DATABASE_URL (ואופציונלי PGSCHEMA) כמו השרת. כותב JSON מלא של כל הטבלאות.
const fs = require('fs');
const path = require('path');

(async () => {
  const { exportAll } = require('../src/backup');
  const { pool } = require('../src/db');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = process.argv[2] || path.join('backups', `backup-${stamp}.json`);
  const data = await exportAll();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`[backup] ${Object.keys(data.tables).length} tables -> ${out} (${kb} KB)`);
  await pool.end();
})().catch(e => { console.error('[backup] failed:', e.message); process.exit(1); });
