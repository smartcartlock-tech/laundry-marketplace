const express = require('express');
const multer = require('multer');
const { q, pool } = require('../db');
const { requireAuth, requireCourier } = require('../auth');
const { notifyUser } = require('../notify');
const { accrueStop, getSetting, weekStart } = require('../routes-engine');

const r = express.Router();
r.use(requireAuth);

const { fileFilter, verifyFile, IMAGES } = require('../uploads');
const { uuidParams } = require('../validate');
const DOC_TYPES = [...IMAGES, 'application/pdf'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: fileFilter(DOC_TYPES),
});

const DOC_KINDS = ['license', 'insurance', 'photo'];
const DOC_LABELS = { license: 'רישיון נהיגה', insurance: 'ביטוח', photo: 'תמונה' };

// E5.T1: הרשמה עצמית של שליח עצמאי (ממתין לאישור אדמין). שליח שדחו יכול להגיש מחדש.
r.post('/register', upload.fields(DOC_KINDS.map(k => ({ name: k, maxCount: 1 }))), async (req, res) => {
  const badDoc = DOC_KINDS.some(k => (req.files?.[k] || []).some(f => !verifyFile(f, DOC_TYPES)));
  if (badDoc) return res.status(400).json({ error: 'תוכן הקובץ אינו תואם לסוג המדווח (JPG/PNG/WEBP/PDF בלבד)' });
  try {
    const { vehicle, areas, availability, model, name } = req.body || {};
    if (!vehicle || !String(vehicle).trim()) return res.status(400).json({ error: 'סוג רכב חובה' });
    const files = req.files || {};
    if (!files.license || !files.license[0]) return res.status(400).json({ error: 'יש לצרף רישיון נהיגה' });
    let areasArr = [];
    try { areasArr = Array.isArray(areas) ? areas : JSON.parse(areas || '[]'); } catch (e) { areasArr = String(areas || '').split(',').map(x => x.trim()).filter(Boolean); }
    if (!areasArr.length) return res.status(400).json({ error: 'יש לציין לפחות אזור פעילות אחד' });
    let avail = {};
    try { avail = typeof availability === 'string' ? JSON.parse(availability || '{}') : (availability || {}); } catch (e) { return res.status(400).json({ error: 'זמינות לא תקינה' }); }
    const mdl = ['shared', 'platform'].includes(model) ? model : 'platform';
    if (name && String(name).trim() && !req.user.name) await q('UPDATE users SET name=$2 WHERE id=$1', [req.user.id, String(name).trim()]);
    const { rows: existing } = await q('SELECT * FROM couriers WHERE user_id=$1', [req.user.id]);
    let courier;
    if (existing[0]) {
      if (existing[0].approved) return res.status(409).json({ error: 'אתה כבר רשום כשליח מאושר' });
      if (!existing[0].rejected_reason) return res.status(409).json({ error: 'הבקשה שלך כבר ממתינה לאישור' });
      // הגשה מחדש אחרי דחייה
      courier = (await q(
        `UPDATE couriers SET vehicle=$2, areas=$3, availability=$4, model=$5, rejected_reason=NULL WHERE id=$1 RETURNING *`,
        [existing[0].id, String(vehicle).trim(), areasArr, avail, mdl])).rows[0];
      await q('DELETE FROM courier_documents WHERE courier_id=$1', [courier.id]);
    } else {
      courier = (await q(
        `INSERT INTO couriers(user_id, tenant_id, model, vehicle, areas, availability, approved) VALUES ($1,NULL,$2,$3,$4,$5,false) RETURNING *`,
        [req.user.id, mdl, String(vehicle).trim(), areasArr, avail])).rows[0];
    }
    for (const kind of DOC_KINDS) {
      const f = (files[kind] || [])[0];
      if (!f) continue;
      await q('INSERT INTO courier_documents(courier_id, kind, filename, mime, data) VALUES ($1,$2,$3,$4,$5)',
        [courier.id, kind, f.originalname || kind, f.mimetype, f.buffer]);
    }
    if (req.user.role === 'customer') await q(`UPDATE users SET role='courier' WHERE id=$1`, [req.user.id]);
    res.status(201).json({ courier, status: 'pending' });
  } catch (e) {
    if (e && e.message && e.message.includes('קובץ')) return res.status(400).json({ error: e.message });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// סטטוס הבקשה שלי + מטא-דאטה של מסמכים שהוגשו
r.get('/registration', async (req, res) => {
  const { rows: c } = await q('SELECT * FROM couriers WHERE user_id=$1', [req.user.id]);
  if (!c[0]) return res.json({ registration: null });
  const { rows: docs } = await q(
    'SELECT id, kind, filename, mime, created_at FROM courier_documents WHERE courier_id=$1 ORDER BY created_at', [c[0].id]);
  res.json({ registration: { ...c[0], documents: docs, doc_labels: DOC_LABELS } });
});

// צפייה במסמך: בעל המסמך בלבד (אדמין דרך /api/admin)
r.get('/documents/:id', uuidParams('id'), async (req, res) => {
  const { rows } = await q(
    `SELECT d.* FROM courier_documents d JOIN couriers c ON c.id=d.courier_id WHERE d.id=$1 AND c.user_id=$2`,
    [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'מסמך לא נמצא' });
  res.setHeader('content-type', rows[0].mime);
  res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(rows[0].filename)}`);
  res.send(rows[0].data);
});

// מכאן והלאה: רק שליח רשום (ממתין לאישור עדיין לא מקבל הצעות אוטומטיות)
r.use(requireCourier);

// הצעות שיבוץ ממתינות
r.get('/offers', async (req, res) => {
  const { rows } = await q(
    `SELECT f.id AS offer_id, f.kind, f.created_at, o.id AS order_id, o.address, o.pickup_at, o.delivery_at,
            o.status, o.total, t.name AS tenant_name, t.address AS tenant_address, t.city AS tenant_city,
            (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty)) FROM order_items oi WHERE oi.order_id=o.id) AS items
     FROM courier_offers f JOIN orders o ON o.id=f.order_id JOIN tenants t ON t.id=o.tenant_id
     WHERE f.courier_id=$1 AND f.status='offered' ORDER BY f.created_at DESC`, [req.courier.id]);
  res.json({ offers: rows });
});

r.post('/offers/:id/accept', uuidParams('id'), async (req, res) => {
  const { rows } = await q(
    `UPDATE courier_offers SET status='accepted', responded_at=now()
     WHERE id=$1 AND courier_id=$2 AND status='offered'
       AND EXISTS(SELECT 1 FROM orders o WHERE o.id=courier_offers.order_id AND o.courier_id IS NULL AND o.status NOT IN ('delivered','cancelled'))
     RETURNING *`, [req.params.id, req.courier.id]);
  if (!rows[0]) return res.status(404).json({ error: 'הצעה לא נמצאה, כבר טופלה, או שההזמנה אינה פעילה' }); // QA-flow: בדיקת סטטוס הזמנה
  await q(`UPDATE orders SET courier_id=$1, updated_at=now() WHERE id=$2 AND courier_id IS NULL AND status NOT IN ('delivered','cancelled')`, [req.courier.id, rows[0].order_id]);
  await q(`UPDATE courier_offers SET status='expired' WHERE order_id=$1 AND id<>$2 AND status='offered'`,
    [rows[0].order_id, rows[0].id]);
  await q('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,(SELECT status FROM orders WHERE id=$1),$2,$3)',
    [rows[0].order_id, req.user.id, 'שליח אישר שיבוץ']);
  res.json({ ok: true });
});

r.post('/offers/:id/decline', uuidParams('id'), async (req, res) => {
  const { rows } = await q(
    `UPDATE courier_offers SET status='declined', responded_at=now()
     WHERE id=$1 AND courier_id=$2 AND status='offered' RETURNING id`, [req.params.id, req.courier.id]);
  if (!rows[0]) return res.status(404).json({ error: 'הצעה לא נמצאה או כבר טופלה' });
  res.json({ ok: true }); // דחייה אינה פוגעת בדירוג (לפי האיפיון)
});

// מסלול היום: כל ההזמנות ששובצו לשליח ועדיין פעילות
r.get('/route', async (req, res) => {
  const { rows } = await q(
    `SELECT o.id, o.status, o.address, o.lat, o.lng, o.pickup_at, o.delivery_at, o.total, o.payment_method,
            t.name AS tenant_name, t.address AS tenant_address, t.lat AS tenant_lat, t.lng AS tenant_lng,
            u.name AS customer_name, u.phone AS customer_phone,
            rs.seq AS route_seq, cr.combined AS route_combined, cr.id AS route_id,
            (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty)) FROM order_items oi WHERE oi.order_id=o.id) AS items
     FROM orders o JOIN tenants t ON t.id=o.tenant_id JOIN users u ON u.id=o.customer_id
     LEFT JOIN courier_route_stops rs ON rs.order_id=o.id
     LEFT JOIN courier_routes cr ON cr.id=rs.route_id AND cr.route_date=CURRENT_DATE
     WHERE o.courier_id=$1 AND o.status IN ('confirmed','picked_up','ready','out_for_delivery')
     ORDER BY COALESCE(rs.seq, 9999), COALESCE(o.pickup_at, o.created_at)`, [req.courier.id]);
  res.json({ route: rows, combined: rows.some(x => x.route_combined) });
});

// E5.T3: המסלול שלי היום — רצף אחד מאוחד גם מכמה מכבסות
r.get('/routes/today', async (req, res) => {
  const { rows: routes } = await q(
    `SELECT cr.id, cr.route_date, cr.combined, cr.status, count(rs.id)::int AS stops,
            count(DISTINCT rs.tenant_id)::int AS tenants
     FROM courier_routes cr LEFT JOIN courier_route_stops rs ON rs.route_id=cr.id
     WHERE cr.courier_id=$1 AND cr.route_date=CURRENT_DATE
     GROUP BY cr.id ORDER BY cr.created_at DESC`, [req.courier.id]);
  if (!routes[0]) return res.json({ route: null });
  const { rows: stops } = await q(
    `SELECT rs.seq, rs.order_id, o.status, o.address, o.pickup_at, o.delivery_at, t.name AS tenant_name
     FROM courier_route_stops rs JOIN orders o ON o.id=rs.order_id JOIN tenants t ON t.id=rs.tenant_id
     WHERE rs.route_id=$1 ORDER BY rs.seq`, [routes[0].id]);
  res.json({ route: { ...routes[0], stops } });
});

// E5.T4: דוח רווחים שבועי — פירוט לפי מכבסה, ברוטו/עמלה/נטו
r.get('/earnings', async (req, res) => {
  const ws = /^\d{4}-\d{2}-\d{2}$/.test(req.query.week || '') ? req.query.week : null;
  const params = [req.courier.id];
  let where = 'e.courier_id=$1';
  if (ws) { params.push(ws); where += ' AND e.week_start=$2'; }
  const { rows: byTenant } = await q(
    `SELECT e.tenant_id, COALESCE(t.name,'—') AS tenant_name,
            sum(e.stops)::int AS stops, sum(e.gross)::numeric(9,2) AS gross,
            sum(e.commission)::numeric(9,2) AS commission, sum(e.net)::numeric(9,2) AS net
     FROM courier_earnings e LEFT JOIN tenants t ON t.id=e.tenant_id
     WHERE ${where} AND e.status<>'disputed'
     GROUP BY e.tenant_id, t.name ORDER BY gross DESC`, params);
  const { rows: totals } = await q(
    `SELECT COALESCE(sum(e.stops),0)::int AS stops, COALESCE(sum(e.gross),0)::numeric(9,2) AS gross,
            COALESCE(sum(e.commission),0)::numeric(9,2) AS commission, COALESCE(sum(e.net),0)::numeric(9,2) AS net,
            COALESCE(sum(e.net) FILTER (WHERE e.status='accrued'),0)::numeric(9,2) AS accrued_net,
            COALESCE(sum(e.net) FILTER (WHERE e.status='paid_demo'),0)::numeric(9,2) AS paid_net
     FROM courier_earnings e WHERE ${where}`, params);
  const { rows: rows2 } = await q(
    `SELECT e.id, e.kind, e.stops, e.gross, e.commission, e.net, e.status, e.week_start, e.created_at,
            t.name AS tenant_name, e.order_id
     FROM courier_earnings e LEFT JOIN tenants t ON t.id=e.tenant_id
     WHERE ${where} ORDER BY e.created_at DESC LIMIT 100`, params);
  const rate = await getSetting('courier_rate_per_stop', '12');
  const pct = await getSetting('courier_commission_pct', '20');
  res.json({ by_tenant: byTenant, totals: totals[0], rows: rows2, rate_per_stop: Number(rate), commission_pct: Number(pct) });
});

// E5.T4: תשלום דמו שבועי — סימון כל הזיכויים הפתוחים של השבוע כשולמו
r.post('/earnings/payout', async (req, res) => {
  const ws = /^\d{4}-\d{2}-\d{2}$/.test((req.body || {}).week_start || '') ? req.body.week_start : weekStart(new Date());
  const { rows } = await q(
    `UPDATE courier_earnings SET status='paid_demo' WHERE courier_id=$1 AND week_start=$2 AND status='accrued' RETURNING id`,
    [req.courier.id, ws]);
  res.json({ ok: true, paid: rows.length, week_start: ws, demo: true });
});

// E5.T4/T8: מחלוקת על רשומת תשלום
r.post('/earnings/:id/dispute', uuidParams('id'), async (req, res) => {
  const { rows } = await q(
    `UPDATE courier_earnings SET status='disputed' WHERE id=$1 AND courier_id=$2 AND status='accrued' RETURNING id`,
    [req.params.id, req.courier.id]);
  if (!rows[0]) return res.status(404).json({ error: 'רשומה לא נמצאה או כבר טופלה' });
  res.json({ ok: true });
});

// סימון איסוף/מסירה על ידי שליח (עם תמונה אופציונלית)
r.post('/orders/:id/mark', uuidParams('id'), async (req, res) => {
  const { action, photo_url, note } = req.body || {};
  const map = { picked_up: 'picked_up', out_for_delivery: 'out_for_delivery', delivered: 'delivered' };
  const newStatus = map[action];
  if (!newStatus) return res.status(400).json({ error: 'action: picked_up | delivered' });
  // QA-flow: טרנזקציה + FOR UPDATE — סימון כפול במקביל מצליח פעם אחת; delivered רק אחרי out_for_delivery
  const client = await pool.connect();
  let order, windowViolation = false;
  try {
    await client.query('BEGIN');
    const { rows: o } = await client.query('SELECT * FROM orders WHERE id=$1 AND courier_id=$2 FOR UPDATE', [req.params.id, req.courier.id]);
    order = o[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'הזמנה לא משובצת אליך' }); }
    const allowed = { picked_up: ['confirmed'], out_for_delivery: ['ready'], delivered: ['out_for_delivery'] };
    if (!allowed[newStatus].includes(order.status)) { await client.query('ROLLBACK'); return res.status(409).json({ error: `לא ניתן לסמן מתוך סטטוס ${order.status}` }); }

  // QA2.T4: חלון איסוף — לא חוסמים עבודת שטח, אבל סימון מחוץ לחלון מתועד כחריגה באירועי ההזמנה
  if (newStatus === 'picked_up' && order.pickup_at) {
    const { rows: w } = await q(
      `SELECT start_time, end_time FROM pickup_windows
       WHERE tenant_id=$1 AND kind='pickup'
         AND weekday = EXTRACT(ISODOW FROM ($2::timestamptz AT TIME ZONE 'Asia/Jerusalem'))::int % 7
         AND start_time = ($2::timestamptz AT TIME ZONE 'Asia/Jerusalem')::time
       LIMIT 1`, [order.tenant_id, order.pickup_at]);
    if (w[0]) {
      const [sh, sm] = String(w[0].start_time).split(':').map(Number);
      const [eh, em] = String(w[0].end_time).split(':').map(Number);
      const winStart = new Date(order.pickup_at).getTime();
      const winEnd = winStart + (((eh * 60 + em) - (sh * 60 + sm)) * 60000);
      const nowMs = Date.now();
      const GRACE_BEFORE = 60 * 60000, GRACE_AFTER = 120 * 60000; // שעה מוקדם / שעתיים איחור ללא חריגה
      if (nowMs < winStart - GRACE_BEFORE || nowMs > winEnd + GRACE_AFTER) windowViolation = true;
    }
  }

    await client.query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', [newStatus, order.id]);
    const evNote = [note || null, windowViolation ? 'חריגה: האיסוף סומן מחוץ לחלון שנקבע' : null].filter(Boolean).join(' · ') || null;
    await client.query('INSERT INTO order_events(order_id, status, actor_id, note, photo_url) VALUES ($1,$2,$3,$4,$5)',
      [order.id, newStatus, req.user.id, evNote, photo_url || null]);
    if (newStatus === 'delivered' && order.points_earned > 0) {
      await client.query('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
        [order.tenant_id, order.customer_id, order.points_earned, 'צבירת נקודות מהזמנה', order.id]);
      if (order.payment_method === 'cash') await client.query(`UPDATE orders SET payment_status='paid_cash' WHERE id=$1`, [order.id]);
    }
    if (newStatus === 'delivered') {
      const { issueDocumentsForOrder } = require('../documents');
      const { rows: tt } = await client.query('SELECT * FROM tenants WHERE id=$1', [order.tenant_id]);
      const { rows: ord } = await client.query('SELECT * FROM orders WHERE id=$1', [order.id]);
      await issueDocumentsForOrder(client, { tenant: tt[0], order: ord[0], actorId: req.user.id });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); return res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
  // אחרי commit בלבד: צבירת שליח + התראות (לא קריטיים אם נכשלים)
  if (newStatus === 'picked_up') await accrueStop(req.courier.id, order, 'pickup').catch(e => console.error('[earnings]', e.message));
  if (newStatus === 'delivered') await accrueStop(req.courier.id, order, 'delivery').catch(e => console.error('[earnings]', e.message));
  const { rows: cust } = await q('SELECT id, phone FROM users WHERE id=$1', [order.customer_id]);
  const HE = { picked_up: 'נאספה על ידי השליח', out_for_delivery: 'בדרך אליך', delivered: 'סומנה כהוחזרה. תודה!' };
  if (cust[0]) notifyUser(cust[0].id, order.tenant_id, `הזמנתך (#${order.id.slice(0,8)}) ${HE[newStatus]}.`, cust[0].phone).catch(() => {});
  res.json({ ok: true, ...(windowViolation ? { window_violation: true } : {}) });
});

