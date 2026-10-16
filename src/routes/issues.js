// E9.T1: צד מכבסה — רשימת תקלות, טיפול, הסלמה לגישור אדמין
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);

r.get('/issues', async (req, res) => {
  const { rows } = await q(
    `SELECT r.id, r.order_id, r.kind, r.text, r.status, r.mediation, r.resolution_note, r.created_at, r.updated_at,
            u.name AS customer_name, u.phone AS customer_phone, o.address AS order_address,
            (SELECT count(*) FROM issue_report_photos p WHERE p.report_id=r.id)::int AS photos,
            (SELECT json_agg(p.id) FROM issue_report_photos p WHERE p.report_id=r.id) AS photo_ids
     FROM issue_reports r JOIN users u ON u.id=r.customer_id JOIN orders o ON o.id=r.order_id
     WHERE r.tenant_id=$1 ORDER BY r.status='resolved', r.created_at DESC LIMIT 100`,
    [req.tenant.id]);
  res.json({ issues: rows });
});

r.post('/issues/:id/handle', async (req, res) => {
  const { status, note, mediation } = req.body || {};
  if (!['open','in_progress','resolved'].includes(status)) return res.status(400).json({ error: 'סטטוס: open | in_progress | resolved' });
  const { rows } = await q(
    `UPDATE issue_reports SET status=$2, resolution_note=COALESCE($3, resolution_note),
       mediation=COALESCE($4, mediation), handled_by=$5, updated_at=now()
     WHERE id=$1 AND tenant_id=$6 RETURNING *`,
    [req.params.id, status, note || null, typeof mediation === 'boolean' ? mediation : null, req.user.id, req.tenant.id]);
  if (!rows[0]) return res.status(404).json({ error: 'דיווח לא נמצא' });
  res.json({ issue: rows[0] });
});

module.exports = r;
