const express = require('express');
const multer = require('multer');
const { fileFilter, verifyFile, IMAGES } = require('../uploads');
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: fileFilter(IMAGES) });
const { q, pool } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');
const { notifyUser } = require('../notify');
const { applyCourierRating } = require('../routes-engine');
const { issueDocumentsForOrder, creditDocument } = require('../documents');
const { sendCsv } = require('../csv');
require('../subscriptions');
const { buildDocumentPDF, docVerificationImages } = require('../receipt');
const { uuidParams } = require('../validate');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);
r.use(require('../ratelimit').writeLimiter('tenant-write', 90));

const FLOW = ['new','confirmed','picked_up','in_work','ready','out_for_delivery','delivered'];

// תור הזמנות חי
r.get('/orders', async (req, res) => {
  const { status } = req.query;
  const params = [req.tenant.id];
  let where = 'WHERE o.tenant_id=$1';
  if (status) { params.push(status); where += ` AND o.status=$${params.length}`; }
  const { rows } = await q(
    `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone,
       EXISTS(SELECT 1 FROM courier_offers co WHERE co.order_id=o.id AND co.status='offered') AS has_open_offer,
       (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty,'price',oi.price)) FROM order_items oi WHERE oi.order_id=o.id) AS items,
       (SELECT json_build_object('method',dc.method,'at',dc.created_at,'id',dc.id,'has_photo',(dc.photo_data IS NOT NULL)) FROM delivery_confirmations dc WHERE dc.order_id=o.id) AS delivery_confirmation
     FROM orders o JOIN users u ON u.id=o.customer_id ${where} ORDER BY o.created_at DESC LIMIT 200`, params);
  res.json({ orders: rows });
});

