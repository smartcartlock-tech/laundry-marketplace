// מנוע קופונים: תיקוף (תוקף/מינימום/מגבלות שימוש) וחישוב הנחה.
// כל הבדיקות רצות בתוך הטרנזקציה של יצירת ההזמנה (client) או בקריאה רגילה (תצוגה מקדימה).

async function findCoupon(db, tenantId, code) {
  const { rows } = await db.query(
    `SELECT * FROM coupons WHERE tenant_id=$1 AND upper(code)=upper($2)`, [tenantId, String(code || '').trim()]);
  return rows[0] || null;
}

// מחזיר {coupon, discount} או זורק אובייקט {status, error}
async function validateCoupon(db, tenant, code, userId, subtotal) {
  const coupon = await findCoupon(db, tenant.id, code);
  if (!coupon || !coupon.active) throw { status: 404, error: 'קופון לא תקף' };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw { status: 409, error: 'הקופון פג תוקף' };
  if (Number(coupon.min_order) > 0 && subtotal < Number(coupon.min_order)) {
    throw { status: 409, error: `הקופון תקף מסכום ₪${coupon.min_order}` };
  }
  if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
    throw { status: 409, error: 'הקופון מוצה (הגענו למגבלת השימוש)' };
  }
  if (coupon.per_user_limit !== null) {
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM orders WHERE coupon_id=$1 AND customer_id=$2', [coupon.id, userId]);
    if (rows[0].n >= coupon.per_user_limit) throw { status: 409, error: 'כבר ניצלת את הקופון הזה' };
  }
  let discount = coupon.kind === 'percent'
    ? Math.round(subtotal * Number(coupon.value)) / 100
    : Number(coupon.value);
  discount = Math.min(discount, subtotal); // ההנחה לא עולה על סכום הפריטים
  discount = Math.round(discount * 100) / 100;
  return { coupon, discount };
}

module.exports = { findCoupon, validateCoupon };