// E5.T7: שליח מדרג מכבסה (הכנת שקים, דיוק נקודות)
r.post('/rate-tenant', async (req, res) => {
  const { order_id, rating, text } = req.body || {};
  const rt = Number(rating);
  if (!(rt >= 1 && rt <= 5)) return res.status(400).json({ error: 'דירוג 1-5' });
  const { rows: o } = await q('SELECT id, tenant_id, status FROM orders WHERE id=$1 AND courier_id=$2', [order_id, req.courier.id]);
  if (!o[0]) return res.status(404).json({ error: 'הזמנה לא נמצאה או לא שובצה אליך' });
  try {
    await q('INSERT INTO courier_tenant_ratings(courier_id, tenant_id, order_id, rating, text) VALUES ($1,$2,$3,$4,$5)',
      [req.courier.id, o[0].tenant_id, order_id, rt, text || null]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'כבר דירגת את המכבסה על הזמנה זו' });
    throw e;
  }
  res.json({ ok: true });
});

// פרופיל שליח + סטטיסטיקה
r.get('/profile', async (req, res) => {
  const { rows: stats } = await q(
    `SELECT count(*) FILTER (WHERE status='delivered')::int AS delivered,
            count(*) FILTER (WHERE status IN ('confirmed','picked_up','ready','out_for_delivery'))::int AS active
     FROM orders WHERE courier_id=$1`, [req.courier.id]);
  res.json({ courier: req.courier, stats: stats[0] });
});

module.exports = r;