// עדכון סטטוס הזמנה (כולל שיבוץ איסוף נקודות בעת השלמה)
r.post('/orders/:id/status', uuidParams('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, note } = req.body || {};
    if (!FLOW.includes(status) && status !== 'cancelled') return res.status(400).json({ error: 'סטטוס לא חוקי' });
    // QA-flow: BEGIN לפני הנעילה — בעבר ה-FOR UPDATE רץ ב-autocommit והשתחרר מיד
    await client.query('BEGIN');
    const { rows: o } = await client.query('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.tenant.id]);
    const order = o[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'הזמנה לא נמצאה' }); }
    // QA-flow: בוטלה היא סופית; ביטול אסור אחרי מסירה
    if (order.status === 'cancelled') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'ההזמנה כבר בוטלה' }); }
    if (status === 'cancelled' && order.status === 'delivered') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'לא ניתן לבטל הזמנה שסומנה כנמסרה' }); }
    const cur = FLOW.indexOf(order.status), nxt = FLOW.indexOf(status);
    if (status !== 'cancelled' && nxt !== cur + 1) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'מעבר סטטוס חייב להיות לשלב הבא ברצף' }); }
    if (['picked_up','out_for_delivery','delivered'].includes(status) && !order.courier_id) {
      await client.query('ROLLBACK'); return res.status(409).json({ error: 'יש לשבץ שליח להזמנה לפני מעבר לסטטוס זה' });
    }
    await client.query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', [status, order.id]);
    await client.query('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,$2,$3,$4)',
      [order.id, status, req.user.id, note || null]);
    if (status === 'cancelled') {
      // T11 (המשך): החזרות דרך שירות הביטול המשותף — אותה לוגיקה בכל הנתיבים
      await require('../lib/cancel-service').applyCancelRefunds(client, order);
    }
    if (status === 'delivered' && order.points_earned > 0) {
      await client.query('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
        [order.tenant_id, order.customer_id, order.points_earned, 'צבירת נקודות מהזמנה', order.id]);
      if (order.payment_method === 'cash') {
        await client.query(`UPDATE orders SET payment_status='paid_cash' WHERE id=$1`, [order.id]);
        order.payment_status = 'paid_cash';
      }
    }
    if (status === 'delivered') {
      const full = { ...req.tenant };
      const { rows: tt } = await client.query('SELECT dealer_type, dealer_id FROM tenants WHERE id=$1', [req.tenant.id]);
      Object.assign(full, tt[0] || {});
      const { rows: ord } = await client.query('SELECT * FROM orders WHERE id=$1', [order.id]);
      await issueDocumentsForOrder(client, { tenant: full, order: ord[0], actorId: req.user.id });
    }
    await client.query('COMMIT');
    if (status === 'confirmed') require('../autodispatch').dispatchOrder(order.tenant_id, order.id, 'status-confirmed').catch(() => {}); // T81: הצעת שיבוץ אוטומטית כשההזמנה מוכנה לאיסוף (דמו)
    const { rows: cust } = await q('SELECT id, phone FROM users WHERE id=$1', [order.customer_id]);
    if (cust[0]) {
      const HE = { confirmed:'אושרה', picked_up:'נאספה מהבית', in_work:'בעבודה', ready:'מוכנה', out_for_delivery:'בדרך אליך', delivered:'הוחזרה. תודה!', cancelled:'בוטלה' };
      notifyUser(cust[0].id, order.tenant_id, `הזמנתך ב${req.tenant.name} (#${order.id.slice(0,8)}) ${HE[status] || status}.`, cust[0].phone, `הזמנה ${order.tracking_code || order.id.slice(0,8)}: ${HE[status] || status}`).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// מחירון
r.get('/items', async (req, res) => {
  const { rows } = await q('SELECT * FROM price_items WHERE tenant_id=$1 ORDER BY sort, category, name', [req.tenant.id]);
  res.json({ items: rows });
});
r.post('/items', async (req, res) => {
  const { name, price, category, unit, subscription_eligible } = req.body || {};
  if (!name || !(Number(price) >= 0)) return res.status(400).json({ error: 'שם ומחיר חובה' });
  const { rows } = await q(
    'INSERT INTO price_items(tenant_id, name, price, category, unit, subscription_eligible) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.tenant.id, name, price, category || 'כביסה', ['kg','bag'].includes(unit) ? unit : 'item', !!subscription_eligible]);
  res.status(201).json({ item: rows[0] });
});
r.patch('/items/:id', uuidParams('id'), async (req, res) => {
  const { name, price, category, active, subscription_eligible, unit } = req.body || {};
  const { rows } = await q(
    `UPDATE price_items SET name=COALESCE($1,name), price=COALESCE($2,price),
       category=COALESCE($3,category), active=COALESCE($4,active),
       subscription_eligible=COALESCE($5,subscription_eligible), unit=COALESCE($6,unit)
     WHERE id=$7 AND tenant_id=$8 RETURNING *`,
    [name ?? null, price ?? null, category ?? null, active ?? null,
     subscription_eligible === undefined ? null : !!subscription_eligible,
     ['kg','bag','item'].includes(unit) ? unit : null, req.params.id, req.tenant.id]);
  if (!rows[0]) return res.status(404).json({ error: 'לא נמצא' });
  res.json({ item: rows[0] });
});
r.delete('/items/:id', uuidParams('id'), async (req, res) => {
  await q('UPDATE price_items SET active=false WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
  res.json({ ok: true });
});

// חלונות איסוף/החזרה
r.get('/windows', async (req, res) => {
  const { rows } = await q('SELECT * FROM pickup_windows WHERE tenant_id=$1 ORDER BY weekday, start_time', [req.tenant.id]);
  res.json({ windows: rows });
});
r.post('/windows', async (req, res) => {
  const { weekday, start_time, end_time, capacity, kind } = req.body || {};
  if (weekday === undefined || !start_time || !end_time) return res.status(400).json({ error: 'יום ושעות חובה' });
  const { rows } = await q(
    'INSERT INTO pickup_windows(tenant_id, weekday, start_time, end_time, capacity, kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.tenant.id, weekday, start_time, end_time, capacity || 10, kind === 'delivery' ? 'delivery' : 'pickup']);
  res.status(201).json({ window: rows[0] });
});
r.delete('/windows/:id', uuidParams('id'), async (req, res) => {
  await q('DELETE FROM pickup_windows WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
  res.json({ ok: true });
});

// הגדרות מכבסה (קריאה — חבר מכבסה בלבד, כולל פרטי עוסק)
r.get('/settings', async (req, res) => {
  const { rows } = await q('SELECT * FROM tenants WHERE id=$1', [req.tenant.id]);
  res.json({ tenant: rows[0] });
});

// הגדרות מכבסה
r.patch('/settings', async (req, res) => {
  // E12.T3: פרטי עוסק — סוג עוסק + ח.פ/ע.מ (9 ספרות) עם ולידציה
  if (req.body.dealer_type !== undefined) {
    if (req.body.dealer_type !== null && !['morasha', 'patur'].includes(req.body.dealer_type)) {
      return res.status(400).json({ error: 'סוג עוסק לא תקין (morasha/patur)' });
    }
    if (req.body.dealer_type === 'morasha') {
      const did = String(req.body.dealer_id !== undefined ? req.body.dealer_id : (req.tenant.dealer_id || ''));
      if (!/^\d{9}$/.test(did)) return res.status(400).json({ error: 'עוסק מורשה חייב ח.פ/ע.מ תקין (9 ספרות)' });
    }
  }
  if (req.body.dealer_id !== undefined && req.body.dealer_id !== null && req.body.dealer_id !== '' && !/^\d{9}$/.test(String(req.body.dealer_id))) {
    return res.status(400).json({ error: 'ח.פ/ע.מ חייב להיות 9 ספרות' });
  }
  if (req.body.invoice_mode !== undefined && !['per_order', 'consolidated'].includes(req.body.invoice_mode)) {
    return res.status(400).json({ error: 'אופן הפקת מסמכים לא תקין (per_order/consolidated)' });
  }
  // אבטחה (XSS): ולידציית שדות טקסט/שעות/צבע לפני שמירה — המקור לתוכן מוצג ב-UI
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const cleanText = (v, max) => {
    if (typeof v !== 'string') return null;
    const t = v.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (t.length > max) return null;
    return t;
  };
  for (const [k, max] of [['name', 80], ['address', 120], ['city', 60], ['slogan', 160]]) {
    if (req.body[k] !== undefined && req.body[k] !== null) {
      const t = cleanText(req.body[k], max);
      if (t === null || (k === 'name' && !t)) return res.status(400).json({ error: `ערך לא תקין בשדה ${k}` });
      if (/[<>]/.test(t)) return res.status(400).json({ error: `שדה ${k} אינו יכול להכיל < או >` });
      req.body[k] = t;
    }
  }
  if (req.body.terms !== undefined && req.body.terms !== null) {
    const t = cleanText(req.body.terms, 2000);
    if (t === null) return res.status(400).json({ error: 'תקנון ארוך מדי' });
    if (/[<>]/.test(t)) return res.status(400).json({ error: 'התקנון אינו יכול להכיל < או >' });
    req.body.terms = t;
  }
  for (const k of ['phone', 'whatsapp']) {
    if (req.body[k] !== undefined && req.body[k] !== null && req.body[k] !== '') {
      if (!/^\+?[0-9][0-9\- ]{4,18}$/.test(String(req.body[k]))) return res.status(400).json({ error: `מספר לא תקין בשדה ${k}` });
      req.body[k] = String(req.body[k]).trim();
    }
  }
  if (req.body.color !== undefined && req.body.color !== null && req.body.color !== '') {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(req.body.color))) return res.status(400).json({ error: 'צבע חייב להיות hex בפורמט #RRGGBB' });
  }
  if (req.body.services !== undefined && req.body.services !== null) {
    if (!Array.isArray(req.body.services) || req.body.services.length > 10 ||
        req.body.services.some(x => typeof x !== 'string' || x.length > 30 || /[<>]/.test(x))) {
      return res.status(400).json({ error: 'רשימת שירותים לא תקינה' });
    }
  }
  if (req.body.hours !== undefined && req.body.hours !== null) {
    const h = req.body.hours;
    if (typeof h !== 'object' || Array.isArray(h)) return res.status(400).json({ error: 'מבנה שעות פעילות לא תקין' });
    for (const [day, ranges] of Object.entries(h)) {
      if (!/^[0-6]$/.test(day)) return res.status(400).json({ error: 'יום לא תקין בשעות הפעילות' });
      if (!Array.isArray(ranges) || ranges.length > 4) return res.status(400).json({ error: 'מבנה שעות פעילות לא תקין' });
      for (const r of ranges) {
        if (!Array.isArray(r) || r.length !== 2 || !HHMM.test(String(r[0])) || !HHMM.test(String(r[1]))) {
          return res.status(400).json({ error: 'שעות חייבות להיות בפורמט HH:MM' });
        }
      }
    }
    req.body.hours = JSON.stringify(h);
  }
  const allowed = ['name','phone','address','city','services','hours','terms','delivery_fee','min_order','is_open','lat','lng','dealer_type','dealer_id','invoice_mode','slogan','whatsapp','color'];
  const sets = [], params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${k}=$${params.length}`); }
  }
  if (!sets.length) return res.status(400).json({ error: 'אין שדות לעדכון' });
  params.push(req.tenant.id);
  const { rows } = await q(`UPDATE tenants SET ${sets.join(',')} WHERE id=$${params.length} RETURNING *`, params);
  delete rows[0].api_key;
  res.json({ tenant: rows[0] });
});

// E2.T4: ניהול תוכניות מנוי
r.get('/plans', async (req, res) => {
  const { rows } = await q(
    `SELECT p.*, (SELECT count(*)::int FROM subscriptions s WHERE s.plan_id=p.id AND s.status='active') AS active_subs
     FROM subscription_plans p WHERE p.tenant_id=$1 ORDER BY p.sort, p.price`, [req.tenant.id]);
  res.json({ plans: rows });
});
r.post('/plans', async (req, res) => {
  const { name, bags_per_month, kg_per_bag, price, extra_bag_price, perks } = req.body || {};
  if (!name || !(Number(bags_per_month) > 0) || !(Number(price) >= 0)) {
    return res.status(400).json({ error: 'שם, מספר שקים ומחיר חובה' });
  }
  const { rows } = await q(
    `INSERT INTO subscription_plans(tenant_id, name, bags_per_month, kg_per_bag, price, extra_bag_price, perks)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.tenant.id, name, Number(bags_per_month), Number(kg_per_bag) || 8, Number(price),
     extra_bag_price === undefined || extra_bag_price === '' ? null : Number(extra_bag_price), perks || null]);
  res.status(201).json({ plan: rows[0] });
});
r.patch('/plans/:id', uuidParams('id'), async (req, res) => {
  const { name, bags_per_month, kg_per_bag, price, extra_bag_price, perks, active } = req.body || {};
  const { rows } = await q(
    `UPDATE subscription_plans SET name=COALESCE($1,name), bags_per_month=COALESCE($2,bags_per_month),
       kg_per_bag=COALESCE($3,kg_per_bag), price=COALESCE($4,price), perks=COALESCE($5,perks),
       active=COALESCE($6,active),
       extra_bag_price=CASE WHEN $7 THEN $8 ELSE extra_bag_price END
     WHERE id=$9 AND tenant_id=$10 RETURNING *`,
    [name ?? null, bags_per_month ?? null, kg_per_bag ?? null, price ?? null, perks ?? null,
     active === undefined ? null : !!active,
     extra_bag_price !== undefined,
     extra_bag_price === undefined || extra_bag_price === '' || extra_bag_price === null ? null : Number(extra_bag_price),
     req.params.id, req.tenant.id]);
  if (!rows[0]) return res.status(404).json({ error: 'תוכנית לא נמצאה' });
  res.json({ plan: rows[0] });
});

// E2.T4: מנויים פעילים/מושהים + ניצול חודשי
r.get('/subscriptions', async (req, res) => {
  const { rows } = await q(
    `SELECT s.id, s.status, s.period_start, s.period_end, s.bags_used, s.created_at,
            p.name AS plan_name, p.bags_per_month, p.price AS plan_price,
            u.name AS customer_name, u.phone AS customer_phone
     FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id JOIN users u ON u.id=s.user_id
     WHERE s.tenant_id=$1 AND s.status <> 'cancelled' ORDER BY s.created_at DESC LIMIT 200`, [req.tenant.id]);
  res.json({ subscriptions: rows });
});

// E3.T1: העלאת לוגו מכבסה
r.post('/logo', logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'חסר קובץ לוגו' });
  if (!verifyFile(req.file, IMAGES)) return res.status(400).json({ error: 'תוכן הקובץ אינו תמונה תקינה (PNG/JPG/WebP)' });
  await q('UPDATE tenants SET logo=$1, logo_mime=$2 WHERE id=$3', [req.file.buffer, req.file.mimetype, req.tenant.id]);
  res.json({ ok: true });
});
r.delete('/logo', async (req, res) => {
  await q('UPDATE tenants SET logo=NULL, logo_mime=NULL WHERE id=$1', [req.tenant.id]);
  res.json({ ok: true });
});

