// C4: דף איסוף/משלוח ותווית שקית (PDF) — למכבסה בלבד
const express = require('express');
const bwipjs = require('bwip-js');
const { q } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');
const { buildLabelPDF } = require('../receipt');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://laundry-marketplace-ay5h.onrender.com';

r.get('/orders/:id/label.pdf', async (req, res) => {
  const { rows: o } = await q('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
  const order = o[0];
  if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  const [items, cust] = await Promise.all([
    q('SELECT name, qty FROM order_items WHERE order_id=$1 ORDER BY name', [order.id]),
    q('SELECT name, phone FROM users WHERE id=$1', [order.customer_id]),
  ]);
  const statusUrl = `${APP_BASE_URL}/#/orders/${order.id}`;
  const qr = await bwipjs.toBuffer({ bcid: 'qrcode', text: statusUrl, scale: 4, eclevel: 'M' });
  const doc = buildLabelPDF({ order, items: items.rows, tenant: req.tenant, customer: cust[0] || {}, qr });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="label-${order.id.slice(0, 8)}.pdf"`);
  doc.pipe(res);
});

module.exports = r;
