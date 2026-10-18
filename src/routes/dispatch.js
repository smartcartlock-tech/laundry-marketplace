// T81: API שיבוץ אוטומטי (דמו) — שיגור, הצעות לשליח, קבלה/דחייה, לוג החלטות לבעלים/אדמין
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireCourier } = require('../auth');
const { uuidParams } = require('../validate');
const auto = require('../autodispatch');

const r = express.Router();
r.use(requireAuth);
r.use(require('../ratelimit').writeLimiter('dispatch-write', 40));

// שיגור ידני של שיבוץ אוטומטי להזמנה (בעל/צוות המכבסה של ההזמנה או אדמין פלטפורמה)
r.post('/orders/:id/trigger', uuidParams('id'), async (req, res) => {
  const { rows: o } = await q('SELECT id, tenant_id FROM orders WHERE id=$1', [req.params.id]);
  if (!o[0]) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  if (req.user.role !== 'admin') {
    const { rows: m } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [o[0].tenant_id, req.user.id]);
    if (!m[0]) return res.status(403).json({ error: 'אין הרשאה למכבסה זו' });
  }
  const result = await auto.dispatchOrder(o[0].tenant_id, o[0].id, 'manual');
  if (result.mode === 'error') return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  res.json(result);
});

// שליח: ההצעות הפתוחות שלי
r.get('/offers', requireCourier, async (req, res) => {
  // T109: מחזיר גם תגמול משוער, מרחק, ו-expires_at — הלקוח מציג טיימר ולא נותן להצעה "להיעלם בשתיקה"
  const { rows } = await q(
    `SELECT f.id AS offer_id, f.attempt, f.offered_at, f.payout_estimate, f.distance_km,
            f.offered_at + ($2 || ' minutes')::interval AS expires_at,
            o.id AS order_id, o.address, o.pickup_at, o.status AS order_status, t.name AS tenant_name
     FROM dispatch_offers f JOIN orders o ON o.id=f.order_id JOIN tenants t ON t.id=o.tenant_id
     WHERE f.courier_id=$1 AND f.status='offered' ORDER BY f.offered_at DESC`, [req.courier.id, String(auto.TIMEOUT_MIN)]);
  res.json({ offers: rows });
});

// שליח: קבלת הצעה (ראשון שמאשר זוכה)
r.post('/offers/:id/accept', requireCourier, uuidParams('id'), async (req, res) => {
  const result = await auto.acceptOffer(req.params.id, req.courier.id);
  if (result.mode !== 'accepted') return res.status(409).json({ error: 'ההצעה כבר לא פתוחה' });
  res.json({ ok: true });
});

// שליח: דחיית הצעה — מסומן skipped ומוצע מיד לשליח הבא
r.post('/offers/:id/decline', requireCourier, uuidParams('id'), async (req, res) => {
  const result = await auto.declineOffer(req.params.id, req.courier.id, String((req.body || {}).reason || '').slice(0, 200));
  if (result.mode === 'lost') return res.status(409).json({ error: 'ההצעה כבר לא פתוחה' });
  res.json({ ok: true, next: result.next });
});

// לוג החלטות: בעל מכבסה רואה רק את הטנאנט שלו; אדמין הכול. סינון לפי order_id אופציונלי
r.get('/log', async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where += ` AND EXISTS(SELECT 1 FROM tenant_members tm WHERE tm.tenant_id=dispatch_log.tenant_id AND tm.user_id=$${params.length})`;
  }
  const orderId = String(req.query.order_id || '');
  if (/^[0-9a-f-]{36}$/i.test(orderId)) { params.push(orderId); where += ` AND order_id=$${params.length}`; }
  params.push(Math.min(200, Number(req.query.limit) || 50));
  const { rows } = await q(`SELECT id, tenant_id, order_id, decision, reason, payload, created_at FROM dispatch_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
  res.json({ log: rows });
});

auto.start(); // סריקת פקיעת הצעות — פעם אחת לתהליך (unref)

module.exports = r;
