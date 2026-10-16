const express = require('express');
const { q, pool } = require('../db');
const { requireAuth } = require('../auth');
const { notifyUser } = require('../notify');
const { applyCourierRating } = require('../routes-engine');
const { buildReceiptPDF } = require('../receipt');
const { validateCoupon, findCoupon } = require('../coupons');
const { ensureCurrentPeriod, applySubscriptionToOrder, restoreBags } = require('../subscriptions');
const { uuidParams } = require('../validate');

const r = express.Router();
r.use(requireAuth);
r.use(require('../ratelimit').writeLimiter('orders-write', 30));

const STATUS_HE = { new:'התקבלה', confirmed:'אושרה', picked_up:'נאספה', in_work:'בעבודה', ready:'מוכנה', out_for_delivery:'בדרך אליך', delivered:'הוחזרה', cancelled:'בוטלה' };

async function event(orderId, status, actorId, note) {
  await q('INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,$2,$3,$4)', [orderId, status, actorId, note || null]);
}

// יצירת הזמנה (לקוח)
r.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { slug, items, address, lat, lng, pickup_at, delivery_at, payment_method, redeem_points, coupon_code, notes, use_subscription, source } = req.body || {};
    // C4: צ'ק-אאוט ראשון מחייב הסכמה לתנאים ולמדיניות — מתועדת פעם אחת ב-consent_at
    if (!req.user.consent_at) {
      if (req.body.consent_terms === true) {
        await q('UPDATE users SET consent_at=now() WHERE id=$1', [req.user.id]);
        req.user.consent_at = new Date();
      } else {
        return res.status(409).json({ error: 'נדרש אישור תנאי שימוש ומדיניות פרטיות', code: 'CONSENT_REQUIRED' });
      }
    }
    if (!slug || !Array.isArray(items) || !items.length || !address) return res.status(400).json({ error: 'חסרים פרטי הזמנה' });
    const { rows: t } = await q('SELECT * FROM tenants WHERE slug=$1 AND approved', [slug]);
    const tenant = t[0];
    if (!tenant) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
    if (!tenant.is_open) return res.status(409).json({ error: 'המכבסה סגורה כרגע' });
    if (tenant.paused_until && new Date(tenant.paused_until) > new Date()) return res.status(409).json({ error: 'המכבסה בהפסקה זמנית עד ' + new Date(tenant.paused_until).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) }); // C1
    if (pickup_at) { const { rows: cl } = await q("SELECT 1 FROM tenant_closures WHERE tenant_id=$1 AND day=($2::timestamptz AT TIME ZONE 'Asia/Jerusalem')::date", [tenant.id, pickup_at]); if (cl.length) return res.status(409).json({ error: 'המכבסה סגורה ביום האיסוף שנבחר — בחרו מועד אחר' }); } // C3

    await client.query('BEGIN');
    const ids = items.map(i => i.item_id);
    const { rows: dbItems } = await client.query(
      'SELECT * FROM price_items WHERE tenant_id=$1 AND active AND id = ANY($2)', [tenant.id, ids]);
    let subtotal = 0;
    const lines = [];
    for (const it of items) {
      const db = dbItems.find(d => d.id === it.item_id);
      if (!db) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'פריט לא קיים במחירון' }); }
      let qty = Number(it.qty) || 1;
      // QA-flow: פריט ביחידות — כמות שלמה בלבד; במשקל — דיוק סיבית אחת, מינימום 0.5 ק"ג (עוקף מחיר זעיר)
      if (db.unit === 'kg') qty = Math.round(qty * 10) / 10;
      if (qty <= 0 || qty > 100 || (db.unit !== 'kg' && !Number.isInteger(qty)) || (db.unit === 'kg' && qty < 0.5)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'כמות לא תקינה' }); }
      subtotal += Number(db.price) * qty;
      lines.push({ item_id: db.id, name: db.name, price: db.price, qty, unit: db.unit, subscription_eligible: !!db.subscription_eligible });
    }
    // E4.T1: מחירון הסכמי גובר על המחירון הרגיל כשהלקוח משויך לחשבון עסקי פעיל
    let businessAccount = null;
    {
      const { rows: biz } = await client.query(
        `SELECT ba.id, ba.name FROM business_accounts ba JOIN business_account_users bau ON bau.account_id=ba.id
         WHERE ba.tenant_id=$1 AND bau.user_id=$2 AND ba.active LIMIT 1`, [tenant.id, req.user.id]);
      businessAccount = biz[0] || null;
    }
    if (businessAccount) {
      const { rows: bp } = await client.query('SELECT item_id, price FROM business_prices WHERE account_id=$1', [businessAccount.id]);
      const omap = new Map(bp.map(x => [x.item_id, Number(x.price)]));
      subtotal = 0;
      for (const ln of lines) { if (omap.has(ln.item_id)) ln.price = omap.get(ln.item_id); subtotal += Number(ln.price) * Number(ln.qty); }
    }
    if (!use_subscription && Number(tenant.min_order) > 0 && subtotal < Number(tenant.min_order)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `מינימום הזמנה ₪${tenant.min_order}` });
    }
    // E2.T2: הזמנה במנוי — ניכוי מכסת שקים במקום חיוב על פריטים מכוסים
    let subscription = null, subBags = 0;
    if (use_subscription) {
      const { rows: sr } = await client.query(
        `SELECT s.*, p.bags_per_month, p.kg_per_bag, p.extra_bag_price, p.name AS plan_name
         FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
         WHERE s.tenant_id=$1 AND s.user_id=$2
           AND (s.status='active' OR (s.status='cancelled' AND s.period_end >= CURRENT_DATE))
         ORDER BY CASE WHEN s.status='active' THEN 0 ELSE 1 END
         LIMIT 1 FOR UPDATE OF s`, [tenant.id, req.user.id]);
      if (!sr[0]) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'אין מנוי פעיל במכבסה זו' }); }
      subscription = await ensureCurrentPeriod(client, sr[0]);
      try {
        const applied = await applySubscriptionToOrder(client, { sub: subscription, plan: sr[0], lines });
        lines.length = 0; lines.push(...applied.lines);
        subBags = applied.bagsConsumed;
      } catch (err) {
        await client.query('ROLLBACK');
        return res.status(err.status || 400).json({ error: err.error || 'לא ניתן לנצל את המנוי' });
      }
      subtotal = lines.reduce((sum, l) => sum + Number(l.price) * Number(l.qty), 0);
    }
    const deliveryFee = use_subscription ? 0 : (Number(tenant.delivery_fee) || 0);
    // קופון: תיקוף + הנחה על סכום הפריטים
    let coupon = null, couponDiscount = 0;
    if (coupon_code) {
      try {
        // QA-flow: נעילת שורת הקופון בתוך הטרנזקציה — הזמנות במקביל לא חורגות מ-usage_limit
        const found = await findCoupon(client, tenant.id, coupon_code);
        if (found) await client.query('SELECT 1 FROM coupons WHERE id=$1 FOR UPDATE', [found.id]);
        const v = await validateCoupon(client, tenant, coupon_code, req.user.id, subtotal);
        coupon = v.coupon; couponDiscount = v.discount;
      } catch (err) {
        await client.query('ROLLBACK');
        return res.status(err.status || 400).json({ error: err.error || 'קופון לא תקף' });
      }
    }
    // מימוש נקודות: 1 נקודה = ₪1, עד תקרת אחוז מהסכום שנותר אחרי קופון
    let discount = couponDiscount, pointsRedeemed = 0;
    if (redeem_points) {
      const { rows: bal } = await client.query(
        'SELECT COALESCE(sum(delta),0) AS bal FROM points_ledger WHERE tenant_id=$1 AND user_id=$2', [tenant.id, req.user.id]);
      const remaining = Math.max(0, subtotal - couponDiscount);
      const maxDisc = Math.floor(remaining * Number(tenant.points_redeem_max_pct || 0.2));
      pointsRedeemed = Math.min(Number(bal[0].bal), maxDisc);
      discount += pointsRedeemed;
    }
    const total = Math.max(0, subtotal + deliveryFee - discount);
    const pointsEarned = Math.floor(total * Number(tenant.points_earn_rate || 0));
    // A2: ב-pilot אין תשלום דמו שמסמן "שולם"
    if (payment_method === 'demo_online' && require('../config').isPilot) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'תשלום מקוון (דמו) לא זמין במצב פיילוט' });
    }
    const payMethod = payment_method === 'demo_online' ? 'demo_online' : 'cash';
    const payStatus = payMethod === 'demo_online' ? 'paid_demo' : 'pending';

    const { rows: o } = await client.query(
      `INSERT INTO orders(tenant_id, customer_id, source, address, lat, lng, pickup_at, delivery_at,
        subtotal, delivery_fee, discount, total, payment_method, payment_status, points_earned, points_redeemed, coupon_id, notes, subscription_id, business_account_id)
       VALUES ($1,$2,$19,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$20) RETURNING *`,
      [tenant.id, req.user.id, address, lat || null, lng || null, pickup_at || null, delivery_at || null,
       subtotal, deliveryFee, discount, total, payMethod, payStatus, pointsEarned, pointsRedeemed, coupon ? coupon.id : null, notes || null,
       subscription ? subscription.id : null, source === 'branded' ? 'branded' : 'app', businessAccount ? businessAccount.id : null]);
    const order = o[0];
    for (const ln of lines) {
      await client.query('INSERT INTO order_items(order_id, item_id, name, price, qty) VALUES ($1,$2,$3,$4,$5)',
        [order.id, ln.item_id, ln.name, ln.price, ln.qty]);
    }
    if (subscription && subBags > 0) {
      await client.query('UPDATE subscriptions SET bags_used = bags_used + $1, updated_at=now() WHERE id=$2', [subBags, subscription.id]);
      await client.query('INSERT INTO subscription_usage(subscription_id, order_id, bags, note) VALUES ($1,$2,$3,$4)',
        [subscription.id, order.id, subBags, 'ניצול מכסת מנוי בהזמנה']);
    }
    if (pointsRedeemed > 0) {
      await client.query('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
        [tenant.id, req.user.id, -pointsRedeemed, 'מימוש נקודות בהזמנה', order.id]);
    }
    if (coupon) {
      await client.query('UPDATE coupons SET used_count = used_count + 1 WHERE id=$1', [coupon.id]);
    }
    await client.query(`INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,'new',$2,'הזמנה נוצרה')`, [order.id, req.user.id]);
    await client.query('COMMIT');

    notifyUser(req.user.id, tenant.id,
      `הזמנתך ב${tenant.name} התקבלה (#${order.id.slice(0, 8)}) — סה״כ ₪${total}. נעדכן כשהיא תאושר.`, req.user.phone).catch(() => {});
    res.status(201).json({ order });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e); res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});


