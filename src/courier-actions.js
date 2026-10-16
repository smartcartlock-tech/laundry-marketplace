// השלמת מסירה על ידי שליח — סטטוס, אירוע, צבירת זכות/נקודות, מסמכים והתראה ללקוח.
// עזר משותף לנתיבי השליח (נוצר עבור מסך השליח; routes/courier.js משתמש בענף מקביל משלו).
const { q, pool } = require('./db');
const { notifyUser } = require('./notify');
const { accrueStop } = require('./routes-engine');

async function completeDelivery({ order, courierId, actorId, photoUrl, note }) {
  await q(`UPDATE orders SET status='delivered', updated_at=now() WHERE id=$1`, [order.id]);
  await q('INSERT INTO order_events(order_id, status, actor_id, note, photo_url) VALUES ($1,$2,$3,$4,$5)',
    [order.id, 'delivered', actorId, note || null, photoUrl || null]);
  await accrueStop(courierId, order, 'delivery').catch(e => console.error('[earnings]', e.message));
  if (order.points_earned > 0) {
    await q('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
      [order.tenant_id, order.customer_id, order.points_earned, 'צבירת נקודות מהזמנה', order.id]);
  }
  if (order.payment_method === 'cash') await q(`UPDATE orders SET payment_status='paid_cash' WHERE id=$1`, [order.id]);
  const { issueDocumentsForOrder } = require('./documents');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: tt } = await client.query('SELECT * FROM tenants WHERE id=$1', [order.tenant_id]);
    const { rows: ord } = await client.query('SELECT * FROM orders WHERE id=$1', [order.id]);
    await issueDocumentsForOrder(client, { tenant: tt[0], order: ord[0], actorId });
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('[documents] issue failed', e.message); }
  finally { client.release(); }
  const { rows: cust } = await q('SELECT id, phone FROM users WHERE id=$1', [order.customer_id]);
  if (cust[0]) notifyUser(cust[0].id, order.tenant_id, `הזמנתך (#${order.id.slice(0, 8)}) סומנה כהוחזרה. תודה!`, cust[0].phone).catch(() => {});
}

module.exports = { completeDelivery };
