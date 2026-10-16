// E12.T6: אימות מסמך ציבורי לפי קוד סריקה (QR/ברקוד על כל מסמך) — ללא התחברות, בלי חשיפת טלפון
const express = require('express');
const { q } = require('../db');
const { KIND_HE } = require('../documents');

const r = express.Router();
const STATUS_HE = { issued: 'הופק', partially_credited: 'זוכה חלקית', credited: 'זוכה במלואו' };

r.get('/:code', async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!/^[0-9A-Z]{6,12}$/.test(code)) return res.status(400).json({ error: 'קוד לא תקין' });
  const { rows } = await q(
    `SELECT d.kind, d.doc_number, d.doc_year, d.total, d.status, d.issued_at,
            t.name AS tenant_name, u.name AS customer_name,
            (SELECT count(*)::int FROM document_orders dor WHERE dor.document_id=d.id) AS orders_count
     FROM documents d JOIN tenants t ON t.id=d.tenant_id LEFT JOIN users u ON u.id=d.customer_id
     WHERE d.verify_code=$1`, [code]);
  if (!rows.length) return res.status(404).json({ found: false });
  const d = rows[0];
  res.json({
    found: true, demo: true,
    kind: d.kind, kind_he: KIND_HE[d.kind] || d.kind,
    doc_number: d.doc_number, doc_year: d.doc_year,
    total: Number(d.total), status: d.status, status_he: STATUS_HE[d.status] || d.status,
    issued_at: d.issued_at, tenant_name: d.tenant_name, customer_name: d.customer_name,
    orders_count: d.orders_count || 0,
  });
});

module.exports = r;