// דוחות בסיסיים
r.get('/stats', async (req, res) => {
  const tid = req.tenant.id;
  const [byStatus, revenue, customers, top] = await Promise.all([
    q(`SELECT status, count(*)::int AS n FROM orders WHERE tenant_id=$1 GROUP BY status`, [tid]),
    q(`SELECT COALESCE(sum(total),0)::numeric(10,2) AS total, count(*)::int AS orders,
       COALESCE(sum(total) FILTER (WHERE created_at > now() - interval '30 days'),0)::numeric(10,2) AS last30
       FROM orders WHERE tenant_id=$1 AND status <> 'cancelled'`, [tid]),
    q(`SELECT count(DISTINCT customer_id)::int AS customers,
       count(DISTINCT customer_id) FILTER (WHERE cnt.c > 1)::int AS returning
       FROM (SELECT customer_id, count(*) AS c FROM orders WHERE tenant_id=$1 AND status <> 'cancelled' GROUP BY 1) cnt`, [tid]),
    q(`SELECT oi.name, sum(oi.qty)::numeric(8,1) AS qty, sum(oi.qty*oi.price)::numeric(10,2) AS revenue
       FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE o.tenant_id=$1 AND o.status <> 'cancelled' GROUP BY 1 ORDER BY revenue DESC LIMIT 5`, [tid]),
  ]);
  const { rows: subs } = await q(
    `SELECT count(*) FILTER (WHERE s.status='active')::int AS active,
            COALESCE(sum(p.price) FILTER (WHERE s.status='active'),0)::numeric(10,2) AS mrr,
            COALESCE(sum(s.bags_used) FILTER (WHERE s.status='active'),0)::numeric(8,1) AS bags_used
     FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.tenant_id=$1`, [tid]);
  // E3.T4: פילוח ערוצים — לקוח שלה (נרשם בדף הממותג / הזמין ממנו) מול לקוח מרקטפלייס + עמלה משוערת
  const { rows: rates } = await q(`SELECT key, value FROM platform_settings WHERE key IN ('branded_commission_pct','marketplace_commission_pct')`);
  const rate = Object.fromEntries(rates.map(x => [x.key, Number(x.value)]));
  const ownPct = rate.branded_commission_pct || 5, mktPct = rate.marketplace_commission_pct || 12;
  const { rows: ch } = await q(
    `SELECT CASE WHEN o.source='branded' OR u.signup_tenant_id=o.tenant_id THEN 'own' ELSE 'marketplace' END AS channel,
            count(*)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS revenue
     FROM orders o JOIN users u ON u.id=o.customer_id
     WHERE o.tenant_id=$1 AND o.status <> 'cancelled' GROUP BY 1`, [tid]);
  const chMap = Object.fromEntries(ch.map(x => [x.channel, x]));
  const own = chMap.own || { orders: 0, revenue: 0 }, mkt = chMap.marketplace || { orders: 0, revenue: 0 };
  const channels = {
    own: { orders: own.orders, revenue: Number(own.revenue), commission_pct: ownPct, commission_est: Math.round(Number(own.revenue) * ownPct) / 100 },
    marketplace: { orders: mkt.orders, revenue: Number(mkt.revenue), commission_pct: mktPct, commission_est: Math.round(Number(mkt.revenue) * mktPct) / 100 },
  };
  res.json({ byStatus: byStatus.rows, revenue: revenue.rows[0], customers: customers.rows[0], topItems: top.rows, subscriptions: subs[0], channels });
});

