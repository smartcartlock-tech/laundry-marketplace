// מסך שליח — רשימת משימות מקובצת (איסוף/מסירה), מסלול יום, ואישור מסירה עם קוד לקוח או צילום.
const express = require('express');
const multer = require('multer');
const { q } = require('../db');
const { requireAuth, requireCourier } = require('../auth');
const { completeDelivery, parseCashConfirmation } = require('../courier-actions');
const { fileFilter, verifyFile, IMAGES } = require('../uploads');
const { nearestNeighbor, haversineKm, weekStart } = require('../routes-engine');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: fileFilter(IMAGES),
});

const r = express.Router();
r.use(requireAuth, requireCourier);

const SELECT_FIELDS = `
  SELECT o.id, o.status, o.address, o.lat, o.lng, o.pickup_at, o.delivery_at, o.total,
         o.payment_method, o.payment_status, o.updated_at,
         t.name AS tenant_name, t.address AS tenant_address, t.city AS tenant_city,
         t.lat AS tenant_lat, t.lng AS tenant_lng,
         u.name AS customer_name, u.phone AS customer_phone,
         (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty)) FROM order_items oi WHERE oi.order_id=o.id) AS items,
         (SELECT json_build_object('method',dc.method,'at',dc.created_at,'id',dc.id,'has_photo',(dc.photo_data IS NOT NULL)) FROM delivery_confirmations dc WHERE dc.order_id=o.id) AS confirmation`;
const FROM_JOIN = `
  FROM orders o JOIN tenants t ON t.id=o.tenant_id JOIN users u ON u.id=o.customer_id`;

function pubOrder(o) {
  return {
    id: o.id, status: o.status, address: o.address,
    pickup_at: o.pickup_at, delivery_at: o.delivery_at, total: o.total,
    payment_method: o.payment_method, payment_status: o.payment_status,
    tenant_name: o.tenant_name, tenant_address: o.tenant_address, tenant_city: o.tenant_city,
    customer_name: o.customer_name, customer_phone: o.customer_phone, items: o.items || [],
    confirmation: o.confirmation || null,
  };
}

// רשימת משימות מקובצת: איסופים ממתינים, כביסה אצל המכבסה, מסירות, הושלמו היום
r.get('/tasks', async (req, res) => {
  const { rows } = await q(
    `${SELECT_FIELDS} ${FROM_JOIN}
     WHERE o.courier_id=$1 AND (o.status IN ('confirmed','picked_up','in_work','ready','out_for_delivery')
       OR (o.status='delivered' AND (o.updated_at AT TIME ZONE 'Asia/Jerusalem')::date = (now() AT TIME ZONE 'Asia/Jerusalem')::date))
     ORDER BY COALESCE(o.pickup_at, o.created_at)`, [req.courier.id]);
  const tasks = {
    pickups: rows.filter(o => o.status === 'confirmed').map(pubOrder),
    in_laundry: rows.filter(o => ['picked_up', 'in_work'].includes(o.status)).map(pubOrder),
    deliveries: rows.filter(o => ['ready', 'out_for_delivery'].includes(o.status)).map(pubOrder),
    done_today: rows.filter(o => o.status === 'delivered').map(pubOrder),
  };
  const counts = Object.fromEntries(Object.entries(tasks).map(([k, v]) => [k, v.length]));
  res.json({ tasks, counts });
});

