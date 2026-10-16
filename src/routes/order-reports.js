// E7.T3: דיווח תקלה מלקוח על הזמנה — נכנס לתור ההתראות של אדמין הפלטפורמה
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();

r.post('/:id/report', requireAuth, async (req, res) => {
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'נדרש תיאור התקלה' });
  const { rows: o } = await q('SELECT id, tenant_id, customer_id, status FROM orders WHERE id=$1', [req.params.id]);
  if (!o[0]) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  if (o[0].customer_id !== req.user.id) return res.status(403).json({ error: 'ניתן לדווח רק על הזמנה שלך' });
  const { rows } = await q(
    `INSERT INTO sla_alerts(order_id, tenant_id, kind, details)
     VALUES ($1,$2,'customer_issue',$3)
     ON CONFLICT DO NOTHING RETURNING id, created_at`,
    [o[0].id, o[0].tenant_id, text]);
  if (!rows[0]) return res.status(409).json({ error: 'כבר קיים דיווח פתוח על ההזמנה — מטופל בהקדם' });
  res.status(201).json({ report: rows[0] });
});

module.exports = r;
