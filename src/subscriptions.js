// E2: לוגיקת מנויים — חידוש תקופה עצל (ללא job חיצוני) ורישום ניצול.

// אם התקופה הנוכחית הסתיימה והמנוי פעיל עם חידוש אוטומטי — פותח תקופה חדשה (תשלום דמו).
// מחזיר את המנוי המעודכן. db הוא client בתוך טרנזקציה או {query} רגיל.
async function ensureCurrentPeriod(db, sub) {
  if (sub.status !== 'active' || !sub.auto_renew) return sub;
  const today = new Date().toISOString().slice(0, 10);
  if (String(sub.period_end).slice(0, 10) > today) return sub;
  const { rows } = await db.query(
    `UPDATE subscriptions
       SET period_start = period_end,
           period_end = period_end + INTERVAL '1 month',
           bags_used = 0, payment_status = 'paid_demo', updated_at = now()
     WHERE id=$1 RETURNING *`, [sub.id]);
  await db.query(
    `INSERT INTO subscription_usage(subscription_id, bags, note) VALUES ($1, 0, 'חידוש מנוי חודשי (תשלום דמו)')`, [sub.id]);
  return rows[0] || sub;
}


// ניכוי מכסת מנוי משורת פריטים. מחזיר שורות מעודכנות (מכוסה=מחיר 0) וכמות שקים שנוצלה.
// זורק {status,error} כשאין מה לכסות.
async function applySubscriptionToOrder(client, { sub, plan, lines }) {
  let remaining = Number(plan.bags_per_month) - Number(sub.bags_used);
  if (remaining <= 0) throw { status: 409, error: 'מכסת השקים במנוי נוצלה לחודש זה' };
  const kgPerBag = Number(plan.kg_per_bag) || 8;
  const extraBag = plan.extra_bag_price !== null && plan.extra_bag_price !== undefined ? Number(plan.extra_bag_price) : null;
  const out = [];
  let bags = 0, touched = false;
  for (const ln of lines) {
    if (!ln.subscription_eligible || remaining <= 0) { out.push(ln); continue; }
    touched = true;
    if (ln.unit === 'kg') {
      const coverKg = Math.min(ln.qty, remaining * kgPerBag);
      const used = Math.round((coverKg / kgPerBag) * 10) / 10;
      bags += used; remaining -= used;
      if (coverKg > 0) out.push({ ...ln, price: 0, qty: coverKg, name: ln.name + ' (מנוי)' });
      if (ln.qty - coverKg > 0) out.push({ ...ln, qty: Math.round((ln.qty - coverKg) * 10) / 10 });
    } else {
      const covered = Math.min(ln.qty, remaining);
      bags += covered; remaining -= covered;
      if (covered > 0) out.push({ ...ln, price: 0, qty: covered, name: ln.name + ' (מנוי)' });
      if (ln.qty - covered > 0) out.push({ ...ln, qty: ln.qty - covered, price: extraBag !== null ? extraBag : ln.price });
    }
  }
  if (!touched || bags <= 0) throw { status: 409, error: 'אין פריטים מכוסים במנוי בהזמנה זו' };
  return { lines: out, bagsConsumed: Math.round(bags * 10) / 10 };
}

// החזר מכסה בעת ביטול הזמנת מנוי
async function restoreBags(db, orderId, note) {
  const { rows } = await db.query(
    'SELECT subscription_id FROM orders WHERE id=$1', [orderId]);
  const subId = rows[0] && rows[0].subscription_id;
  if (!subId) return;
  const { rows: u } = await db.query(
    'SELECT COALESCE(sum(bags),0)::numeric AS b FROM subscription_usage WHERE subscription_id=$1 AND order_id=$2 AND bags>0',
    [subId, orderId]);
  const bags = Number(u[0].b);
  if (!bags) return;
  await db.query('UPDATE subscriptions SET bags_used = GREATEST(0, bags_used - $1), updated_at=now() WHERE id=$2', [bags, subId]);
  await db.query('INSERT INTO subscription_usage(subscription_id, order_id, bags, note) VALUES ($1,$2,$3,$4)',
    [subId, orderId, -bags, note || 'החזר מכסה בעקבות ביטול הזמנה']);
}

module.exports = { ensureCurrentPeriod, applySubscriptionToOrder, restoreBags };
