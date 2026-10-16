// גיבוי יומי מוצפן: dump מלא (backup.exportAll) → JSON → AES-256-GCM (מפתח BACKUP_KEY, נופל ל-FIELD_ENC_KEY).
// שחזור-בדיקה = פענוח + פירוק + ספירת טבלאות (verifyBackup); שחזור מסד בפועל הוא פעולת DBA ידנית מה-payload המפוענח.
const crypto = require('crypto');
const { q } = require('./db');
const { exportAll } = require('./backup');

function bkey() {
  const s = process.env.BACKUP_KEY || process.env.FIELD_ENC_KEY;
  if (s) { const k = Buffer.from(s, 'base64'); if (k.length === 32) return k; throw new Error('BACKUP_KEY must be 32 bytes base64'); }
  if (process.env.NODE_ENV === 'test') return crypto.createHash('sha256').update('test-backup-key').digest();
  throw new Error('BACKUP_KEY (or FIELD_ENC_KEY) is required');
}

function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', bkey(), iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from('WLB1'), iv, c.getAuthTag(), ct]);
}

function decryptBuffer(payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buf.subarray(0, 4).toString() !== 'WLB1') throw new Error('unknown backup format');
  const d = crypto.createDecipheriv('aes-256-gcm', bkey(), buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

async function createEncryptedBackup(kind = 'daily') {
  const data = await exportAll();
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const payload = encryptBuffer(json);
  const meta = { exported_at: data.exported_at, tables: Object.keys(data.tables).length, bytes: json.length };
  const { rows } = await q('INSERT INTO encrypted_backups(kind, payload, meta) VALUES ($1,$2,$3) RETURNING id, created_at',
    [kind, payload, JSON.stringify(meta)]);
  return { id: rows[0].id, created_at: rows[0].created_at, meta };
}

function verifyBackup(payload) {
  const data = JSON.parse(decryptBuffer(payload).toString('utf8'));
  return { exported_at: data.exported_at, tables: Object.keys(data.tables), counts: Object.fromEntries(Object.entries(data.tables).map(([t, r]) => [t, r.length])) };
}

// גיבוי יומי: בהפעלה + כל 6 שעות נבדק אם כבר יש גיבוי להיום (אותו דפוס כמו retention; Render free = תהליך יחיד)
function startDailyBackup() {
  const run = () => q(`SELECT 1 FROM encrypted_backups WHERE created_at::date = now()::date LIMIT 1`)
    .then(({ rows }) => rows[0] ? null : createEncryptedBackup('daily').then(b => console.log('[backup] daily encrypted backup created', b.id)))
    .catch(e => console.error('[backup]', e.message));
  setTimeout(run, 60 * 1000);
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}

module.exports = { createEncryptedBackup, verifyBackup, encryptBuffer, decryptBuffer, startDailyBackup };