// לקוחות המכבסה
r.get('/customers', async (req, res) => {
  const { rows } = await q(
    `SELECT u.id, u.name, u.phone, count(o.id)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS spent,
       max(o.created_at) AS last_order,
       (SELECT COALESCE(sum(p.delta),0)::int FROM points_ledger p WHERE p.tenant_id=$1 AND p.user_id=u.id) AS points
     FROM orders o JOIN users u ON u.id=o.customer_id
     WHERE o.tenant_id=$1 GROUP BY u.id, u.name, u.phone ORDER BY last_order DESC LIMIT 200`, [req.tenant.id]);
  res.json({ customers: rows });
});

// שליחים של המכבסה + שיבוץ ידני
r.get('/couriers', async (req, res) => {
  const { rows } = await q(
    `SELECT c.id, c.model, c.vehicle, c.areas, c.rating, u.name, u.phone,
       (SELECT count(*)::int FROM orders o WHERE o.courier_id=c.id AND o.status IN ('confirmed','picked_up','ready','out_for_delivery')) AS active_orders
     FROM couriers c JOIN users u ON u.id=c.user_id
     WHERE (c.tenant_id=$1 OR c.model IN ('platform','shared')) AND c.approved ORDER BY c.model`, [req.tenant.id]);
  res.json({ couriers: rows });
});