// מסלול יום: רצף נקודות ליום העבודה הנוכחי — איסוף מהלקוח, איסוף מהמכבסה, מסירה ללקוח
// ?date=YYYY-MM-DD מציג מסלול של יום אחר (בימים עברו: נקודות שהושלמו באותו יום בלבד)
r.get('/day-route', async (req, res) => {
  const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  const { rows } = await q(
    `${SELECT_FIELDS}, rs.seq AS route_seq
     ${FROM_JOIN}
     LEFT JOIN courier_route_stops rs ON rs.order_id=o.id
     LEFT JOIN courier_routes cr ON cr.id=rs.route_id AND cr.route_date=CURRENT_DATE
     WHERE o.courier_id=$1 AND o.status IN ('confirmed','ready','out_for_delivery')
       AND ($2::date IS NULL OR (now() AT TIME ZONE 'Asia/Jerusalem')::date = $2::date)
     ORDER BY COALESCE(rs.seq, 9999), COALESCE(o.pickup_at, o.delivery_at, o.created_at)`, [req.courier.id, dateParam]);
  const { rows: doneRows } = await q(
    `${SELECT_FIELDS} ${FROM_JOIN}
     WHERE o.courier_id=$1 AND o.status='delivered'
       AND (o.updated_at AT TIME ZONE 'Asia/Jerusalem')::date = COALESCE($2::date, (now() AT TIME ZONE 'Asia/Jerusalem')::date)
     ORDER BY o.updated_at`, [req.courier.id, dateParam]);
  const stops = rows.map((o, i) => {
    const kind = o.status === 'confirmed' ? 'pickup' : o.status === 'ready' ? 'collect' : 'deliver';
    const atTenant = kind === 'collect';
    return {
      seq: o.route_seq || i + 1, kind, done: false,
      order: pubOrder(o),
      stop_address: atTenant ? (o.tenant_address || o.tenant_city || '') : o.address,
      stop_lat: atTenant ? o.tenant_lat : o.lat,
      stop_lng: atTenant ? o.tenant_lng : o.lng,
      when: kind === 'pickup' ? o.pickup_at : o.delivery_at,
    };
  });
  let ordered = stops;
  // ?order=proximity: סידור nearest-neighbor לפי קרבה גיאוגרפית (haversine, בלי API חיצוני).
  // עם lat/lng של מיקום השליח השרשרת מתחילה מהנקודה הקרובה אליו.
  if (req.query.order === 'proximity') {
    const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
    const geo = stops.filter(s2 => s2.stop_lat != null && s2.stop_lng != null)
      .map(s2 => ({ ...s2, lat: s2.stop_lat, lng: s2.stop_lng }));
    const noGeo = stops.filter(s2 => s2.stop_lat == null || s2.stop_lng == null);
    if (Number.isFinite(lat) && Number.isFinite(lng) && geo.length > 1) {
      geo.sort((a, b) => haversineKm({ lat, lng }, a) - haversineKm({ lat, lng }, b));
    }
    ordered = nearestNeighbor(geo).concat(noGeo).map((s2, i) => ({ ...s2, seq: i + 1 }));
  }
  const doneStops = doneRows.map((o, i) => ({
    seq: ordered.length + i + 1, kind: 'deliver', done: true,
    order: pubOrder(o), stop_address: o.address, stop_lat: o.lat, stop_lng: o.lng, when: o.updated_at,
  }));
  res.json({
    date: dateParam || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }),
    ordered_by: req.query.order === 'proximity' ? 'proximity' : 'schedule',
    stops: [...ordered, ...doneStops],
    summary: {
      total: ordered.length + doneStops.length,
      done: doneStops.length,
      remaining: ordered.length,
      pickups: ordered.filter(s2 => s2.kind === 'pickup').length,
      deliveries: ordered.filter(s2 => s2.kind !== 'pickup').length,
    },
  });
});

// אישור מסירה: קוד = 4 ספרות אחרונות של טלפון הלקוח, או צילום אישור. משלים את ההזמנה להוחזרה.
r.post('/orders/:id/confirm-delivery', upload.single('photo'), async (req, res) => {
  const { method, code, photo_url, note } = req.body || {};
  if (!['code', 'photo'].includes(method)) return res.status(400).json({ error: 'method: code | photo' });
  const { rows: o } = await q('SELECT * FROM orders WHERE id=$1 AND courier_id=$2', [req.params.id, req.courier.id]);
  const order = o[0];
  if (!order) return res.status(404).json({ error: 'הזמנה לא משובצת אליך' });
  if (order.status === 'delivered') return res.status(409).json({ error: 'ההזמנה כבר סומנה כהוחזרה' });
  if (!['out_for_delivery', 'ready'].includes(order.status)) {
    return res.status(409).json({ error: `לא ניתן לאשר מסירה מתוך סטטוס ${order.status}` });
  }
  if (method === 'photo' && !req.file && !photo_url) return res.status(400).json({ error: 'נדרש צילום אישור מסירה' });
  if (method === 'photo' && req.file && !verifyFile(req.file, IMAGES)) {
    return res.status(400).json({ error: 'תוכן הקובץ אינו תואם לסוג המדווח (JPG/PNG/WEBP בלבד)' });
  }
  // T94: משימת מזומן לא נסגרת בלי צעד 'גביתי ₪X' / סכום אחר / סירב
  const cashConfirm = parseCashConfirmation(req.body, order);
  if (cashConfirm && cashConfirm.error) return res.status(cashConfirm.status || 400).json({ error: cashConfirm.error, code: cashConfirm.code });
  // T93: קוד מסירה חד-פעמי (6 ספרות) שהלקוח רואה במעקב/במרכז ההודעות — מחליף את מסלול 4 ספרות הטלפון
  if (method === 'code') {
    const got = String(code || '').replace(/\D/g, '');
    if (!got || got !== String(order.delivery_code || '')) {
      return res.status(400).json({ error: 'קוד המסירה שגוי — בקשו מהלקוח את קוד המסירה (6 ספרות) שמופיע אצלו במעקב ההזמנה' });
    }
  }
  try {
    await q('INSERT INTO delivery_confirmations(order_id, courier_id, method, detail, photo_data, photo_mime) VALUES ($1,$2,$3,$4,$5,$6)',
      [order.id, req.courier.id, method, note || null, req.file ? req.file.buffer : null, req.file ? req.file.mimetype : null]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'כבר קיים אישור מסירה להזמנה זו' });
    throw e;
  }
  await completeDelivery({ order, courierId: req.courier.id, actorId: req.user.id, photoUrl: photo_url || null, note: note || 'מסירה אושרה על ידי הלקוח', cashConfirm });
  res.json({ ok: true, confirmed: true, method });
});

