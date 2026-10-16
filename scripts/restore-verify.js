#!/usr/bin/env node
// אימות שחזור אמיתי של גיבוי מוצפן מהייצור אל Postgres נפרד (למשל מקומי) — בלי לגעת בייצור.
// שימוש: DATABASE_URL=<prod> BACKUP_KEY=... TARGET_DATABASE_URL=postgres://... node scripts/restore-verify.js [backup-id]
//        או: node scripts/restore-verify.js --file backup.wlb1 --target postgres://...
const { Client } = require('pg');
const { restoreToSchema } = require('../src/restore');

(async () => {
  const args = process.argv.slice(2);
  let payload;
  if (args[0] === '--file') {
    payload = require('fs').readFileSync(args[1]);
  } else {
    const id = args[0];
    const src = new Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: true } });
    await src.connect();
    const { rows } = id
      ? await src.query('SELECT payload FROM encrypted_backups WHERE id=$1', [id])
      : await src.query(`SELECT payload FROM encrypted_backups ORDER BY created_at DESC LIMIT 1`);
    if (!rows[0]) throw new Error('לא נמצא גיבוי');
    payload = rows[0].payload;
    await src.end();
  }
  const schema = 'restore_check_' + Date.now().toString(36);
  const res = await restoreToSchema(payload, { connectionString: process.env.TARGET_DATABASE_URL, schema });
  console.log(JSON.stringify(res, null, 1));
  if (!res.ok) process.exit(1);
})().catch(e => { console.error('שחזור נכשל:', e.message); process.exit(1); });