// E5.T5: מסך ניהול שליחים — שיבוץ להיום, עלות משוערת, ביצועי 30 יום, היסטוריית תשלומים
r.get('/couriers/overview', async (req, res) => {
  const tid = req.tenant.id;
  const [couriers, today, payments, rateR, pctR] = await Promise.all([
    q(`SELECT c.id, c.model, c.vehicle, c.areas, c.rating, c.rating_count, u.name, u.phone,
        (SELECT count(*)::int FROM orders o WHERE o.courier_id=c.id AND o.status IN ('confirmed','picked_up','ready','out_for_delivery')) AS active_orders,
        (SELECT count(*)::int FROM orders o WHERE o.courier_id=c.id AND o.tenant_id=$1 AND o.status='delivered' AND o.updated_at > now() - interval '30 days') AS delivered_30d,
        (SELECT count(*)::int FROM order_events e JOIN orders o ON o.id=e.order_id
          WHERE o.courier_id=c.id AND o.tenant_id=$1 AND e.status='picked_up' AND o.pickup_at IS NOT NULL
            AND e.created_at > now() - interval '30 days' AND e.created_at <= o.pickup_at + interval '30 minutes') AS ontime_30d,
        (SELECT count(*)::int FROM order_events e JOIN orders o ON o.id=e.order_id
          WHERE o.courier_id=c.id AND o.tenant_id=$1 AND e.status='picked_up' AND o.pickup_at IS NOT NULL
            AND e.created_at > now() - interval '30 days') AS pickups_30d
       FROM couriers c JOIN users u ON u.id=c.user_id
       WHERE (c.tenant_id=$1 OR c.model IN ('platform','shared')) AND c.approved ORDER BY c.model`, [tid]),
    q(`SELECT o.id, o.status, o.address, o.pickup_at, o.delivery_at, o.total, u.name AS customer_name,
              cu.id AS courier_id, uu.name AS courier_name
       FROM orders o JOIN users u ON u.id=o.customer_id
       JOIN couriers cu ON cu.id=o.courier_id JOIN users uu ON uu.id=cu.user_id
       WHERE o.tenant_id=$1 AND o.status NOT IN ('delivered','cancelled')
       ORDER BY COALESCE(o.pickup_at, o.created_at)`, [tid]),
    q(`SELECT e.week_start, sum(e.stops)::int AS stops, sum(e.gross)::numeric(9,2) AS gross,
              sum(e.commission)::numeric(9,2) AS commission,
              string_agg(DISTINCT e.status, ',') AS statuses
       FROM courier_earnings e WHERE e.tenant_id=$1
       GROUP BY e.week_start ORDER BY e.week_start DESC LIMIT 8`, [tid]),
    q(`SELECT value FROM platform_settings WHERE key='courier_rate_per_stop'`, []),
    q(`SELECT value FROM platform_settings WHERE key='courier_commission_pct'`, []),
  ]);
  const rate = Number(rateR.rows[0] ? rateR.rows[0].value : 12);
  const pct = Number(pctR.rows[0] ? pctR.rows[0].value : 20);
  const { rows: clusters } = await q(
    `SELECT cl.id, cl.name, cl.area, cl.mgmt_fee_monthly,
            (SELECT count(*)::int FROM courier_cluster_members cm WHERE cm.cluster_id=cl.id) AS members,
            EXISTS(SELECT 1 FROM courier_cluster_members cm WHERE cm.cluster_id=cl.id AND cm.tenant_id=$1) AS joined,
            (SELECT json_agg(json_build_object('weekday',fr.weekday,'courier',u.name))
             FROM cluster_fixed_routes fr JOIN couriers c ON c.id=fr.courier_id JOIN users u ON u.id=c.user_id
             WHERE fr.cluster_id=cl.id AND fr.active) AS fixed_routes
     FROM courier_clusters cl WHERE cl.active ORDER BY cl.created_at`, [tid]);
  res.json({
    couriers: couriers.rows, today: today.rows, payments: payments.rows, clusters,
    estimate: { rate_per_stop: rate, stops_per_order: 2, per_order: rate * 2, platform_commission_pct: pct },
  });
});
// E5.T7: מכבסה מדרגת שליח (איסוף בזמן, מסירה)
r.post('/couriers/:cid/rate', uuidParams('cid'), async (req, res) => {
  const rt = Number((req.body || {}).rating);
  if (!(rt >= 1 && rt <= 5)) return res.status(400).json({ error: 'דירוג 1-5' });
  const tags = Array.isArray((req.body || {}).tags) ? req.body.tags.map(String).slice(0, 5) : null;
  // הרשאות: דירוג חייב הזמנה קונקרטית ששובצה לשליח זה במכבסה זו — בלי דירוג חופשי שמזיז priority
  const orderId = (req.body || {}).order_id || null;
  if (!orderId || !/^[0-9a-fA-F-]{36}$/.test(String(orderId))) return res.status(400).json({ error: 'נדרש order_id של הזמנה ששובצה לשליח' });
  const { rows: o } = await q('SELECT id, courier_id, status FROM orders WHERE id=$1 AND tenant_id=$2', [orderId, req.tenant.id]);
  if (!o[0]) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  if (o[0].courier_id !== req.params.cid) return res.status(400).json({ error: 'ההזמנה לא שובצה לשליח זה' });
  const { rows: dup } = await q('SELECT 1 FROM reviews WHERE order_id=$1 AND target_courier_id=$2 AND user_id=$3', [orderId, req.params.cid, req.user.id]);
  if (dup[0]) return res.status(409).json({ error: 'כבר דירגת את השליח על הזמנה זו' });
  await q('INSERT INTO reviews(tenant_id, order_id, user_id, target_courier_id, rating, tags) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.tenant.id, orderId, req.user.id, req.params.cid, rt, tags]);
  await applyCourierRating(req.params.cid, rt);
  res.json({ ok: true });
});

// E5.T6: קלאסטרים זמינים + חברות המכבסה
r.get('/clusters', async (req, res) => {
  const { rows } = await q(
    `SELECT cl.id, cl.name, cl.area, cl.mgmt_fee_monthly,
            (SELECT count(*)::int FROM courier_cluster_members cm WHERE cm.cluster_id=cl.id) AS members,
            EXISTS(SELECT 1 FROM courier_cluster_members cm WHERE cm.cluster_id=cl.id AND cm.tenant_id=$1) AS joined,
            (SELECT json_agg(json_build_object('weekday',fr.weekday,'courier',u.name))
             FROM cluster_fixed_routes fr JOIN couriers c ON c.id=fr.courier_id JOIN users u ON u.id=c.user_id
             WHERE fr.cluster_id=cl.id AND fr.active) AS fixed_routes
     FROM courier_clusters cl WHERE cl.active ORDER BY cl.created_at`, [req.tenant.id]);
  res.json({ clusters: rows });
});

r.post('/clusters/:id/join', uuidParams('id'), async (req, res) => {
  const { rows: cl } = await q('SELECT id, name FROM courier_clusters WHERE id=$1 AND active', [req.params.id]);
  if (!cl[0]) return res.status(404).json({ error: 'קלאסטר לא נמצא' });
  const { rows: n } = await q('SELECT count(*)::int AS n FROM courier_cluster_members WHERE cluster_id=$1', [cl[0].id]);
  if (n[0].n >= 5) return res.status(409).json({ error: 'הקלאסטר מלא (עד 5 מכבסות)' });
  await q('INSERT INTO courier_cluster_members(cluster_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [cl[0].id, req.tenant.id]);
  res.json({ ok: true });
});

r.post('/clusters/:id/leave', uuidParams('id'), async (req, res) => {
  await q('DELETE FROM courier_cluster_members WHERE cluster_id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
  res.json({ ok: true });
});

r.post('/orders/:id/assign', uuidParams('id'), async (req, res) => {
  const { courier_id } = req.body || {};
  const { rows: c } = await q(
    `SELECT c.*, u.id AS uid, u.phone FROM couriers c JOIN users u ON u.id=c.user_id
     WHERE c.id=$1 AND c.approved AND (c.tenant_id=$2 OR c.model IN ('platform','shared'))`, [courier_id, req.tenant.id]);
  if (!c[0]) return res.status(404).json({ error: 'שליח לא נמצא או לא מאושר' });
  const { rows: o } = await q('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
  if (!o[0]) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  if (['delivered','cancelled'].includes(o[0].status)) return res.status(409).json({ error: 'לא ניתן לשבץ שליח להזמנה מבוטלת או שנמסרה' }); // QA-flow
  if (o[0].courier_id) return res.status(409).json({ error: 'להזמנה כבר שובץ שליח' });
  const { rows: openOff } = await q(`SELECT id FROM courier_offers WHERE order_id=$1 AND status='offered'`, [o[0].id]);
  if (openOff.length) return res.status(409).json({ error: 'כבר קיימת הצעת שיבוץ פתוחה להזמנה זו' });
  // שליח פרטי: שיבוץ מיידי. שליח משותף/פלטפורמה: הצעה לאישור
  if (c[0].model === 'private') {
    await q('UPDATE orders SET courier_id=$1, updated_at=now() WHERE id=$2', [courier_id, o[0].id]);
    await q('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,$2,$3,$4)',
      [o[0].id, o[0].status, req.user.id, 'שובץ שליח מכבסה']);
    require('../ordernotices').notifyCourierNewTask({ id: c[0].uid, phone: c[0].phone }, req.tenant, o[0], 'assign').catch(() => {}); // N6: תבנית courier_new_task
    return res.json({ ok: true, mode: 'assigned' });
  }
  const { rows: off } = await q(
    `INSERT INTO courier_offers(courier_id, order_id, kind) VALUES ($1,$2,'pickup') RETURNING *`, [courier_id, o[0].id]);
  require('../ordernotices').notifyCourierNewTask({ id: c[0].uid, phone: c[0].phone }, req.tenant, o[0], 'offer').catch(() => {}); // N6: תבנית courier_new_task
  res.json({ ok: true, mode: 'offered', offer: off[0] });
});


// ניהול קופונים (מכבסה)
r.get('/coupons', async (req, res) => {
  const { rows } = await q(
    `SELECT c.*, (SELECT count(*)::int FROM orders o WHERE o.coupon_id=c.id) AS redemptions
     FROM coupons c WHERE c.tenant_id=$1 ORDER BY c.id DESC`, [req.tenant.id]);
  res.json({ coupons: rows });
});

r.post('/coupons', async (req, res) => {
  const { code, kind, value, expires_at, min_order, usage_limit, per_user_limit, reason } = req.body || {};
  const c = String(code || '').trim();
  if (!c || c.length > 40) return res.status(400).json({ error: 'קוד קופון חסר או ארוך מדי' });
  if (!['percent', 'amount'].includes(kind)) return res.status(400).json({ error: 'סוג קופון לא תקין' });
  const v = Number(value);
  if (!(v > 0) || (kind === 'percent' && v > 100)) return res.status(400).json({ error: 'ערך קופון לא תקין' });
  try {
    const { rows } = await q(
      `INSERT INTO coupons(tenant_id, code, kind, value, expires_at, min_order, usage_limit, per_user_limit, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.tenant.id, c.toUpperCase(), kind, v, expires_at || null, Number(min_order) || 0,
       usage_limit ? Math.max(1, parseInt(usage_limit)) : null,
       per_user_limit ? Math.max(1, parseInt(per_user_limit)) : null,
       String(reason || 'campaign').slice(0, 60)]);
    res.status(201).json({ coupon: rows[0] });
  } catch (e) {
    if (String(e.message).includes('duplicate')) return res.status(409).json({ error: 'הקוד כבר קיים במכבסה' });
    throw e;
  }
});

r.patch('/coupons/:id', uuidParams('id'), async (req, res) => {
  const { active, expires_at, min_order, usage_limit, per_user_limit } = req.body || {};
  const { rows } = await q(
    `UPDATE coupons SET
       active = COALESCE($3, active),
       expires_at = COALESCE($4, expires_at),
       min_order = COALESCE($5, min_order),
       usage_limit = COALESCE($6, usage_limit),
       per_user_limit = COALESCE($7, per_user_limit)
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [req.params.id, req.tenant.id,
     typeof active === 'boolean' ? active : null,
     expires_at || null,
     min_order !== undefined ? Number(min_order) : null,
     usage_limit !== undefined ? (usage_limit === null ? null : Math.max(1, parseInt(usage_limit))) : null,
     per_user_limit !== undefined ? (per_user_limit === null ? null : Math.max(1, parseInt(per_user_limit))) : null]);
  if (!rows[0]) return res.status(404).json({ error: 'קופון לא נמצא' });
  res.json({ coupon: rows[0] });
});


// מסמכים חשבונאיים של המכבסה (E12)
r.get('/documents', async (req, res) => {
  const { rows } = await q(
    `SELECT d.id, d.kind, d.title_he, d.doc_number, d.doc_year, d.allocation_number, d.amount, d.vat, d.total,
            d.status, d.credited_amount, d.order_id, d.issued_at, u.name AS customer_name,
            (SELECT count(*)::int FROM document_orders dor WHERE dor.document_id=d.id) AS orders_count
     FROM documents d LEFT JOIN users u ON u.id=d.customer_id
     WHERE d.tenant_id=$1 ORDER BY d.issued_at DESC LIMIT 300`, [req.tenant.id]);
  const KIND_HE = { invoice: 'חשבונית עסקה', receipt: 'קבלה', credit: 'זיכוי', consolidated: 'חשבונית מרכזת' };
  res.json({ documents: rows.map(d => ({ ...d, kind_he: d.title_he || KIND_HE[d.kind] || d.kind })) });
});

r.get('/documents/:id/pdf', uuidParams('id'), async (req, res) => {
  const { rows } = await q(
    `SELECT d.*, t.name AS tenant_name, t.color, t.address AS tenant_address, t.city AS tenant_city,
            t.dealer_type, t.dealer_id, u.name AS customer_name, u.phone AS customer_phone
     FROM documents d JOIN tenants t ON t.id=d.tenant_id LEFT JOIN users u ON u.id=d.customer_id
     WHERE d.id=$1 AND d.tenant_id=$2`, [req.params.id, req.tenant.id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'מסמך לא נמצא' });
  // מקור: הבייטים המקוריים בלבד; מסמך קדם-רצועת-אימות (sha256 חסר) מרונדר מחדש עם QR/ברקוד ("העתק")
  if (req.query.copy !== '1' && d.pdf && d.sha256) {
    res.set('content-type', 'application/pdf');
    res.set('content-disposition', `inline; filename="${d.kind}-${d.doc_year}-${d.doc_number}.pdf"`);
    return res.end(d.pdf);
  }
  const { rows: items } = d.order_id ? await q('SELECT * FROM order_items WHERE order_id=$1', [d.order_id]) : { rows: [] };
  const { rows: covered } = await q(
    `SELECT o.id, o.total, o.created_at FROM document_orders dor JOIN orders o ON o.id=dor.order_id WHERE dor.document_id=$1 ORDER BY o.created_at`, [d.id]);
  const pdfItems = covered.length
    ? covered.map(o => ({ name: `הזמנה #${o.id.slice(0, 8)} · ${new Date(o.created_at).toLocaleDateString('he-IL')}`, qty: 1, price: Number(o.total) }))
    : items;
  const codes = await docVerificationImages(d);
  const effectiveCopy = req.query.copy === '1' || !d.sha256;
  const pdf = buildDocumentPDF({
    doc: d, order: d.order_id ? { id: d.order_id } : null, items: pdfItems, codes,
    tenant: { name: d.tenant_name, address: d.tenant_address, city: d.tenant_city, color: d.color, dealer_type: d.dealer_type, dealer_id: d.dealer_id },
    customer: { name: d.customer_name, phone: d.customer_phone }, copy: effectiveCopy,
    note: covered.length ? `חשבונית מרכזת המכסה ${covered.length} הזמנות` : null,
  });
  res.set('content-type', 'application/pdf');
  pdf.pipe(res);
});

// E12.T5: הנפקת זיכוי מול מסמך מקור (מלא אם amount חסר)
r.post('/documents/:id/credit', uuidParams('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: tt } = await client.query('SELECT * FROM tenants WHERE id=$1', [req.tenant.id]);
    const credit = await creditDocument(client, {
      tenant: tt[0], original: { id: req.params.id },
      amount: req.body && req.body.amount !== undefined ? Number(req.body.amount) : null,
      actorId: req.user.id,
    });
    await client.query('COMMIT');
    res.status(201).json({ credit });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.status) return res.status(e.status).json({ error: e.error });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// E12.T6: הזמנות הזכאיות לחשבונית מרכזת (delivered, ללא מסמך קודם), מקובצות לפי לקוח
r.get('/documents/consolidated/eligible', async (req, res) => {
  const { rows } = await q(
    `SELECT o.id, o.total, o.created_at, u.id AS customer_id, u.name AS customer_name, u.phone AS customer_phone
     FROM orders o JOIN users u ON u.id = o.customer_id
     WHERE o.tenant_id=$1 AND o.status='delivered'
       AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.order_id=o.id AND d.kind<>'credit')
       AND NOT EXISTS (SELECT 1 FROM document_orders dor WHERE dor.order_id=o.id)
     ORDER BY u.name, o.created_at`, [req.tenant.id]);
  const byCustomer = {};
  for (const o of rows) {
    if (!byCustomer[o.customer_id]) byCustomer[o.customer_id] = { customer: { id: o.customer_id, name: o.customer_name, phone: o.customer_phone }, orders: [] };
    byCustomer[o.customer_id].orders.push({ id: o.id, total: Number(o.total), created_at: o.created_at });
  }
  res.json({ customers: Object.values(byCustomer) });
});

// E12.T6: הפקת חשבונית מרכזת מעוצבת (A4) ללקוח על מספר הזמנות
r.post('/documents/consolidated', async (req, res) => {
  const { customer_id, order_ids } = req.body || {};
  if (!customer_id || !Array.isArray(order_ids) || !order_ids.length) {
    return res.status(400).json({ error: 'יש לבחור לקוח והזמנות' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: tt } = await client.query('SELECT * FROM tenants WHERE id=$1', [req.tenant.id]);
    const tenant = tt[0];
    if (!tenant.dealer_type) throw { status: 409, error: 'יש להגדיר סוג עוסק בהגדרות לפני הפקת מסמכים' };
    const { rows: orders } = await client.query(
      `SELECT o.id, o.total, o.created_at FROM orders o
       WHERE o.tenant_id=$1 AND o.customer_id=$2 AND o.id = ANY($3::uuid[]) AND o.status='delivered'
       ORDER BY o.created_at FOR UPDATE`, [req.tenant.id, customer_id, order_ids]);
    if (orders.length !== order_ids.length) throw { status: 400, error: 'חלק מההזמנות לא נמצאו או עדיין לא הושלמו' };
    const { rows: cust } = await client.query('SELECT id, name, phone FROM users WHERE id=$1', [customer_id]);
    const { issueConsolidatedInvoice } = require('../documents');
    const doc = await issueConsolidatedInvoice(client, { tenant, customer: cust[0], orders, actorId: req.user.id });
    await client.query('COMMIT');
    res.status(201).json({ document: { id: doc.id, kind: doc.kind, doc_number: doc.doc_number, doc_year: doc.doc_year, total: Number(doc.total), verify_code: doc.verify_code } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.status) return res.status(e.status).json({ error: e.error });
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});


// E11.T1: דוחות מכבסה — הכנסות, פילוח ערוצים, גרף שבועי, לקוחות חוזרים, פריטים מובילים
r.get('/reports', async (req, res) => {
  const tid = req.tenant.id;
  const [totals, weekly, channels, returning, top, subs] = await Promise.all([
    q(`SELECT COALESCE(sum(total),0)::numeric(10,2) AS revenue, count(*)::int AS orders,
         COALESCE(avg(total),0)::numeric(10,2) AS avg_order,
         COALESCE(sum(total) FILTER (WHERE created_at > now() - interval '30 days'),0)::numeric(10,2) AS last30
       FROM orders WHERE tenant_id=$1 AND status <> 'cancelled'`, [tid]),
    q(`SELECT date_trunc('week', created_at)::date AS week, count(*)::int AS orders,
         COALESCE(sum(total),0)::numeric(10,2) AS revenue
       FROM orders WHERE tenant_id=$1 AND status <> 'cancelled' AND created_at > now() - interval '8 weeks'
       GROUP BY 1 ORDER BY 1`, [tid]),
    q(`SELECT source, count(*)::int AS orders, COALESCE(sum(total),0)::numeric(10,2) AS revenue
       FROM orders WHERE tenant_id=$1 AND status <> 'cancelled' GROUP BY source ORDER BY revenue DESC`, [tid]),
    q(`SELECT count(DISTINCT customer_id)::int AS customers,
         count(DISTINCT customer_id) FILTER (WHERE cnt.c > 1)::int AS returning
       FROM (SELECT customer_id, count(*) AS c FROM orders WHERE tenant_id=$1 AND status <> 'cancelled' GROUP BY 1) cnt`, [tid]),
    q(`SELECT oi.name, sum(oi.qty)::numeric(8,1) AS qty, sum(oi.qty*oi.price)::numeric(10,2) AS revenue
       FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE o.tenant_id=$1 AND o.status <> 'cancelled' GROUP BY 1 ORDER BY revenue DESC LIMIT 8`, [tid]),
    q(`SELECT count(*) FILTER (WHERE s.status='active')::int AS active,
         COALESCE(sum(p.price) FILTER (WHERE s.status='active'),0)::numeric(10,2) AS mrr
       FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.tenant_id=$1`, [tid]),
  ]);
  // E3.T4: פילוח לקוח שלה/מרקטפלייס + עמלה משוערת
  const { rows: rates } = await q(`SELECT key, value FROM platform_settings WHERE key IN ('branded_commission_pct','marketplace_commission_pct')`);
  const rate = Object.fromEntries(rates.map(x => [x.key, Number(x.value)]));
  const ownPct = rate.branded_commission_pct || 5, mktPct = rate.marketplace_commission_pct || 12;
  const { rows: chSplit } = await q(
    `SELECT CASE WHEN o.source='branded' OR u.signup_tenant_id=o.tenant_id THEN 'own' ELSE 'marketplace' END AS channel,
            count(*)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS revenue
     FROM orders o JOIN users u ON u.id=o.customer_id
     WHERE o.tenant_id=$1 AND o.status <> 'cancelled' GROUP BY 1`, [tid]);
  const chMap = Object.fromEntries(chSplit.map(x => [x.channel, x]));
  const own = chMap.own || { orders: 0, revenue: 0 }, mkt = chMap.marketplace || { orders: 0, revenue: 0 };
  const commission = {
    own: { orders: own.orders, revenue: Number(own.revenue), commission_pct: ownPct, commission_est: Math.round(Number(own.revenue) * ownPct) / 100 },
    marketplace: { orders: mkt.orders, revenue: Number(mkt.revenue), commission_pct: mktPct, commission_est: Math.round(Number(mkt.revenue) * mktPct) / 100 },
  };
  res.json({ totals: totals.rows[0], weekly: weekly.rows, channels: channels.rows, customers: returning.rows[0], topItems: top.rows, subscriptions: subs[0], commission });
});

// E11.T2: ייצוא CSV (BOM לעברית ב-Excel) — הזמנות, לקוחות, תשלומי שליחים
r.get('/export/orders.csv', async (req, res) => {
  const { rows } = await q(
    `SELECT o.id, o.created_at, u.name AS customer, u.phone, o.status, o.source,
            o.subtotal, o.delivery_fee, o.discount, o.total, o.payment_method, o.payment_status
     FROM orders o JOIN users u ON u.id=o.customer_id
     WHERE o.tenant_id=$1 ORDER BY o.created_at DESC LIMIT 1000`, [req.tenant.id]);
  const HE = { new:'התקבלה',confirmed:'אושרה',picked_up:'נאספה',in_work:'בעבודה',ready:'מוכנה',out_for_delivery:'בדרך',delivered:'הוחזרה',cancelled:'בוטלה' };
  sendCsv(res, 'orders.csv', [
    ['מספר הזמנה','תאריך','לקוח','טלפון','סטטוס','ערוץ','סכום ביניים','שליחות','הנחה','סה"כ','אמצעי תשלום','סטטוס תשלום'],
    ...rows.map(o => [o.id.slice(0,8), new Date(o.created_at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}), o.customer||'', o.phone||'', HE[o.status]||o.status, o.source==='bot'?'בוט':'אפליקציה', o.subtotal, o.delivery_fee, o.discount, o.total, o.payment_method==='cash'?'מזומן':'מקוון (דמו)', o.payment_status]),
  ]);
});
r.get('/export/customers.csv', async (req, res) => {
  const { rows } = await q(
    `SELECT u.name, u.phone, count(o.id)::int AS orders, COALESCE(sum(o.total),0)::numeric(10,2) AS spent, max(o.created_at) AS last_order
     FROM orders o JOIN users u ON u.id=o.customer_id
     WHERE o.tenant_id=$1 GROUP BY u.id, u.name, u.phone ORDER BY last_order DESC LIMIT 1000`, [req.tenant.id]);
  sendCsv(res, 'customers.csv', [
    ['לקוח','טלפון','הזמנות','סה"כ ₪','הזמנה אחרונה'],
    ...rows.map(c => [c.name||'', c.phone||'', c.orders, c.spent, c.last_order ? new Date(c.last_order).toLocaleDateString('he-IL',{timeZone:'Asia/Jerusalem'}) : '']),
  ]);
});
r.get('/export/courier-payments.csv', async (req, res) => {
  const { rows } = await q(
    `SELECT u.name, u.phone, c.model,
            count(o.id) FILTER (WHERE o.status='delivered')::int AS delivered,
            COALESCE(sum(o.total) FILTER (WHERE o.status='delivered'),0)::numeric(10,2) AS value
     FROM couriers c JOIN users u ON u.id=c.user_id
     LEFT JOIN orders o ON o.courier_id=c.id AND o.tenant_id=$1
     WHERE (c.tenant_id=$1 OR c.model='platform' OR c.model='shared')
     GROUP BY u.name, u.phone, c.model ORDER BY delivered DESC`, [req.tenant.id]);
  sendCsv(res, 'courier-payments.csv', [
    ['שליח','טלפון','מודל','משלוחים שבוצעו','שווי הזמנות ₪'],
    ...rows.map(c => [c.name||'', c.phone||'', c.model==='platform'?'פלטפורמה':c.model==='shared'?'משותף':'פרטי', c.delivered, c.value]),
  ]);
});

module.exports = r;