// מתג זמינות: אונליין/אופליין — השיבוץ האוטומטי (routes-engine) משבץ רק שליחים זמינים
r.get('/availability', async (req, res) => {
  const { rows } = await q('SELECT is_online FROM couriers WHERE id=$1', [req.courier.id]);
  res.json({ online: rows[0] ? rows[0].is_online : true });
});

r.post('/availability', async (req, res) => {
  const online = !!(req.body || {}).online;
  await q('UPDATE couriers SET is_online=$2 WHERE id=$1', [req.courier.id, online]);
  res.json({ ok: true, online });
});

// רווחים לפי משימה: יומי (?period=day&date=YYYY-MM-DD) או שבועי (?period=week&date=יום-כלשהו-בשבוע).
// נתוני דמו בלבד מתוך courier_earnings — אין תשלום אמיתי.
r.get('/earnings/detail', async (req, res) => {
  const period = req.query.period === 'week' ? 'week' : 'day';
  const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  const params = [req.courier.id];
  let where;
  if (period === 'day') {
    params.push(dateParam);
    where = `e.courier_id=$1 AND (e.created_at AT TIME ZONE 'Asia/Jerusalem')::date = COALESCE($2::date, (now() AT TIME ZONE 'Asia/Jerusalem')::date)`;
  } else {
    params.push(weekStart(new Date((dateParam || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })) + 'T12:00:00')));
    where = `e.courier_id=$1 AND e.week_start=$2::date`;
  }
  const { rows: tasks } = await q(
    `SELECT e.id, e.kind, e.stops, e.gross, e.commission, e.net, e.status, e.created_at,
            to_char(e.created_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS day,
            COALESCE(t.name,'—') AS tenant_name, o.address AS order_address
     FROM courier_earnings e LEFT JOIN tenants t ON t.id=e.tenant_id LEFT JOIN orders o ON o.id=e.order_id
     WHERE ${where} AND e.status<>'disputed'
     ORDER BY e.created_at DESC`, params);
  const totals = tasks.reduce((a, x) => ({ stops: a.stops + x.stops, gross: +(a.gross + Number(x.gross)).toFixed(2), net: +(a.net + Number(x.net)).toFixed(2) }), { stops: 0, gross: 0, net: 0 });
  const byDayMap = {};
  for (const x of tasks) {
    const d = byDayMap[x.day] || (byDayMap[x.day] = { day: x.day, stops: 0, net: 0 });
    d.stops += x.stops; d.net = +(d.net + Number(x.net)).toFixed(2);
  }
  // T94: תיעוד גביית מזומן עם חותמת זמן + סיכום להתחשבנות מול כל מכבסה
  const cashWhere = period === 'day'
    ? `(cc.created_at AT TIME ZONE 'Asia/Jerusalem')::date = COALESCE($2::date, (now() AT TIME ZONE 'Asia/Jerusalem')::date)`
    : `(cc.created_at AT TIME ZONE 'Asia/Jerusalem')::date >= $2::date AND (cc.created_at AT TIME ZONE 'Asia/Jerusalem')::date < $2::date + 7`;
  const { rows: cashRows } = await q(
    `SELECT cc.id, cc.order_id, cc.outcome, cc.amount, cc.note, cc.created_at,
            to_char(cc.created_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI') AS at_local,
            COALESCE(t.name,'—') AS tenant_name, o.address AS order_address, o.total AS order_total
     FROM courier_cash_collections cc LEFT JOIN tenants t ON t.id=cc.tenant_id LEFT JOIN orders o ON o.id=cc.order_id
     WHERE cc.courier_id=$1 AND ${cashWhere}
     ORDER BY cc.created_at DESC LIMIT 200`, params);
  const cashByTenant = {};
  for (const c of cashRows) {
    if (c.outcome === 'refused') continue;
    const k = c.tenant_name;
    cashByTenant[k] = +( (cashByTenant[k] || 0) + Number(c.amount) ).toFixed(2);
  }
  res.json({ period, date: dateParam, tasks, totals, by_day: Object.values(byDayMap).sort((a, b) => b.day.localeCompare(a.day)),
    cash: cashRows, cash_by_tenant: cashByTenant,
    cash_total: +cashRows.filter(c => c.outcome !== 'refused').reduce((a2, c) => a2 + Number(c.amount), 0).toFixed(2) });
});

