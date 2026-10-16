// E9.T1 (+E7.T3): דיווח תקלה מלקוח על הזמנה — סוג, תיאור, עד 3 תמונות; נפתח מול המכבסה ומסונכרן לתור SLA של האדמין
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();
const KINDS = ['damage','missing','late','other'];
const MAX_PHOTOS = 3, MAX_B64 = 1_400_000; // ~1MB binary per photo

r.post('/:id/report', requireAuth, async (req, res) => {
  const { kind, text, photos } = req.body || {};
  const body = String(text || '').trim();
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'סוג תקלה: ' + KINDS.join(' | ') });
  if (!body) return res.status(400).json({ error: 'נדרש תיאור התקלה' });
  const { rows: o } = await q('SELECT id, tenant_id, customer_id, status FROM orders WHERE id=$1', [req.params.id]);
  if (!o[0]) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  if (o[0].customer_id !== req.user.id) return res.status(403).json({ error: 'ניתן לדווח רק על הזמנה שלך' });

  const pics = Array.isArray(photos) ? photos.slice(0, MAX_PHOTOS) : [];
  for (const p of pics) {
    if (!p || typeof p.data_b64 !== 'string' || !p.data_b64.length || p.data_b64.length > MAX_B64)
      return res.status(400).json({ error: 'תמונה לא תקינה או גדולה מדי (עד 1MB)' });
    if (!/^image\/(jpeg|png|webp)$/.test(p.content_type || ''))
      return res.status(400).json({ error: 'סוג קובץ לא נתמך (jpeg/png/webp)' });
  }

  let rows;
  try {
    ({ rows } = await q(
      `INSERT INTO issue_reports(order_id, tenant_id, customer_id, kind, text) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [o[0].id, o[0].tenant_id, req.user.id, kind, body]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'כבר דיווחת על ההזמנה הזו' });
    throw e;
  }
  const rid = rows[0].id;
  for (const p of pics) {
    await q('INSERT INTO issue_report_photos(report_id, content_type, data) VALUES ($1,$2,$3)',
      [rid, p.content_type, Buffer.from(p.data_b64, 'base64')]);
  }
  // E7.T3: שיקוף לתור ההתראות המרכזי (אחד לכל הזמנה — אידמפוטנטי)
  const KIND_HE = { damage: 'נזק', missing: 'חסר', late: 'איחור', other: 'אחר' };
  await q(
    `INSERT INTO sla_alerts(order_id, tenant_id, kind, details)
     VALUES ($1,$2,'customer_issue',$3) ON CONFLICT DO NOTHING`,
    [o[0].id, o[0].tenant_id, `[${KIND_HE[kind]}] ${body}`]);
  res.status(201).json({ report: { id: rid, created_at: rows[0].created_at, photos: pics.length } });
});

// הלקוח רואה את הדיווחים שלו על ההזמנה + סטטוס טיפול
r.get('/:id/reports', requireAuth, async (req, res) => {
  const { rows } = await q(
    `SELECT r.id, r.kind, r.text, r.status, r.mediation, r.resolution_note, r.created_at, r.updated_at,
            (SELECT count(*) FROM issue_report_photos p WHERE p.report_id=r.id)::int AS photos,
            (SELECT array_agg(p.id ORDER BY p.created_at) FROM issue_report_photos p WHERE p.report_id=r.id) AS photo_ids
     FROM issue_reports r WHERE r.order_id=$1 AND r.customer_id=$2 ORDER BY r.created_at DESC`,
    [req.params.id, req.user.id]);
  res.json({ reports: rows });
});

module.exports = r;
