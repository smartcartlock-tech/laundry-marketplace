// T108: מסירה עצמית בלי שליח ('אני מסירה בעצמי') + הוספת שליח פרטי למכבסה.
// חוסם עסקי למכבסה קטנה: בעלים יכול לקדם הזמנה לאספקה בלי שליח רשום.
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');
const { uuidParams } = require('../validate');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);
r.use(require('../ratelimit').writeLimiter('tenant-write', 90));

// סימון הזמנה כמסירה עצמית — לאחר מכן מותר לקדם picked_up/out_for_delivery/delivered בלי שליח
r.post('/orders/:id/self-deliver', uuidParams('id'), async (req, res) => {
  const { rows: o } = await q('SELECT id, status, courier_id, self_delivery FROM orders WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!o[0]) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  if (o[0].courier_id) return res.status(409).json({ error: 'להזמנה כבר שובץ שליח — לא ניתן לסמן מסירה עצמית' });
  if (['delivered', 'cancelled'].includes(o[0].status)) return res.status(409).json({ error: 'ההזמנה כבר הסתיימה' });
  if (o[0].self_delivery) return res.json({ ok: true, already: true });
  await q('UPDATE orders SET self_delivery=true, updated_at=now() WHERE id=$1', [o[0].id]);
  await q('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,$2,$3,$4)',
    [o[0].id, o[0].status, req.user.id, 'מסירה עצמית — בעלים מסירה בעצמו, ללא שליח']);
  res.json({ ok: true, self_delivery: true });
});

// ביטול מסירה עצמית (לפני שובץ שליח) — חוזרים לדרישת שיבוץ רגילה
r.delete('/orders/:id/self-deliver', uuidParams('id'), async (req, res) => {
  const { rowCount } = await q(
    `UPDATE orders SET self_delivery=false, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND self_delivery AND status NOT IN ('out_for_delivery','delivered','cancelled')`,
    [req.params.id, req.tenant.id]);
  if (!rowCount) return res.status(409).json({ error: 'לא ניתן לבטל מסירה עצמית במצב הנוכחי' });
  res.json({ ok: true, self_delivery: false });
});

// הוספת שליח פרטי למכבסה — הבעלים רושם שליח משלה (טלפון+שם); מאושר מיד ומשובץ דרך /assign הרגיל
r.post('/couriers', async (req, res) => {
  const { name, phone, vehicle } = req.body || {};
  const nm = String(name || '').trim();
  const ph = String(phone || '').trim();
  if (!nm || !ph) return res.status(400).json({ error: 'חסר שם או טלפון של השליח' });
  let { rows: u } = await q('SELECT id, role FROM users WHERE phone=$1', [ph]);
  if (!u[0]) {
    ({ rows: u } = await q('INSERT INTO users(name, phone, role) VALUES ($1,$2,$3) RETURNING id, role', [nm, ph, 'courier']));
  } else if (u[0].role !== 'courier') {
    await q(`UPDATE users SET role='courier' WHERE id=$1`, [u[0].id]);
  }
  const { rows: existing } = await q('SELECT id, tenant_id, model FROM couriers WHERE user_id=$1', [u[0].id]);
  if (existing[0]) {
    if (existing[0].tenant_id === req.tenant.id) return res.status(409).json({ error: 'השליח כבר רשום במכבסה זו' });
    return res.status(409).json({ error: 'הטלפון רשום כשליח של מכבסה אחרת או של הפלטפורמה' });
  }
  const { rows: c } = await q(
    `INSERT INTO couriers(user_id, tenant_id, model, vehicle, areas, approved) VALUES ($1,$2,'private',$3,'{}',true) RETURNING *`,
    [u[0].id, req.tenant.id, String(vehicle || '').trim() || null]);
  res.status(201).json({ courier: c[0] });
});

module.exports = r;
