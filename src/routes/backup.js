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

module.exports = r;