// היסטוריית משימות שהושלמו + הדירוג שהשליח רואה: דירוג לקוח לכל הזמנה והממוצע הכולל שלו
r.get('/history', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const { rows } = await q(
    `SELECT o.id, o.address, o.total, o.updated_at, t.name AS tenant_name, u.name AS customer_name,
            (SELECT json_build_object('method',dc.method,'at',dc.created_at,'id',dc.id,'has_photo',(dc.photo_data IS NOT NULL)) FROM delivery_confirmations dc WHERE dc.order_id=o.id) AS confirmation,
            (SELECT json_build_object('rating',rv.rating,'text',rv.text,'at',rv.created_at) FROM reviews rv WHERE rv.order_id=o.id AND rv.target_courier_id=$1 LIMIT 1) AS review
     FROM orders o JOIN tenants t ON t.id=o.tenant_id JOIN users u ON u.id=o.customer_id
     WHERE o.courier_id=$1 AND o.status='delivered'
     ORDER BY o.updated_at DESC LIMIT $2`, [req.courier.id, limit]);
  const { rows: agg } = await q('SELECT rating, rating_count FROM couriers WHERE id=$1', [req.courier.id]);
  res.json({ rating: agg[0] || { rating: 0, rating_count: 0 }, rows });
});

// סטטיסטיקת תגובה להצעות שיבוץ: פירוט זמן תגובה (שניות) + סיבות דחייה אחרונות
r.get('/offers/stats', async (req, res) => {
  const { rows: agg } = await q(
    `SELECT count(*) FILTER (WHERE status='accepted')::int AS accepted,
            count(*) FILTER (WHERE status='declined')::int AS declined,
            count(*) FILTER (WHERE status='offered')::int AS pending,
            COALESCE(avg(EXTRACT(EPOCH FROM (responded_at - created_at))) FILTER (WHERE responded_at IS NOT NULL),0)::int AS avg_response_seconds
     FROM courier_offers WHERE courier_id=$1`, [req.courier.id]);
  const { rows: recent } = await q(
    `SELECT f.id, f.status, f.decline_reason, f.created_at, f.responded_at,
            CASE WHEN f.responded_at IS NOT NULL THEN EXTRACT(EPOCH FROM (f.responded_at - f.created_at))::int END AS response_seconds,
            o.address, t.name AS tenant_name
     FROM courier_offers f JOIN orders o ON o.id=f.order_id JOIN tenants t ON t.id=o.tenant_id
     WHERE f.courier_id=$1 AND f.status IN ('accepted','declined')
     ORDER BY f.responded_at DESC LIMIT 20`, [req.courier.id]);
  res.json({ stats: agg[0], recent });
});

// פרופיל שליח: עדכון אזורי פעילות, כלי רכב ושעות פעילות (availability jsonb)
r.put('/profile', async (req, res) => {
  const { vehicle, areas, availability } = req.body || {};
  const veh = String(vehicle || '').trim().slice(0, 100);
  if (!veh) return res.status(400).json({ error: 'סוג רכב חובה' });
  const areasArr = (Array.isArray(areas) ? areas : String(areas || '').split(','))
    .map(x => String(x).trim()).filter(Boolean).slice(0, 10);
  if (!areasArr.length) return res.status(400).json({ error: 'יש לציין לפחות אזור פעילות אחד' });
  let avail = {};
  if (availability && typeof availability === 'object' && !Array.isArray(availability)) {
    // שעות פעילות לפי יום: { "0": {from:"08:00",to:"18:00",off:false}, ... } — מפתחות 0-6 בלבד
    for (const [k, v] of Object.entries(availability)) {
      if (!/^[0-6]$/.test(k) || typeof v !== 'object' || !v) continue;
      const from = /^\d{2}:\d{2}$/.test(v.from || '') ? v.from : null;
      const to = /^\d{2}:\d{2}$/.test(v.to || '') ? v.to : null;
      avail[k] = { from, to, off: !!v.off };
    }
  }
  const { rows } = await q(
    'UPDATE couriers SET vehicle=$2, areas=$3, availability=$4 WHERE id=$1 RETURNING id, vehicle, areas, availability',
    [req.courier.id, veh, areasArr, JSON.stringify(avail)]);
  res.json({ ok: true, courier: rows[0] });
});

module.exports = r;
