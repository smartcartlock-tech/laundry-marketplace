// נתונים פיננסיים של מכבסה (בנק/ספקים): בעלים בלבד, הצפנה ברמת שדה, קריאה מוסתרת
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { requireTenantOwner } = require('../authz');
const { encryptField, maskField } = require('../fieldcrypto');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantOwner);

const FIELDS = ['bank_code', 'branch', 'account_number', 'iban', 'beneficiary', 'supplier_notes'];

r.get('/financials', async (req, res) => {
  const { rows: t } = await q('SELECT id FROM tenants WHERE slug=$1', [req.params.slug]);
  const { rows } = await q('SELECT * FROM tenant_financials WHERE tenant_id=$1', [t[0].id]);
  const row = rows[0] || {};
  const masked = {};
  for (const f of FIELDS) masked[f] = maskField(row[f + '_enc']) || null;
  res.json({ financials: masked, has_data: !!rows[0], updated_at: row.updated_at || null });
});

// עדכון חלקי: שדה שלא נשלח בגוף הבקשה נשאר כפי שהוא (לא נמחק)
r.put('/financials', async (req, res) => {
  const b = req.body || {};
  const { rows: t } = await q('SELECT id FROM tenants WHERE slug=$1', [req.params.slug]);
  const sent = FIELDS.filter(f => f in b);
  const vals = [t[0].id, ...sent.map(f => encryptField(typeof b[f] === 'string' ? b[f].slice(0, 200) : null)), req.user.id];
  const encCols = sent.map(f => f + '_enc');
  if (sent.length) {
    const colList = encCols.map((c, i) => `${c}=$${i + 2}`).join(', ');
    await q(`INSERT INTO tenant_financials(tenant_id, ${encCols.join(', ')}, updated_at, updated_by)
             VALUES ($1, ${sent.map((_, i) => '$' + (i + 2)).join(', ')}, now(), $${sent.length + 2})
             ON CONFLICT (tenant_id) DO UPDATE SET ${colList}, updated_at=now(), updated_by=$${sent.length + 2}`, vals);
  }
  await require('../audit').audit(req, 'PUT /api/t/' + req.params.slug + '/financials', 'tenant_financials', t[0].id, null);
  res.json({ ok: true });
});

module.exports = r;
