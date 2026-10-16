// ייצוא מלא של הנתונים לאדמין: GET /api/admin/export (קובץ JSON להורדה)
const express = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const { exportAll } = require('../backup');

const r = express.Router();
r.use(requireAuth, requireAdmin);

r.get('/export', async (req, res) => {
  const data = await exportAll();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('content-disposition', `attachment; filename="laundry-backup-${stamp}.json"`);
  res.json(data);
});

const { q } = require('../db');
// גיבוי מוצפן: יצירה ידנית, רשימה, הורדה, ובדיקת שחזור (פענוח+תקינות)
const { createEncryptedBackup, verifyBackup } = require('../backup-crypto');

r.post('/backup/encrypted', async (req, res) => {
  const b = await createEncryptedBackup('manual');
  await require('../audit').audit(req, 'POST /api/admin/backup/encrypted', 'encrypted_backups', b.id, b.meta);
  res.status(201).json(b);
});

r.get('/backups', async (req, res) => {
  const { rows } = await q('SELECT id, kind, meta, created_at, octet_length(payload) AS size FROM encrypted_backups ORDER BY created_at DESC LIMIT 30');
  res.json({ backups: rows });
});

r.get('/backups/:id/download', async (req, res) => {
  const { rows } = await q('SELECT payload, created_at FROM encrypted_backups WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'גיבוי לא נמצא' });
  const stamp = rows[0].created_at.toISOString().slice(0, 10);
  res.setHeader('content-disposition', `attachment; filename="laundry-backup-${stamp}.wlb1"`);
  res.setHeader('content-type', 'application/octet-stream');
  res.send(rows[0].payload);
});

r.post('/backups/:id/verify', async (req, res) => {
  const { rows } = await q('SELECT payload FROM encrypted_backups WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'גיבוי לא נמצא' });
  try { res.json({ ok: true, ...verifyBackup(rows[0].payload) }); }
  catch (e) { res.status(422).json({ ok: false, error: 'הגיבוי פגום או שהמפתח אינו תואם' }); }
});

module.exports = r;
