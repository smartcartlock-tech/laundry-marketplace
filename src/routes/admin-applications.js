// B2 (מוצר): תור בקשות הצטרפות לאדמין — צפייה, המרה ל-tenant (דרך יצירה ידנית, approved=false), דחייה.
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { uuidParams } = require('../validate');

const r = express.Router();
r.use(requireAuth, requireAdmin);

r.get('/applications', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE a.status=$1'; }
  const { rows } = await q(
    `SELECT a.*, t.slug AS tenant_slug FROM tenant_applications a
     LEFT JOIN tenants t ON t.id = a.tenant_id ${where} ORDER BY a.created_at DESC LIMIT 200`, params);
  res.json({ applications: rows });
});

async function setHandled(id, status, adminId, tenantId) {
  const { rows } = await q(
    `UPDATE tenant_applications SET status=$2, handled_by=$3, handled_at=now(), tenant_id=COALESCE($4, tenant_id)
     WHERE id=$1 RETURNING *`, [id, status, adminId, tenantId || null]);
  return rows[0];
}

r.post('/applications/:id/convert', uuidParams('id'), async (req, res) => {
  try {
    const { rows: a } = await q('SELECT * FROM tenant_applications WHERE id=$1', [req.params.id]);
    const app = a[0];
    if (!app) return res.status(404).json({ error: 'בקשה לא נמצאה' });
    if (app.status === 'converted' && app.tenant_id) return res.json({ ok: true, tenant_id: app.tenant_id, already: true });
    if (app.status === 'rejected') return res.status(409).json({ error: 'הבקשה נדחתה' });
    let slug = app.laundry_name.replace(/[^\wא-ת]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'laundry';
    const { rows: existing } = await q('SELECT 1 FROM tenants WHERE slug=$1', [slug]);
    if (existing[0]) slug = slug + '-' + Math.random().toString(36).slice(2, 6);
    const { rows: t } = await q(
      `INSERT INTO tenants(slug, name, letter, city, phone, approved) VALUES ($1,$2,$3,$4,$5,false) RETURNING id, slug`,
      [slug, app.laundry_name, app.laundry_name[0] || 'מ', app.city, app.phone]);
    await setHandled(app.id, 'converted', req.user.id, t[0].id);
    res.json({ ok: true, tenant_id: t[0].id, slug: t[0].slug });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.post('/applications/:id/reject', uuidParams('id'), async (req, res) => {
  const row = await setHandled(req.params.id, 'rejected', req.user.id, null);
  if (!row) return res.status(404).json({ error: 'בקשה לא נמצאה' });
  res.json({ ok: true });
});

module.exports = r;
