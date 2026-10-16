// E4.T1: חשבון עסקי B2B — CRUD חשבונות, מחירון הסכמי, שיוך משתמשים (צד מכבסה)
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);

async function getAccount(req, res) {
  const { rows } = await q('SELECT * FROM business_accounts WHERE id=$1 AND tenant_id=$2', [req.params.bid, req.tenant.id]);
  if (!rows[0]) { res.status(404).json({ error: 'חשבון עסקי לא נמצא' }); return null; }
  return rows[0];
}

r.get('/', async (req, res) => {
  const { rows } = await q(
    `SELECT ba.*, (SELECT count(*) FROM business_account_users bau WHERE bau.account_id=ba.id) AS users_count,
            (SELECT count(*) FROM business_prices bp WHERE bp.account_id=ba.id) AS prices_count
     FROM business_accounts ba WHERE ba.tenant_id=$1 ORDER BY ba.created_at DESC`, [req.tenant.id]);
  res.json({ accounts: rows });
});

r.post('/', async (req, res) => {
  const { name, company_id, contact_name, contact_phone, payment_terms } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'חסר שם חברה' });
  const { rows } = await q(
    `INSERT INTO business_accounts(tenant_id, name, company_id, contact_name, contact_phone, payment_terms)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.tenant.id, String(name).trim(), company_id || null, contact_name || null, contact_phone || null, payment_terms || 'net30']);
  res.json({ account: rows[0] });
});

r.get('/:bid', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const [prices, users] = await Promise.all([
    q(`SELECT bp.item_id, bp.price, pi.name, pi.price AS regular_price, pi.unit FROM business_prices bp
       JOIN price_items pi ON pi.id=bp.item_id WHERE bp.account_id=$1`, [acc.id]),
    q(`SELECT u.id, u.name, u.phone FROM business_account_users bau JOIN users u ON u.id=bau.user_id WHERE bau.account_id=$1`, [acc.id]),
  ]);
  res.json({ account: acc, prices: prices.rows, users: users.rows });
});

r.patch('/:bid', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const { name, company_id, contact_name, contact_phone, payment_terms, active } = req.body || {};
  const { rows } = await q(
    `UPDATE business_accounts SET name=COALESCE($3,name), company_id=COALESCE($4,company_id),
       contact_name=COALESCE($5,contact_name), contact_phone=COALESCE($6,contact_phone),
       payment_terms=COALESCE($7,payment_terms), active=COALESCE($8,active)
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [acc.id, req.tenant.id, name ?? null, company_id ?? null, contact_name ?? null, contact_phone ?? null, payment_terms ?? null,
     typeof active === 'boolean' ? active : null]);
  res.json({ account: rows[0] });
});

r.delete('/:bid', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  await q('DELETE FROM business_accounts WHERE id=$1', [acc.id]);
  res.json({ ok: true });
});

// מחירון הסכמי: [{item_id, price}] — price=null מסיר דריסה
r.put('/:bid/prices', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const prices = Array.isArray(req.body?.prices) ? req.body.prices : [];
  for (const p of prices) {
    if (!p.item_id) continue;
    const { rows: it } = await q('SELECT 1 FROM price_items WHERE id=$1 AND tenant_id=$2', [p.item_id, req.tenant.id]);
    if (!it[0]) return res.status(400).json({ error: 'פריט לא קיים במחירון המכבסה' });
    if (p.price === null || p.price === undefined) {
      await q('DELETE FROM business_prices WHERE account_id=$1 AND item_id=$2', [acc.id, p.item_id]);
    } else {
      const price = Number(p.price);
      if (!(price >= 0)) return res.status(400).json({ error: 'מחיר לא תקין' });
      await q(`INSERT INTO business_prices(account_id, item_id, price) VALUES ($1,$2,$3)
               ON CONFLICT (account_id, item_id) DO UPDATE SET price=EXCLUDED.price`, [acc.id, p.item_id, price]);
    }
  }
  const { rows } = await q('SELECT item_id, price FROM business_prices WHERE account_id=$1', [acc.id]);
  res.json({ prices: rows });
});

r.post('/:bid/users', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const phone = String(req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'חסר טלפון משתמש' });
  const { rows: u } = await q('SELECT id, name, phone FROM users WHERE phone=$1', [phone]);
  if (!u[0]) return res.status(404).json({ error: 'משתמש לא נמצא' });
  await q('INSERT INTO business_account_users(account_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [acc.id, u[0].id]);
  res.json({ user: u[0] });
});

r.delete('/:bid/users/:uid', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  await q('DELETE FROM business_account_users WHERE account_id=$1 AND user_id=$2', [acc.id, req.params.uid]);
  res.json({ ok: true });
});

module.exports = r;
