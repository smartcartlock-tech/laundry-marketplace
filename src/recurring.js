// E4.T2: ייצור הזמנות אוטומטי מתבניות חזרתיות של חשבונות עסקיים.
// רץ פעם בשעה בתוך התהליך (שרת יחיד ב-Render) + ניתן להרצה ידנית בבדיקות.
// מייצר הזמנה רק ביום מתוזמן (לפי שעון ישראל), פעם אחת ליום לכל תבנית; תבנית מושהית לא מייצרת.
async function generateDueOrders(q) {
  const { rows: due } = await q(
    `SELECT rt.*, ba.tenant_id, ba.name AS account_name
     FROM recurring_templates rt JOIN business_accounts ba ON ba.id=rt.account_id
     WHERE rt.active AND ba.active
       AND rt.days @> to_jsonb(EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Jerusalem'))::int)
       AND rt.last_run_on IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Jerusalem')::date`);
  let created = 0;
  for (const t of due) {
    const items = Array.isArray(t.items) ? t.items : [];
    if (!items.length) continue;
    const ids = items.map(i => i.item_id);
    const { rows: dbItems } = await q('SELECT * FROM price_items WHERE tenant_id=$1 AND active AND id = ANY($2)', [t.tenant_id, ids]);
    if (!dbItems.length) continue;
    const { rows: bp } = await q('SELECT item_id, price FROM business_prices WHERE account_id=$1', [t.account_id]);
    const omap = new Map(bp.map(x => [x.item_id, Number(x.price)]));
    let subtotal = 0;
    const lines = [];
    for (const it of items) {
      const db = dbItems.find(d => d.id === it.item_id);
      if (!db) continue;
      const qty = Number(it.qty) || 1;
      const price = omap.has(db.id) ? omap.get(db.id) : Number(db.price);
      subtotal += price * qty;
      lines.push({ item_id: db.id, name: db.name, price, qty });
    }
    if (!lines.length) continue;
    const { rows: tn } = await q('SELECT delivery_fee FROM tenants WHERE id=$1', [t.tenant_id]);
    const deliveryFee = Number(tn[0]?.delivery_fee) || 0;
    const pickupAt = t.pickup_time
      ? `(now() AT TIME ZONE 'Asia/Jerusalem')::date + interval '${String(t.pickup_time).replace(/[^0-9:]/g, '')}'`
      : null;
    const { rows: o } = await q(
      `INSERT INTO orders(tenant_id, customer_id, source, address, pickup_at, subtotal, delivery_fee, discount, total,
         payment_method, payment_status, notes, business_account_id)
       VALUES ($1,$2,'recurring',$3,${pickupAt || 'NULL'},$4,$5,0,$6,'cash','pending',$7,$8) RETURNING id`,
      [t.tenant_id, t.user_id, t.address, subtotal, deliveryFee, subtotal + deliveryFee,
       `הזמנה חוזרת אוטומטית — ${t.account_name}`, t.account_id]);
    for (const ln of lines) {
      await q('INSERT INTO order_items(order_id, item_id, name, price, qty) VALUES ($1,$2,$3,$4,$5)',
        [o[0].id, ln.item_id, ln.name, ln.price, ln.qty]);
    }
    await q(`INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,'new',$2,'הזמנה חוזרת נוצרה אוטומטית')`, [o[0].id, t.user_id]);
    await q(`UPDATE recurring_templates SET last_run_on=(now() AT TIME ZONE 'Asia/Jerusalem')::date WHERE id=$1`, [t.id]);
    created++;
  }
  return { due: due.length, created };
}

module.exports = { generateDueOrders };
