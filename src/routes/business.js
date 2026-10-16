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
  const { name, company_id, contact_name, contact_phone, payment_terms, active, consolidated_billing } = req.body || {};
  const { rows } = await q(
    `UPDATE business_accounts SET name=COALESCE($3,name), company_id=COALESCE($4,company_id),
       contact_name=COALESCE($5,contact_name), contact_phone=COALESCE($6,contact_phone),
       payment_terms=COALESCE($7,payment_terms), active=COALESCE($8,active),
       consolidated_billing=COALESCE($9,consolidated_billing)
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [acc.id, req.tenant.id, name ?? null, company_id ?? null, contact_name ?? null, contact_phone ?? null, payment_terms ?? null,
     typeof active === 'boolean' ? active : null,
     typeof consolidated_billing === 'boolean' ? consolidated_billing : null]);
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

// E4.T2: תבניות הזמנה חוזרת לחשבון עסקי
r.get('/:bid/recurring', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const { rows } = await q(
    `SELECT rt.*, u.name AS user_name, u.phone AS user_phone FROM recurring_templates rt
     JOIN users u ON u.id=rt.user_id WHERE rt.account_id=$1 ORDER BY rt.created_at DESC`, [acc.id]);
  res.json({ templates: rows });
});

r.post('/:bid/recurring', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const { user_id, days, items, pickup_time, address } = req.body || {};
  if (!user_id || !Array.isArray(days) || !days.length || !Array.isArray(items) || !items.length || !address)
    return res.status(400).json({ error: 'חסרים פרטי תבנית (משתמש, ימים, פריטים, כתובת)' });
  const cleanDays = [...new Set(days.map(Number))].filter(d => d >= 0 && d <= 6);
  if (!cleanDays.length) return res.status(400).json({ error: 'ימים לא תקינים' });
  const { rows: mem } = await q('SELECT 1 FROM business_account_users WHERE account_id=$1 AND user_id=$2', [acc.id, user_id]);
  if (!mem[0]) return res.status(400).json({ error: 'המשתמש לא משויך לחשבון העסקי' });
  if (pickup_time && !/^\d{1,2}:\d{2}$/.test(pickup_time)) return res.status(400).json({ error: 'שעת איסוף לא תקינה' });
  const { rows } = await q(
    `INSERT INTO recurring_templates(account_id, user_id, days, items, pickup_time, address)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [acc.id, user_id, JSON.stringify(cleanDays), JSON.stringify(items), pickup_time || null, String(address).trim()]);
  res.json({ template: rows[0] });
});

r.patch('/:bid/recurring/:rid', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const { days, items, pickup_time, address, active } = req.body || {};
  const cleanDays = Array.isArray(days) ? [...new Set(days.map(Number))].filter(d => d >= 0 && d <= 6) : null;
  const { rows } = await q(
    `UPDATE recurring_templates SET days=COALESCE($3,days), items=COALESCE($4,items),
       pickup_time=COALESCE($5,pickup_time), address=COALESCE($6,address), active=COALESCE($7,active)
     WHERE id=$1 AND account_id=$2 RETURNING *`,
    [req.params.rid, acc.id, cleanDays ? JSON.stringify(cleanDays) : null, items ? JSON.stringify(items) : null,
     pickup_time ?? null, address ?? null, typeof active === 'boolean' ? active : null]);
  if (!rows[0]) return res.status(404).json({ error: 'תבנית לא נמצאה' });
  res.json({ template: rows[0] });
});

r.delete('/:bid/recurring/:rid', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  await q('DELETE FROM recurring_templates WHERE id=$1 AND account_id=$2', [req.params.rid, acc.id]);
  res.json({ ok: true });
});

// E4.T3: חשבוניות מרוכזות חודשיות
const { issueInvoice, monthOrders, consolidatedCsv } = require('../billing');
const { toCsv } = require('../csv');

r.get('/:bid/invoices', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const { rows } = await q(
    'SELECT id, year, month, orders_count, total, issued_at FROM business_invoices WHERE account_id=$1 ORDER BY year DESC, month DESC', [acc.id]);
  res.json({ invoices: rows });
});

r.post('/:bid/invoices/generate', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const year = Number(req.body?.year), month = Number(req.body?.month);
  if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: 'חודש/שנה לא תקינים' });
  if (acc.consolidated_billing === false) return res.status(409).json({ error: 'חשבונית מרכזת כבויה עבור חשבון זה — ניתן להפעיל מחדש בהגדרות החשבון' });
  const inv = await issueInvoice(q, acc, req.tenant, year, month);
  if (!inv) return res.status(404).json({ error: 'לא נמצאו הזמנות בחודש זה' });
  res.json({ invoice: inv });
});

