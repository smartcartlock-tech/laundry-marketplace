// E12.T6+T7: אימות מסמך ציבורי לפי טוקן סריקה (QR על כל מסמך) — בלי התחברות, בלי פרטי לקוח.
// מחזיר: אמיתי / שונה / מבוטל(זוכה) / זוכה חלקית, מפיק, מספר, תאריך, סכום, מצב רישום. כל סריקה נרשמת בביקורת.
const express = require('express');
const { q } = require('../db');
const { KIND_HE, verifySignature } = require('../documents');

const r = express.Router();
const RESULT_HE = { authentic: 'אמיתי', altered: 'שונה — החתימה לא תואמת', credited: 'מבוטל — זוכה במלואו', partial: 'זוכה חלקית' };

r.get('/:code', async (req, res) => {
  const code = String(req.params.code || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!/^[0-9A-Z]{6,32}$/.test(code)) return res.status(400).json({ error: 'קוד לא תקין' });
  const { rows } = await q(
    `SELECT d.*, t.name AS tenant_name,
            (SELECT count(*)::int FROM document_orders dor WHERE dor.document_id=d.id) AS orders_count
     FROM documents d JOIN tenants t ON t.id=d.tenant_id
     WHERE d.verify_code=$1`, [code]);
  if (!rows.length) return res.status(404).json({ found: false });
  const d = rows[0];
  const sigOk = verifySignature(d);
  const result = !sigOk ? 'altered' : d.status === 'credited' ? 'credited' : d.status === 'partially_credited' ? 'partial' : 'authentic';
  // אירוע ביקורת על כל סריקה — לא חוסם את התשובה
  q(`INSERT INTO document_events(document_id, action, details) VALUES ($1,'verified',$2)`,
    [d.id, JSON.stringify({ result })]).catch(e => console.error('[verify audit]', e.message));
  res.json({
    found: true, demo: true, registration: 'demo',
    result, result_he: RESULT_HE[result],
    kind: d.kind, kind_he: d.title_he || KIND_HE[d.kind] || d.kind,
    doc_number: d.doc_number, doc_year: d.doc_year,
    total: Number(d.total), issued_at: d.issued_at,
    tenant_name: d.tenant_name, orders_count: d.orders_count || 0,
    signature_valid: sigOk, sha256: d.sha256 || null,
  });
});

module.exports = r;
