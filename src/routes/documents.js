// E12.T2/T4/T5: API מסמכים — לקוח (שלו) ומכבסה (שלה), PDF מקור/העתק, הנפקת זיכוי.
const express = require('express');
const { q, pool } = require('../db');
const { requireAuth } = require('../auth');
const { creditDocument, KIND_HE } = require('../documents');
const { buildDocumentPDF, docVerificationImages } = require('../receipt');
const { uuidParams } = require('../validate');

const r = express.Router();
r.use(requireAuth);
r.use(require('../ratelimit').writeLimiter('documents-write', 60));

const KIND_TITLE = KIND_HE;

async function loadDocContext(docId) {
  const { rows } = await q(
    `SELECT d.*, t.name AS tenant_name, t.slug, t.color, t.address AS tenant_address, t.city AS tenant_city,
            t.dealer_type, t.dealer_id, u.name AS customer_name, u.phone AS customer_phone
     FROM documents d JOIN tenants t ON t.id=d.tenant_id LEFT JOIN users u ON u.id=d.customer_id WHERE d.id=$1`, [docId]);
  return rows[0];
}

function docToResponse(d) {
  return {
    id: d.id, kind: d.kind, kind_he: d.title_he || KIND_TITLE[d.kind] || d.kind,
    doc_number: d.doc_number, doc_year: d.doc_year, allocation_number: d.allocation_number,
    amount: Number(d.amount), vat: Number(d.vat), total: Number(d.total),
    status: d.status, credited_amount: Number(d.credited_amount),
    order_id: d.order_id, covered_order_ids: d.covered_order_ids || [], verify_code: d.verify_code, issued_at: d.issued_at,
    tenant_name: d.tenant_name, slug: d.slug, customer_name: d.customer_name,
  };
}

async function sendPdf(res, d, copy) {
  const { rows: items } = d.order_id
    ? await q('SELECT * FROM order_items WHERE order_id=$1', [d.order_id])
    : { rows: [] };
  const { rows: covered } = await q(
    'SELECT o.id, o.total, o.created_at FROM document_orders dor JOIN orders o ON o.id=dor.order_id WHERE dor.document_id=$1 ORDER BY o.created_at', [d.id]);
  const pdfItems = covered.length
    ? covered.map(o => ({ name: `הזמנה #${o.id.slice(0, 8)} · ${new Date(o.created_at).toLocaleDateString('he-IL')}`, qty: 1, price: Number(o.total) }))
    : items;
  const tenant = { name: d.tenant_name, address: d.tenant_address, city: d.tenant_city, color: d.color, dealer_type: d.dealer_type, dealer_id: d.dealer_id };
  const customer = { name: d.customer_name, phone: d.customer_phone };
  let order = null;
  if (d.order_id) {
    const { rows: orow } = await q('SELECT id, delivery_fee, discount FROM orders WHERE id=$1', [d.order_id]);
    order = orow[0] || { id: d.order_id };
  }
  // זיכוי: הפניה למסמך המקור ברינדור חוזר (השורה המובנית בבילדר מדפיסה אותה — בלי note כפול)
  if (d.kind === 'credit' && d.original_id) {
    const { rows: orig } = await q('SELECT doc_number, doc_year, total FROM documents WHERE id=$1', [d.original_id]);
    if (orig[0]) { d.original_number = orig[0].doc_number; d.original_year = orig[0].doc_year;
      d.credit_full = Math.abs(Number(d.total)) >= Number(orig[0].total) - 0.001; }
  }
  // מקור: הבייטים המקוריים, בלתי משתנים. מסמך מדור קדם-רצועת-אימות (sha256 חסר)
  // עובר לרינדור חוזר מאותו צילום עם QR/ברקוד — מסומן "העתק" כנדרש באיפיון.
  if (!copy && d.pdf && d.sha256) {
    res.set('content-type', 'application/pdf');
    res.set('content-disposition', `inline; filename="${d.kind}-${d.doc_year}-${d.doc_number}.pdf"`);
    return res.end(d.pdf);
  }
  const codes = await docVerificationImages(d);
  const effectiveCopy = copy || !d.sha256;
  const pdf = buildDocumentPDF({ doc: d, order, items: pdfItems, tenant, customer, copy: effectiveCopy, codes,
    note: covered.length ? (covered.length === 1 ? 'חשבונית מרכזת המכסה הזמנה אחת' : `חשבונית מרכזת המכסה ${covered.length} הזמנות`) : null });
  res.set('content-type', 'application/pdf');
  res.set('content-disposition', `inline; filename="${d.kind}-${d.doc_year}-${d.doc_number}-copy.pdf"`);
  pdf.pipe(res);
}

// המסמכים שלי (לקוח)
r.get('/mine', async (req, res) => {
  const { rows } = await q(
    `SELECT d.*, t.name AS tenant_name, t.slug,
            (SELECT array_agg(dor.order_id) FROM document_orders dor WHERE dor.document_id=d.id) AS covered_order_ids
     FROM documents d JOIN tenants t ON t.id=d.tenant_id
     WHERE d.customer_id=$1 ORDER BY d.issued_at DESC LIMIT 200`, [req.user.id]);
  res.json({ documents: rows.map(docToResponse) });
});

// PDF של מסמך — לקוח הבעלים בלבד
r.get('/:id/pdf', uuidParams('id'), async (req, res) => {
  const d = await loadDocContext(req.params.id);
  if (!d) return res.status(404).json({ error: 'מסמך לא נמצא' });
  if (d.customer_id !== req.user.id && req.user.role !== 'admin') {
    // בעל מכבסה יוריד דרך /api/t/:slug/documents/:id/pdf
    const { rows: mem } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [d.tenant_id, req.user.id]);
    if (!mem.length) return res.status(403).json({ error: 'אין הרשאה' });
  }
  await sendPdf(res, d, req.query.copy === '1');
});

module.exports = r;
