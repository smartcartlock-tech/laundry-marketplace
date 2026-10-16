// צפייה בצילום אישור מסירה: השליח שצילם, חבר המכבסה של ההזמנה, או אדמין.
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();
r.use(requireAuth);

r.get('/:id/photo', async (req, res) => {
  const { rows } = await q(
    `SELECT dc.photo_mime, dc.photo_data, dc.courier_id, o.tenant_id, c.user_id AS courier_user_id
     FROM delivery_confirmations dc JOIN orders o ON o.id=dc.order_id JOIN couriers c ON c.id=dc.courier_id
     WHERE dc.id=$1`, [req.params.id]);
  const row = rows[0];
  if (!row || !row.photo_data) return res.status(404).json({ error: 'צילום לא נמצא' });
  if (req.user.role !== 'admin' && row.courier_user_id !== req.user.id) {
    const { rows: mem } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [row.tenant_id, req.user.id]);
    if (!mem[0]) return res.status(403).json({ error: 'אין הרשאה לצילום זה' });
  }
  res.setHeader('content-type', row.photo_mime || 'image/jpeg');
  res.setHeader('cache-control', 'private, max-age=3600');
  res.send(row.photo_data);
});

module.exports = r;