// תצוגה מקדימה של קופון בעגלה: {slug, code, subtotal} -> {discount}
r.post('/validate-coupon', async (req, res) => {
  const { slug, code, subtotal } = req.body || {};
  if (!slug || !code) return res.status(400).json({ error: 'חסרים פרטים' });
  const { rows: t } = await q('SELECT * FROM tenants WHERE slug=$1 AND approved', [slug]);
  const tenant = t[0];
  if (!tenant) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  try {
    const v = await validateCoupon({ query: (a, b) => q(a, b) }, tenant, code, req.user.id, Number(subtotal) || 0);
    res.json({ ok: true, discount: v.discount, kind: v.coupon.kind, value: Number(v.coupon.value) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.error || 'קופון לא תקף' });
  }
});

// ההזמנות שלי (לקוח)
r.get('/mine', async (req, res) => {
  const { rows } = await q(
    `SELECT o.*, t.name AS tenant_name, t.slug, t.color, t.letter,
       (SELECT json_agg(json_build_object('name',oi.name,'qty',oi.qty,'price',oi.price)) FROM order_items oi WHERE oi.order_id=o.id) AS items
     FROM orders o JOIN tenants t ON t.id=o.tenant_id
     WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 100`, [req.user.id]);
  res.json({ orders: rows, statusHe: STATUS_HE });
});