r.get('/:bid/invoices/:iid/pdf', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const { rows } = await q('SELECT * FROM business_invoices WHERE id=$1 AND account_id=$2', [req.params.iid, acc.id]);
  if (!rows[0] || !rows[0].pdf) return res.status(404).json({ error: 'חשבונית לא נמצאה' });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="invoice-${rows[0].year}-${rows[0].month}.pdf"`);
  res.send(rows[0].pdf);
});

r.get('/:bid/invoices/:iid/csv', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const { rows } = await q('SELECT * FROM business_invoices WHERE id=$1 AND account_id=$2', [req.params.iid, acc.id]);
  if (!rows[0]) return res.status(404).json({ error: 'חשבונית לא נמצאה' });
  const orders = await monthOrders(q, acc.id, rows[0].year, rows[0].month);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="invoice-${rows[0].year}-${rows[0].month}.csv"`);
  res.send(toCsv(consolidatedCsv(orders)));
});

// E4.T4: מצטבר חודשי לחשבון (למסך העסקי)
r.get('/:bid/summary', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const { rows } = await q(
    `SELECT count(*)::int AS orders_count, COALESCE(sum(o.total),0)::numeric(10,2) AS month_total
     FROM orders o WHERE o.business_account_id=$1 AND o.status NOT IN ('cancelled')
       AND date_trunc('month', o.created_at AT TIME ZONE 'Asia/Jerusalem') = date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem')`,
    [acc.id]);
  res.json({ summary: rows[0] });
});

// E4.T4: הזמנה חדשה מהמחירון ההסכמי — יצירה ע"י המכבסה עבור משתמש החשבון
r.post('/:bid/orders', async (req, res) => {
  const acc = await getAccount(req, res); if (!acc) return;
  const { user_id, items, address, pickup_at } = req.body || {};
  if (!user_id || !Array.isArray(items) || !items.length || !address)
    return res.status(400).json({ error: 'חסרים פרטי הזמנה (משתמש, פריטים, כתובת)' });
  const { rows: mem } = await q('SELECT 1 FROM business_account_users WHERE account_id=$1 AND user_id=$2', [acc.id, user_id]);
  if (!mem[0]) return res.status(400).json({ error: 'המשתמש לא משויך לחשבון העסקי' });
  const ids = items.map(i => i.item_id);
  const { rows: dbItems } = await q('SELECT * FROM price_items WHERE tenant_id=$1 AND active AND id = ANY($2)', [req.tenant.id, ids]);
  const { rows: bp } = await q('SELECT item_id, price FROM business_prices WHERE account_id=$1', [acc.id]);
  const omap = new Map(bp.map(x => [x.item_id, Number(x.price)]));
  let subtotal = 0;
  const lines = [];
  for (const it of items) {
    const db = dbItems.find(d => d.id === it.item_id);
    if (!db) return res.status(400).json({ error: 'פריט לא קיים במחירון' });
    const qty = Number(it.qty) || 1;
    if (qty <= 0 || qty > 100) return res.status(400).json({ error: 'כמות לא תקינה' });
    const price = omap.has(db.id) ? omap.get(db.id) : Number(db.price);
    subtotal += price * qty;
    lines.push({ item_id: db.id, name: db.name, price, qty });
  }
  const deliveryFee = Number(req.tenant.delivery_fee) || 0;
  const total = subtotal + deliveryFee;
  const { rows: o } = await q(
    `INSERT INTO orders(tenant_id, customer_id, source, address, pickup_at, subtotal, delivery_fee, discount, total,
       payment_method, payment_status, notes, business_account_id)
     VALUES ($1,$2,'admin',$3,$4,$5,$6,0,$7,'cash','pending',$8,$9) RETURNING *`,
    [req.tenant.id, user_id, String(address).trim(), pickup_at || null, subtotal, deliveryFee, total,
     `הזמנה עסקית — ${acc.name} (שוטף+30)`, acc.id]);
  for (const ln of lines) {
    await q('INSERT INTO order_items(order_id, item_id, name, price, qty) VALUES ($1,$2,$3,$4,$5)',
      [o[0].id, ln.item_id, ln.name, ln.price, ln.qty]);
  }
  await q(`INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,'new',$2,'הזמנה עסקית נוצרה ע"י המכבסה')`, [o[0].id, req.user.id]);
  res.status(201).json({ order: o[0] });
});

module.exports = r;
