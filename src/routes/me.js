// C2: זכויות נושא מידע (תיקון 13) — ייצוא מלא של המידע האישי, ומחיקה באנונימיזציה.
// מסמכים חשבונאיים והזמנות נשמרים (חובת שמירת רשומות) אך מתנתקים מזהות הלקוח.
const express = require('express');
const { q, pool } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();

// ייצוא כל המידע האישי של המשתמש כ-JSON
r.get('/export', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const [addresses, orders, items, reviews, points, subs, issues, courier, memberships] = await Promise.all([
    q('SELECT label, address, created_at FROM user_addresses WHERE user_id=$1', [uid]),
    q('SELECT id, tenant_id, status, payment_status, address, pickup_at, subtotal, delivery_fee, discount, total, source, created_at FROM orders WHERE customer_id=$1', [uid]),
    q(`SELECT oi.order_id, oi.name, oi.price, oi.qty FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.customer_id=$1`, [uid]),
    q('SELECT order_id, rating, text, created_at FROM reviews WHERE user_id=$1', [uid]),
    q('SELECT order_id, points, kind, created_at FROM points_ledger WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT plan_id, status, bags_total, bags_used, started_at, period_end FROM subscriptions WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT id, order_id, kind, status, text, created_at FROM issue_reports WHERE customer_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT vehicle, areas, availability, model, approved, created_at FROM couriers WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT tenant_id, role FROM tenant_members WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
  ]);
  const u = { ...req.user };
  delete u.token_version;
  res.json({
    exported_at: new Date().toISOString(),
    profile: u,
    addresses: addresses.rows,
    orders: orders.rows.map(o => ({ ...o, items: items.rows.filter(i => i.order_id === o.id) })),
    reviews: reviews.rows,
    points_ledger: points.rows,
    subscriptions: subs.rows,
    issue_reports: issues.rows,
    courier_profile: courier.rows[0] || null,
    tenant_memberships: memberships.rows,
  });
});

// מחיקת החשבון — אנונימיזציה: מוחק מזהים אישיים, חוסם התחברות, מבטל טוקנים.
// נשמר: הזמנות ומסמכים (חובת שמירה), מנותקים מהזהות.
r.delete('/', requireAuth, async (req, res) => {
  if (req.user.anonymized_at) return res.status(409).json({ error: 'החשבון כבר נמחק' });
  const uid = req.user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_addresses WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM user_carts WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM push_subscriptions WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM otp_codes WHERE target=$1 OR target=$2', [req.user.phone || '', req.user.email || '']);
    await client.query(
      `UPDATE users SET name=NULL, email=NULL, google_sub=NULL, facebook_id=NULL,
         phone='deleted_' || id::text, token_version=token_version+1, anonymized_at=now()
       WHERE id=$1`, [uid]);
    await client.query('COMMIT');
    res.json({ ok: true, message: 'החשבון נמחק ועבר אנונימיזציה. הזמנות ומסמכים נשמרים לפי חובת שמירת הרשומות.' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// ביקורת סשנים: רשימת מכשירים מחוברים, ניתוק מכשיר בודד, ניתוק מכל המכשירים האחרים
r.get('/sessions', requireAuth, async (req, res) => {
  const { rows } = await q(
    `SELECT id, user_agent, ip, created_at, last_seen_at, expires_at, (jti=$2) AS current
     FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_seen_at DESC`, [req.user.id, req.sessionJti || '']);
  res.json({ sessions: rows });
});

r.delete('/sessions/:id', requireAuth, async (req, res) => {
  const { rowCount } = await q('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
    [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'סשן לא נמצא' });
  res.json({ ok: true });
});

r.post('/sessions/revoke-all', requireAuth, async (req, res) => {
  const { rowCount } = await q('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND jti<>$2',
    [req.user.id, req.sessionJti || '']);
  res.json({ ok: true, revoked: rowCount });
});

module.exports = r;