// מועדון: יתרות לפי מכבסה + תנועות אחרונות
r.get('/club/summary', async (req, res) => {
  const { rows } = await q(
    `SELECT p.tenant_id, t.name, t.slug, t.color, t.letter, sum(p.delta)::int AS balance, max(p.created_at) AS last
     FROM points_ledger p JOIN tenants t ON t.id=p.tenant_id WHERE p.user_id=$1 GROUP BY 1,2,3,4,5 ORDER BY last DESC`, [req.user.id]);
  const { rows: recent } = await q(
    `SELECT p.delta, p.reason, p.created_at, t.name FROM points_ledger p JOIN tenants t ON t.id=p.tenant_id
     WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 20`, [req.user.id]);
  res.json({ balances: rows, recent });
});


// פרטי הזמנה + פריטים + אירועים (לקוח שהזמין / בעל מכבסה / שליח משובץ / אדמין)
r.get('/:id', uuidParams('id'), async (req, res) => {
  const { rows: o } = await q(
    `SELECT o.*, t.name AS tenant_name, t.slug, t.phone AS tenant_phone FROM orders o JOIN tenants t ON t.id=o.tenant_id WHERE o.id=$1`,
    [req.params.id]);
  const order = o[0];
  if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  const isCustomer = order.customer_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const { rows: mem } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [order.tenant_id, req.user.id]);
  const isOwner = mem.length > 0;
  const isCourier = order.courier_id && (await q('SELECT 1 FROM couriers WHERE id=$1 AND user_id=$2', [order.courier_id, req.user.id])).rows.length > 0;
  if (!isCustomer && !isAdmin && !isOwner && !isCourier) return res.status(403).json({ error: 'אין הרשאה' });
  const [items, events, rev] = await Promise.all([
    q('SELECT name, price, qty FROM order_items WHERE order_id=$1', [order.id]),
    q('SELECT status, note, photo_url, created_at FROM order_events WHERE order_id=$1 ORDER BY created_at', [order.id]),
    q('SELECT 1 FROM reviews WHERE order_id=$1 AND user_id=$2 LIMIT 1', [order.id, req.user.id]),
  ]);
  res.json({ order, items: items.rows, events: events.rows, statusHe: STATUS_HE, reviewed: rev.rows.length > 0 });
});

