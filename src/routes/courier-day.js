// מסך שליח — רשימת משימות מקובצת (איסוף/מסירה), מסלול יום, ואישור מסירה עם קוד לקוח או צילום.
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireCourier } = require('../auth');
const { completeDelivery } = require('../courier-actions');

const r = express.Router();
r.use(requireAuth, requireCourier);

const SELECT_FIELDS = `
  SELECT o.id, o.status, o.address, o.lat, o.lng, o.pickup_at, o.delivery_at, o.total,
         o.payment_method, o.payment_status, o.updated_at,
         t.name AS tenant_name, t.address AS tenant_address, t.city AS tenant_city,
         t.lat AS tenant_lat, t.lng AS tenant_lng,
         u.name AS customer_name, u.phone AS customer_phone,
         (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty)) FROM order_items oi WHERE oi.order_id=o.id) AS items,
         (SELECT json_build_object('method',dc.method,'at',dc.created_at) FROM delivery_confirmations dc WHERE dc.order_id=o.id) AS confirmation`;
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
r.get('/day-route', async (req, res) => {
  const { rows } = await q(
    `${SELECT_FIELDS}, rs.seq AS route_seq
     ${FROM_JOIN}
     LEFT JOIN courier_route_stops rs ON rs.order_id=o.id
     LEFT JOIN courier_routes cr ON cr.id=rs.route_id AND cr.route_date=CURRENT_DATE
     WHERE o.courier_id=$1 AND o.status IN ('confirmed','ready','out_for_delivery')
     ORDER BY COALESCE(rs.seq, 9999), COALESCE(o.pickup_at, o.delivery_at, o.created_at)`, [req.courier.id]);
  const { rows: doneRows } = await q(
    `${SELECT_FIELDS} ${FROM_JOIN}
     WHERE o.courier_id=$1 AND o.status='delivered'
       AND (o.updated_at AT TIME ZONE 'Asia/Jerusalem')::date = (now() AT TIME ZONE 'Asia/Jerusalem')::date
     ORDER BY o.updated_at`, [req.courier.id]);
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
  const doneStops = doneRows.map((o, i) => ({
    seq: stops.length + i + 1, kind: 'deliver', done: true,
    order: pubOrder(o), stop_address: o.address, stop_lat: o.lat, stop_lng: o.lng, when: o.updated_at,
  }));
  res.json({
    stops: [...stops, ...doneStops],
    summary: {
      total: stops.length + doneStops.length,
      done: doneStops.length,
      remaining: stops.length,
      pickups: stops.filter(s => s.kind === 'pickup').length,
      deliveries: stops.filter(s => s.kind !== 'pickup').length,
    },
  });
});

// אישור מסירה: קוד = 4 ספרות אחרונות של טלפון הלקוח, או צילום אישור. משלים את ההזמנה להוחזרה.
r.post('/orders/:id/confirm-delivery', async (req, res) => {
  const { method, code, photo_url, note } = req.body || {};
  if (!['code', 'photo'].includes(method)) return res.status(400).json({ error: 'method: code | photo' });
  const { rows: o } = await q('SELECT * FROM orders WHERE id=$1 AND courier_id=$2', [req.params.id, req.courier.id]);
  const order = o[0];
  if (!order) return res.status(404).json({ error: 'הזמנה לא משובצת אליך' });
  if (order.status === 'delivered') return res.status(409).json({ error: 'ההזמנה כבר סומנה כהוחזרה' });
  if (!['out_for_delivery', 'ready'].includes(order.status)) {
    return res.status(409).json({ error: `לא ניתן לאשר מסירה מתוך סטטוס ${order.status}` });
  }
  if (method === 'photo' && !photo_url) return res.status(400).json({ error: 'נדרש צילום אישור מסירה' });
  if (method === 'code') {
    const { rows: cu } = await q('SELECT phone FROM users WHERE id=$1', [order.customer_id]);
    const last4 = String((cu[0] || {}).phone || '').replace(/\D/g, '').slice(-4);
    if (!code || String(code).replace(/\D/g, '') !== last4) {
      return res.status(400).json({ error: 'קוד האישור שגוי — יש לבקש מהלקוח את 4 הספרות האחרונות של הטלפון שלו' });
    }
  }
  try {
    await q('INSERT INTO delivery_confirmations(order_id, courier_id, method, detail) VALUES ($1,$2,$3,$4)',
      [order.id, req.courier.id, method, note || null]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'כבר קיים אישור מסירה להזמנה זו' });
    throw e;
  }
  await completeDelivery({ order, courierId: req.courier.id, actorId: req.user.id, photoUrl: photo_url || null, note: note || 'מסירה אושרה על ידי הלקוח' });
  res.json({ ok: true, confirmed: true, method });
});

module.exports = r;
