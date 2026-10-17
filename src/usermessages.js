// N1+N2: שכבת הודעות פנימית — רישום הודעה למרכז ההודעות, ורינדור תבניות עם משתנים.
// הכל פנימי/מדומה: אין כאן שום שליחה החוצה (וואטסאפ/דוא"ל אמיתיים לא קורים כאן).
const { q } = require('./db');

// החלפת {{משתנים}} בטקסט תבנית. משתנה חסר נשאר כפי שהוא כדי שיהיה נראה לעין.
function renderTemplate(text, vars = {}) {
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_א-ת]+)\s*\}\}/g, (m, k) =>
    vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m);
}

// רישום הודעה פנימית למשתמש (מופיעה במרכז ההודעות שלו)
async function postUserMessage(userId, { tenantId = null, kind = 'system', title, body, data = {} }, query = q) {
  const { rows } = await query(
    'INSERT INTO user_messages(user_id, tenant_id, kind, title, body, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at',
    [userId, tenantId, kind, title, body, data]);
  return rows[0];
}

// שליפת תבנית פעילה לפי מפתח ורינדורה; מחזיר null אם אין תבנית כזו
async function renderTemplateByKey(key, vars = {}) {
  const { rows } = await q('SELECT * FROM message_templates WHERE key=$1 AND active=true', [key]);
  if (!rows[0]) return null;
  const t = rows[0];
  return { template: t, title: renderTemplate(t.title, vars), body: renderTemplate(t.body, vars) };
}

// N7: כנ"ל אבל מכבד את העדפת order_messages של המשתמש (דף הגדרות ההתראות)
async function postOrderMessage(userId, msg) {
  try {
    const { rows } = await q('SELECT order_messages FROM user_notification_prefs WHERE user_id=$1', [userId]);
    if (rows[0] && rows[0].order_messages === false) return null;
  } catch (e) { /* טעות קריאה — לא חוסמים */ }
  return postUserMessage(userId, msg);
}

module.exports = { renderTemplate, renderTemplateByKey, postUserMessage, postOrderMessage };