// קבלה/חשבונית PDF (אותן הרשאות כמו צפייה בהזמנה)
r.get('/:id/receipt.pdf', uuidParams('id'), async (req, res) => {
  const { rows: o } = await q(
    `SELECT o.*, t.name AS tenant_name, t.slug, t.color, t.address AS tenant_address, t.city AS tenant_city, t.phone AS tenant_phone
     FROM orders o JOIN tenants t ON t.id=o.tenant_id WHERE o.id=$1`, [req.params.id]);
  const order = o[0];
  if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  const isCustomer = order.customer_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const { rows: mem } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [order.tenant_id, req.user.id]);
  if (!isCustomer && !isAdmin && !mem.length) return res.status(403).json({ error: 'אין הרשאה' });
  const [items, cust] = await Promise.all([
    q('SELECT name, price, qty FROM order_items WHERE order_id=$1', [order.id]),
    q('SELECT name, phone, email FROM users WHERE id=$1', [order.customer_id]),
  ]);
  const tenant = { name: order.tenant_name, color: order.color, address: order.tenant_address, city: order.tenant_city, phone: order.tenant_phone };
  const doc = buildReceiptPDF({ order, items: items.rows, tenant, customer: cust[0] || {} });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="receipt-${order.id.slice(0, 8)}.pdf"`);
  doc.pipe(res);
});

// ביטול על ידי לקוח (לפני איסוף)
r.post('/:id/cancel', uuidParams('id'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // QA-flow: FOR UPDATE — תחרות מול סימון שליח; רק הצד הראשון מצליח
    const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 AND customer_id=$2 FOR UPDATE', [req.params.id, req.user.id]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'הזמנה לא נמצאה' }); }
    if (!['new', 'confirmed'].includes(order.status)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'לא ניתן לבטל לאחר איסוף' }); }
    await client.query(`UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1`, [order.id]);
    await client.query(`INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,'cancelled',$2,'בוטלה על ידי הלקוח')`, [order.id, req.user.id]);
    // QA-flow: החזר נקודות שמומשו ושחרור שימוש בקופון
    if (Number(order.points_redeemed) > 0)
      await client.query('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
        [order.tenant_id, order.customer_id, Number(order.points_redeemed), 'החזר נקודות בעקבות ביטול הזמנה', order.id]);
    if (order.coupon_id)
      await client.query('UPDATE coupons SET used_count = GREATEST(0, used_count - 1) WHERE id=$1', [order.coupon_id]);
    await restoreBags(client, order.id);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  finally { client.release(); }
});

// דירוג אחרי הזמנה
r.post('/:id/review', uuidParams('id'), async (req, res) => {
  const { rating, text, tags: laundry_tags, courier_rating, courier_tags } = req.body || {};
  const rt = Number(rating);
  if (!(rt >= 1 && rt <= 5)) return res.status(400).json({ error: 'דירוג 1-5' });
  const { rows } = await q('SELECT * FROM orders WHERE id=$1 AND customer_id=$2', [req.params.id, req.user.id]);
  const order = rows[0];
  if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  if (order.status !== 'delivered') return res.status(409).json({ error: 'ניתן לדרג רק הזמנה שהושלמה' });
  // E9.T4: תגיות ביקורת על המכבסה (עד 5)
  const ltags = Array.isArray(laundry_tags) ? laundry_tags.map(String).slice(0, 5) : null;
  const { rows: dup } = await q(
    'SELECT 1 FROM reviews WHERE order_id=$1 AND user_id=$2 AND target_courier_id IS NULL LIMIT 1', [order.id, req.user.id]);
  if (dup.length) return res.status(409).json({ error: 'כבר דירגת הזמנה זו' });
  try {
    await q('INSERT INTO reviews(tenant_id, order_id, user_id, rating, text, tags) VALUES ($1,$2,$3,$4,$5,$6)',
      [order.tenant_id, order.id, req.user.id, rt, text || null, ltags]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'כבר דירגת הזמנה זו' }); // QA-flow: תחרות — האילוץ מכריע
    throw e;
  }
  // E9.T4: ‎+20 נקודות על ביקורת — פעם אחת להזמנה
  const { rows: awarded } = await q(
    `SELECT 1 FROM points_ledger WHERE tenant_id=$1 AND user_id=$2 AND order_id=$3 AND reason='review_bonus'`,
    [order.tenant_id, req.user.id, order.id]);
  let bonus = 0;
  if (!awarded[0]) {
    bonus = 20;
    await q('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
      [order.tenant_id, req.user.id, 20, 'review_bonus', order.id]);
  }
  // E5.T7: דירוג השליח (אופציונלי, רק אם שובץ שליח)
  const crt = Number(courier_rating);
  if (order.courier_id && crt >= 1 && crt <= 5) {
    const tags = Array.isArray(courier_tags) ? courier_tags.map(String).slice(0, 5) : null;
    const { rows: cdup } = await q(
      'SELECT 1 FROM reviews WHERE order_id=$1 AND user_id=$2 AND target_courier_id IS NOT NULL LIMIT 1', [order.id, req.user.id]);
    if (!cdup.length) await q('INSERT INTO reviews(tenant_id, order_id, user_id, target_courier_id, rating, tags) VALUES ($1,$2,$3,$4,$5,$6)',
      [order.tenant_id, order.id, req.user.id, order.courier_id, crt, tags]);
    await applyCourierRating(order.courier_id, crt);
  }
  const { rows: agg } = await q('SELECT avg(rating)::numeric(2,1) AS a, count(*)::int AS c FROM reviews WHERE tenant_id=$1 AND target_courier_id IS NULL', [order.tenant_id]);
  await q('UPDATE tenants SET rating=$1, rating_count=$2 WHERE id=$3', [agg[0].a, agg[0].c, order.tenant_id]);
  res.json({ ok: true, points_bonus: bonus });
});

module.exports = r;
