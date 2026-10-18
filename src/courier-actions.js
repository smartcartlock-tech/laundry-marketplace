// השלמת מסירה על ידי שליח — סטטוס, אירוע, צבירת זכות/נקודות, מסמכים והתראה ללקוח.
// עזר משותף לנתיבי השליח (נוצר עבור מסך השליח; routes/courier.js משתמש בענף מקביל משלו).
const { q, pool } = require('./db');
const { notifyUser } = require('./notify');
const { accrueStop } = require('./routes-engine');

// T94: משימת מזומן לא נסגרת בלי אישור גבייה ('גביתי ₪X' / סכום אחר / סירב).
// מחזיר null כשאישור לא נדרש, {error,code,status} כשחסר/פסול, או {outcome,amount,note} תקין.
function parseCashConfirmation(body, order) {
  if (order.payment_method !== 'cash' || order.payment_status === 'paid_cash') return null;
  let cash = (body || {}).cash;
  if (typeof cash === 'string') { try { cash = JSON.parse(cash); } catch (e) { cash = null; } }
  if (!cash || typeof cash !== 'object') {
    return { error: 'משימת מזומן מחייבת אישור גבייה לפני סגירתה — גביתי את הסכום / סכום אחר / הלקוח סירב', code: 'CASH_CONFIRM_REQUIRED', status: 400 };
  }
  const outcome = cash.outcome;
  if (!['collected', 'partial', 'refused'].includes(outcome)) {
    return { error: 'אישור גבייה לא תקין — נדרש collected / partial / refused', code: 'CASH_CONFIRM_REQUIRED', status: 400 };
  }
  let amount = 0;
  if (outcome === 'collected') amount = cash.amount != null ? Number(cash.amount) : Number(order.total);
  if (outcome === 'partial') {
    amount = Number(cash.amount);
    if (!(amount > 0) || amount > Number(order.total) + 500) return { error: 'סכום הגבייה החלקית לא תקין', code: 'CASH_CONFIRM_REQUIRED', status: 400 };
  }
  if (!(amount >= 0) || amount > 100000) return { error: 'סכום גבייה לא תקין', code: 'CASH_CONFIRM_REQUIRED', status: 400 };
  return { outcome, amount, note: String(cash.note || '').slice(0, 200) || null };
}

const CASH_LABEL = c => c.outcome === 'collected' ? `גביית מזומן: ₪${c.amount}` :
  c.outcome === 'partial' ? `גבייה חלקית במזומן: ₪${c.amount}` : 'הלקוח סירב לשלם במזומן';

// תיעוד הגבייה + סטטוס תשלום: 'גביתי' → paid_cash; חלקי/סירב → נשאר pending ליישור מול המכבסה
async function recordCashCollection({ courierId, order, cash, db = { query: q } }) {
  await db.query(
    'INSERT INTO courier_cash_collections(courier_id, order_id, tenant_id, outcome, amount, note) VALUES ($1,$2,$3,$4,$5,$6)',
    [courierId, order.id, order.tenant_id, cash.outcome, cash.amount, cash.note]);
  if (cash.outcome === 'collected') {
    await db.query(`UPDATE orders SET payment_status='paid_cash' WHERE id=$1`, [order.id]);
  }
}

function priceUpdatePendingError(order) {
  if (order.price_update && order.price_update.status === 'pending') {
    return { error: 'ממתין לאישור הלקוח לעדכון המחיר — לא ניתן לסגור את המשימה עדיין', code: 'PRICE_UPDATE_PENDING', status: 409 };
  }
  return null;
}

async function completeDelivery({ order, courierId, actorId, photoUrl, note, cashConfirm = null }) {
  // T121: לא סוגרים מסירה כשעדכון מחיר ממתין לאישור הלקוח
  const pue = priceUpdatePendingError(order);
  if (pue) { const e = new Error(pue.error); e.status = pue.status; e.code = pue.code; throw e; }
  await q(`UPDATE orders SET status='delivered', updated_at=now() WHERE id=$1`, [order.id]);
  if (cashConfirm) {
    await recordCashCollection({ courierId, order, cash: cashConfirm });
    note = [note, CASH_LABEL(cashConfirm) + (cashConfirm.note ? ` (${cashConfirm.note})` : '')].filter(Boolean).join(' · ');
  }
  await q('INSERT INTO order_events(order_id, status, actor_id, note, photo_url) VALUES ($1,$2,$3,$4,$5)',
    [order.id, 'delivered', actorId, note || null, photoUrl || null]);
  await accrueStop(courierId, order, 'delivery').catch(e => console.error('[earnings]', e.message));
  if (order.points_earned > 0) {
    await q('INSERT INTO points_ledger(tenant_id, user_id, delta, reason, order_id) VALUES ($1,$2,$3,$4,$5)',
      [order.tenant_id, order.customer_id, order.points_earned, 'צבירת נקודות מהזמנה', order.id]);
  }
  // T94: סימון paid_cash מתבצע רק באישור גבייה 'גביתי' (recordCashCollection) — לא אוטומטית בסגירה
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
  const code = order.tracking_code || String(order.id).slice(0, 8); // T111: מזהה עקבי + דה-דופ מול נקודת ה-mark
  if (cust[0]) notifyUser(cust[0].id, order.tenant_id, `הזמנה ${code}: סומנה כהוחזרה. תודה!`, cust[0].phone, `הזמנה ${code}: סומנה כהוחזרה. תודה!`,
    { dedupKey: `order-status:${order.id}:delivered`, url: '#/track/' + code, data: { order_id: order.id, tracking_code: code, status: 'delivered' } }).catch(() => {});
}

module.exports = { completeDelivery, parseCashConfirmation, recordCashCollection, priceUpdatePendingError, CASH_LABEL };
