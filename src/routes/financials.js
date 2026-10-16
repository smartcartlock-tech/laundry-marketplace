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

r.put('/financials', async (req, res) => {
  const b = req.body || {};
  const { rows: t } = await q('SELECT id FROM tenants WHERE slug=$1', [req.params.slug]);
  const vals = FIELDS.map(f => encryptField(typeof b[f] === 'string' ? b[f].slice(0, 200) : null));
  await q(`INSERT INTO tenant_financials(tenant_id, bank_code_enc, branch_enc, account_number_enc, iban_enc, beneficiary_enc, supplier_notes_enc, updated_at, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8)
           ON CONFLICT (tenant_id) DO UPDATE SET bank_code_enc=$2, branch_enc=$3, account_number_enc=$4,
             iban_enc=$5, beneficiary_enc=$6, supplier_notes_enc=$7, updated_at=now(), updated_by=$8`,
    [t[0].id, ...vals, req.user.id]);
  await require('../audit').audit(req, 'PUT /api/t/' + req.params.slug + '/financials', 'tenant_financials', t[0].id, null);
  res.json({ ok: true });
});

module.exports = r;
