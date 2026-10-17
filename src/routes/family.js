// CX-B3: הצטרפות משפחה/שותף למנוי (דמו) — קישור הזמנה להעתקה בלבד, בלי שליחת הודעות
const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const me = express.Router();
me.use(requireAuth);

me.get('/', async (req, res) => {
  const { rows: members } = await q(
    `SELECT fm.member_user_id, fm.created_at, u.phone, u.name FROM family_members fm
     JOIN users u ON u.id=fm.member_user_id WHERE fm.owner_user_id=$1 ORDER BY fm.created_at`,
    [req.user.id]);
  const { rows: inv } = await q(
    'SELECT token, created_at FROM family_invites WHERE owner_user_id=$1 AND used_by IS NULL ORDER BY created_at DESC LIMIT 1',
    [req.user.id]);
  const mask = p => p ? String(p).replace(/^(.{5}).+(.{2})$/, '$1•••••$2') : '';
  // T17: מסך "אני חבר אצל X" — החברות שלי כחבר (לא כבעלים)
  const { rows: membership } = await q(
    `SELECT fm.created_at, u.name, u.phone FROM family_members fm
     JOIN users u ON u.id=fm.owner_user_id WHERE fm.member_user_id=$1`,
    [req.user.id]);
  // T17: אפקט משותף — בעל המנוי רואה ומנהל את הזמנות החברים (מידע מינימלי בלבד)
  const { rows: familyOrders } = await q(
    `SELECT o.id, o.status, o.total, o.created_at, t.name AS tenant_name, u.name AS member_name
     FROM orders o
     JOIN family_members fm ON fm.owner_user_id=$1 AND fm.member_user_id=o.customer_id
     JOIN tenants t ON t.id=o.tenant_id
     JOIN users u ON u.id=o.customer_id
     ORDER BY o.created_at DESC LIMIT 20`,
    [req.user.id]);
  res.json({
    members: members.map(m => ({ id: m.member_user_id, name: m.name || '', phone: mask(m.phone), since: m.created_at })),
    invite: inv[0] ? { token: inv[0].token } : null,
    membership: membership[0] ? { owner_name: membership[0].name || mask(membership[0].phone), since: membership[0].created_at } : null,
    family_orders: familyOrders.map(o => ({ id: o.id, status: o.status, total: o.total, created_at: o.created_at, tenant_name: o.tenant_name, member_name: o.member_name || '' })),
  });
});

// T17: הסרת חבר על ידי בעל המנוי
me.delete('/members/:userId', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.userId)) return res.status(400).json({ error: 'מזהה לא תקין' });
  const { rowCount } = await q('DELETE FROM family_members WHERE owner_user_id=$1 AND member_user_id=$2', [req.user.id, req.params.userId]);
  if (!rowCount) return res.status(404).json({ error: 'החבר לא נמצא במנוי' });
  res.json({ ok: true });
});

// T17: עזיבת מנוי על ידי החבר עצמו
me.post('/leave', async (req, res) => {
  const { rowCount } = await q('DELETE FROM family_members WHERE member_user_id=$1', [req.user.id]);
  res.json({ ok: true, was_member: rowCount > 0 });
});

// T17: ביטול הזמנה משפחתית על ידי בעל המנוי (אותם כללים כמו ביטול לקוח: לפני איסוף בלבד)
me.post('/orders/:orderId/cancel', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.orderId)) return res.status(400).json({ error: 'מזהה לא תקין' });
  const { pool } = require('../db');
  const { restoreBags } = require('../subscriptions');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT o.* FROM orders o
       JOIN family_members fm ON fm.owner_user_id=$2 AND fm.member_user_id=o.customer_id
       WHERE o.id=$1 FOR UPDATE OF o`, [req.params.orderId, req.user.id]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ההזמנה לא נמצאה במנוי המשפחתי' }); }
    if (!['new', 'confirmed'].includes(order.status)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'לא ניתן לבטל לאחר איסוף' }); }
    await client.query(`UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1`, [order.id]);
    await client.query(`INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,'cancelled',$2,'בוטלה על ידי בעל המנוי המשפחתי')`, [order.id, req.user.id]);
    if (Number(order.points_redeemed) > 0)
      await client.query('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
        [order.tenant_id, order.customer_id, Number(order.points_redeemed), 'החזר נקודות בעקבות ביטול הזמנה', order.id]);
    if (order.coupon_id)
      await client.query('UPDATE coupons SET used_count = GREATEST(0, used_count - 1) WHERE id=$1', [order.coupon_id]);
    await restoreBags(client, order.id);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

me.post('/invite', async (req, res) => {
  const { rows: existing } = await q(
    'SELECT token FROM family_invites WHERE owner_user_id=$1 AND used_by IS NULL ORDER BY created_at DESC LIMIT 1',
    [req.user.id]);
  if (existing[0]) return res.json({ token: existing[0].token });
  const token = crypto.randomBytes(6).toString('base64url');
  await q('INSERT INTO family_invites(owner_user_id, token) VALUES ($1,$2)', [req.user.id, token]);
  res.status(201).json({ token });
});

const pub = express.Router();
pub.post('/join', requireAuth, async (req, res) => {
  const token = String((req.body || {}).token || '').trim();
  if (!token) return res.status(400).json({ error: 'קישור לא תקין' });
  const { rows } = await q('SELECT id, owner_user_id, used_by FROM family_invites WHERE token=$1', [token]);
  const inv = rows[0];
  if (!inv) return res.status(404).json({ error: 'קישור ההזמנה לא נמצא או שפג תוקפו' });
  if (inv.owner_user_id === req.user.id) return res.status(400).json({ error: 'לא ניתן להצטרף למנוי של עצמך' });
  if (inv.used_by) return res.status(409).json({ error: 'קישור ההזמנה כבר נוצל' });
  await q('UPDATE family_invites SET used_by=$1, used_at=now() WHERE id=$2', [req.user.id, inv.id]);
  await q('INSERT INTO family_members(owner_user_id, member_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [inv.owner_user_id, req.user.id]);
  res.json({ ok: true });
});

module.exports = { me, pub };
