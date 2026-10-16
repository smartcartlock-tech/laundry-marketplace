// N3: סימולציית צ'אט של הבוט — מסך הדגמה שמדמה שיחה עם הבוט מול נתוני הדמו בלבד.
// אין כאן שום חיבור ל-Twilio/וואטסאפ/בוט אמיתי; כל תשובה נוצרת מקומית ומסומנת כסימולציה.
const express = require('express');
const jwt = require('jsonwebtoken');
const { q } = require('../db');
const { limiter } = require('../ratelimit');

const r = express.Router();

// אימות אופציונלי: אם יש טוקן תקין — מפרסנלים (סטטוס הזמנה); אם לא — סימולציה אנונימית על נתוני דמו.
async function optionalUser(req) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const secret = process.env.JWT_SECRET || ((process.env.NODE_ENV === 'test' || process.env.PGSCHEMA) ? 'test-secret' : null);
    if (!secret) return null;
    const payload = jwt.verify(h.slice(7), secret);
    const { rows } = await q('SELECT * FROM users WHERE id=$1', [payload.uid]);
    if (!rows[0] || (payload.tv ?? -1) !== rows[0].token_version) return null;
    return rows[0];
  } catch (e) { return null; }
}

const DAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function menuText() {
  return 'אני בוט להדגמה (סימולציה בלבד — לא נשלחת שום הודעה אמיתית). אפשר לשאול אותי:\n• "מכבסות" — רשימת מכבסות הדמו\n• "מחירון" — מחירון של מכבסת דמו\n• "שעות" — שעות פעילות\n• "סטטוס" — סטטוס ההזמנה האחרונה שלך (בכניסה מחוברת)';
}

async function botReply(message, user) {
  const m = String(message || '').trim();
  const low = m.toLowerCase();
  if (!m) return { reply: 'לא קיבלתי הודעה. נסו לכתוב משהו 🙂' };
  if (/^(שלום|היי|הי|אהלן|בוקר טוב|ערב טוב|hi|hello)\b/.test(low)) {
    return { reply: `שלום${user ? ' ' + user.name : ''}! 👋\n` + menuText() };
  }
  if (low.includes('מכבס')) {
    const { rows } = await q('SELECT name, city FROM tenants WHERE approved=true ORDER BY name LIMIT 5');
    if (!rows.length) return { reply: 'אין כרגע מכבסות פעילות להצגה.' };
    return { reply: 'הנה מכבסות הדמו הפעילות:\n' + rows.map(t => `• ${t.name} (${t.city || '—'})`).join('\n') };
  }
  if (low.includes('מחיר') || low.includes('עולה') || low.includes('תעריף')) {
    const { rows: t } = await q('SELECT id, name FROM tenants WHERE approved=true ORDER BY name LIMIT 1');
    if (!t[0]) return { reply: 'אין מכבסת דמו פעילה כרגע.' };
    const { rows } = await q('SELECT name, price, unit FROM price_items WHERE tenant_id=$1 AND active=true ORDER BY sort, name LIMIT 8', [t[0].id]);
    if (!rows.length) return { reply: `ל-${t[0].name} עוד אין מחירון פעיל.` };
    const unitHe = { item: 'לפריט', kg: 'לק"ג', bag: 'לשק' };
    return { reply: `מחירון ${t[0].name} (נתוני דמו):\n` + rows.map(i => `• ${i.name} — ₪${i.price} ${unitHe[i.unit] || ''}`).join('\n') };
  }
  if (low.includes('שעות') || low.includes('פתוח') || low.includes('סגור') || low.includes('פעילות')) {
    const { rows: t } = await q('SELECT name, hours FROM tenants WHERE approved=true ORDER BY name LIMIT 1');
    if (!t[0] || !t[0].hours || !Object.keys(t[0].hours).length) return { reply: 'אין שעות פעילות מוזנות למכבסת הדמו.' };
    const lines = Object.entries(t[0].hours).map(([d, ranges]) =>
      `• יום ${DAY_HE[Number(d)] || d}: ${(ranges || []).map(([a, b]) => `${a}–${b}`).join(', ') || 'סגור'}`);
    return { reply: `שעות הפעילות של ${t[0].name} (דמו):\n` + lines.join('\n') };
  }
  if (low.includes('סטטוס') || low.includes('הזמנה') || low.includes('order')) {
    if (!user) return { reply: 'כדי לראות סטטוס הזמנה צריך להתחבר קודם (בסימולציה אפשר עם קוד הדמו שמוצג במסך הכניסה).' };
    const { rows } = await q(
      `SELECT o.id, o.status, o.created_at, t.name AS tenant_name FROM orders o
       JOIN tenants t ON t.id=o.tenant_id WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 1`, [user.id]);
    if (!rows[0]) return { reply: 'לא נמצאו הזמנות בחשבון הזה. אפשר ליצור הזמנת דמו דרך האפליקציה 🙂' };
    const stHe = { new: 'חדשה', confirmed: 'אושרה', picked_up: 'נאספה', in_work: 'בעבודה', ready: 'מוכנה', out_for_delivery: 'בדרך אליך', delivered: 'נמסרה', cancelled: 'בוטלה' };
    const o = rows[0];
    return { reply: `ההזמנה האחרונה שלך אצל ${o.tenant_name} בסטטוס: ${stHe[o.status] || o.status} (נפתחה ב-${new Date(o.created_at).toLocaleDateString('he-IL')}).` };
  }
  if (low.includes('תודה')) return { reply: 'בשמחה! 🙏 זכרו — זו סימולציה להדגמה בלבד.' };
  return { reply: 'לא הבנתי את הבקשה 🤔\n' + menuText() };
}

r.post('/chat', limiter('botsim', 30, 10 * 60 * 1000, (req) => req.ip), async (req, res) => {
  try {
    const user = await optionalUser(req);
    const out = await botReply((req.body || {}).message, user);
    res.json({ simulated: true, reply: out.reply });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
