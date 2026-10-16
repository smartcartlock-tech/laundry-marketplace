// E9.T1: צפייה בתמונת תקלה — לקוח בעל הדיווח, חבר מכבסה, או אדמין
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();
r.get('/issue-photos/:pid', requireAuth, async (req, res) => {
  const { rows } = await q(
    `SELECT p.content_type, p.data, r.customer_id, r.tenant_id
     FROM issue_report_photos p JOIN issue_reports r ON r.id=p.report_id WHERE p.id=$1`, [req.params.pid]);
  const p = rows[0];
  if (!p) return res.status(404).json({ error: 'תמונה לא נמצאה' });
  if (req.user.role !== 'admin' && p.customer_id !== req.user.id) {
    const { rows: mem } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [p.tenant_id, req.user.id]);
    if (!mem[0]) return res.status(403).json({ error: 'אין הרשאה' });
  }
  res.type(p.content_type).send(p.data);
});
module.exports = r;
