// T85: ייצור הזמנות אוטומטי ממנויי איסוף קבוע של צרכנים.
// רץ יחד עם runRecurring (הפעלה + כל שעה). מייצר הזמנה רק ביום המתוזמן (שעון ישראל),
// פעם אחת ליום לכל מנוי (last_run_on), מנוי מושהה לא מייצר, biweekly לפי שבוע עוגן.
// אחרי יצירה — הודעה פנימית ללקוח במרכז ההודעות (user_messages; בלי שליחה החוצה).
const { postUserMessage } = require('./usermessages');

async function generateDueConsumerPickups(q, opts = {}) {
  let { dow, date } = opts;
  if (dow === undefined || date === undefined) {
    const { rows: now } = await q(`SELECT EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Jerusalem'))::int AS d,
                                          (now() AT TIME ZONE 'Asia/Jerusalem')::date::text AS t`);
    if (dow === undefined) dow = now[0].d;
    if (date === undefined) date = now[0].t;
  }
  const { rows: due } = await q(
    `SELECT s.*, t.name AS tenant_name FROM consumer_pickup_subscriptions s
     JOIN tenants t ON t.id=s.tenant_id
     WHERE s.active AND s.weekday=$1 AND s.last_run_on IS DISTINCT FROM $2::date
       AND (s.frequency='weekly'
            OR (s.anchor_date IS NOT NULL AND MOD(($2::date - s.anchor_date) / 7, 2) = 0))`, [dow, date]);
  let created = 0;
  for (const s of due) {
    const items = Array.isArray(s.items) ? s.items : [];
    if (!items.length) continue;
    const ids = items.map(i => i.item_id);
    const { rows: dbItems } = await q('SELECT * FROM price_items WHERE tenant_id=$1 AND active AND id = ANY($2)', [s.tenant_id, ids]);
    if (!dbItems.length) continue;
    let subtotal = 0;
    const lines = [];
    for (const it of items) {
      const db = dbItems.find(d => d.id === it.item_id);
      if (!db) continue;
      const qty = Number(it.qty) || 1;
      subtotal += Number(db.price) * qty;
      lines.push({ item_id: db.id, name: db.name, price: Number(db.price), qty });
    }
    if (!lines.length) continue;
    const { rows: tn } = await q('SELECT delivery_fee FROM tenants WHERE id=$1', [s.tenant_id]);
    const deliveryFee = Number(tn[0]?.delivery_fee) || 0;
    const pickupAt = s.pickup_time
      ? `$8::date + interval '${String(s.pickup_time).replace(/[^0-9:]/g, '')}'`
      : null;
    const { rows: o } = await q(
      `INSERT INTO orders(tenant_id, customer_id, source, address, pickup_at, subtotal, delivery_fee, discount, total,
         payment_method, payment_status, notes)
       VALUES ($1,$2,'recurring',$3,${pickupAt || 'NULL'},$4,$5,0,$6,'cash','pending',$7) RETURNING id`,
      [s.tenant_id, s.user_id, s.address, subtotal, deliveryFee, subtotal + deliveryFee,
       `איסוף קבוע אוטומטי — ${s.tenant_name}`, ...(s.pickup_time ? [date] : [])]);
    for (const ln of lines) {
      await q('INSERT INTO order_items(order_id, item_id, name, price, qty) VALUES ($1,$2,$3,$4,$5)',
        [o[0].id, ln.item_id, ln.name, ln.price, ln.qty]);
    }
    await q(`INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,'new',$2,'איסוף קבוע נוצר אוטומטית')`, [o[0].id, s.user_id]);
    await postUserMessage(s.user_id, {
      tenantId: s.tenant_id, kind: 'order',
      title: 'הוזמנה הזמנת האיסוף הקבוע שלך',
      body: `${s.tenant_name}: הזמנה חוזרת נוצרה להיום (${lines.length} פריטים). ניתן לצפות ולעקוב במסך ההזמנות.`,
      data: { order_id: o[0].id },
    }, q).catch(e => console.error('[consumer-recurring msg]', e.message));
    await q('UPDATE consumer_pickup_subscriptions SET last_run_on=$2::date WHERE id=$1', [s.id, date]);
    created++;
  }
  return { due: due.length, created };
}

module.exports = { generateDueConsumerPickups };
