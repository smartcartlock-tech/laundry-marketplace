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

// N7: אישורים מפורשים ממתינים (ביטול/שינוי חלון) — בזיכרון, תפוגה 2 דקות. סימולציה, לא production-grade state.
const pending = new Map();
function pendKey(user, req, code) { return `${user ? user.id : 'anon'}:${code}`; } // הקוד עצמו הוא גורם האימות — לא תלוי IP (פרוקسي משתנה)
function setPending(k, v) { pending.set(k, { ...v, exp: Date.now() + 2 * 60 * 1000 }); }
function takePending(k) { const v = pending.get(k); if (!v) return null; if (v.exp < Date.now()) { pending.delete(k); return null; } pending.delete(k); return v; }

const ST_HE = { new: 'חדשה', confirmed: 'אושרה', picked_up: 'נאספה', in_work: 'בעבודה', ready: 'מוכנה', out_for_delivery: 'בדרך אליך', delivered: 'נמסרה', cancelled: 'בוטלה' };

async function findOrderByCode(code) {
  const { rows } = await q(
    `SELECT o.id, o.status, o.pickup_at, o.tracking_code, t.name AS tenant_name FROM orders o
     JOIN tenants t ON t.id=o.tenant_id WHERE o.tracking_code=upper($1)`, [code]);
  return rows[0] || null;
}

// N8: תפריט קצר ופשוט — דוגמאות מוכנות להקלדה במקום רשימה ארוכה
function menuText() {
  return 'אפשר לכתוב לי למשל:\n• "מחירון"\n• "שעות פתיחה של האחוזה"\n• "איפה ההזמנה A1B2C3D4"\n• "בטל הזמנה A1B2C3D4"\n• "סיכום יומי" (לבעלי מכבסה)';
}

async function botReply(message, user, req) {
  const m = String(message || '').trim();
  const low = m.toLowerCase();
  if (!m) return { reply: 'לא קיבלתי הודעה. נסו לכתוב משהו 🙂' };
  if (/^(שלום|היי|הי|אהלן|בוקר טוב|ערב טוב|hello|hi)(?![a-z\u0590-\u05ff])/.test(low)) {
    return { reply: `שלום${user ? ' ' + user.name : ''}! 👋 אני בוט להדגמה (סימולציה בלבד — לא נשלחת שום הודעה אמיתית).\n` + menuText() };
  }
  // N7: ביטול הזמנה / שינוי חלון איסוף — רק לפי קוד מעקב ורק עם אישור מפורש בשני צעדים
  const codeM = (m.match(/[0-9A-Fa-f]{8}/) || [])[0];
  if (/^(אישור ביטול|מאשר ביטול)/.test(low) && codeM) {
    const p = takePending(pendKey(user, req, codeM));
    if (!p || p.action !== 'cancel') return { reply: `אין בקשת ביטול ממתינה לקוד ${codeM.toUpperCase()}. כתבו "בטל הזמנה ${codeM.toUpperCase()}" כדי להתחיל.` };
    const o = p.order;
    // נעילה אופטימית: מבטלים רק אם הסטטוס עדיין new/confirmed ברגע האישור — מנצח אחד בלבד ב-race
    const { rowCount } = await q("UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1 AND status IN ('new','confirmed')", [o.id]);
    if (!rowCount) {
      const cur = await findOrderByCode(codeM);
      return { reply: `ההזמנה כבר בסטטוס "${ST_HE[cur ? cur.status : ''] || 'לא ידוע'}" — הביטול לא בוצע (ייתכן שאושר או בוטל במקביל).` };
    }
    await q("INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,'cancelled',$2,'בוטל דרך סימולציית הבוט באישור מפורש')", [o.id, user ? user.id : null]);
    return { reply: `ההזמנה אצל ${o.tenant_name} (קוד ${codeM.toUpperCase()}) בוטלה ✅ (סימולציה — נתוני דמו).` };
  }
  if (/^(אישור שינוי|מאשר שינוי)/.test(low) && codeM) {
    const p = takePending(pendKey(user, req, codeM));
    const pick = (m.match(/([1-3])(?![0-9])/) || [])[1];
    if (!p || p.action !== 'reschedule' || !pick) return { reply: `אין בקשת שינוי ממתינה לקוד ${codeM.toUpperCase()}. כתבו "שנה חלון איסוף ${codeM.toUpperCase()}" כדי לראות אפשרויות.` };
    const slot = p.options[Number(pick) - 1];
    const { rowCount } = await q("UPDATE orders SET pickup_at=$1, updated_at=now() WHERE id=$2 AND status NOT IN ('delivered','cancelled')", [slot.at, p.order.id]);
    if (!rowCount) return { reply: 'ההזמנה כבר נמסרה או בוטלה במקביל — חלון האיסוף לא שונה.' };
    await q("INSERT INTO order_events(order_id, status, actor_id, note) VALUES ($1,$2,$3,$4)", [p.order.id, p.order.status, user ? user.id : null, `חלון איסוף שונה דרך סימולציית הבוט ל-${slot.label}`]);
    return { reply: `חלון האיסוף להזמנה ${codeM.toUpperCase()} עודכן: ${slot.label} ✅ (סימולציה — נתוני דמו).` };
  }
  if (low.includes('בטל') && codeM) {
    const o = await findOrderByCode(codeM);
    if (!o) return { reply: `לא מצאתי הזמנה עם קוד מעקב ${codeM.toUpperCase()}.` };
    if (!['new', 'confirmed'].includes(o.status)) return { reply: `ההזמנה אצל ${o.tenant_name} בסטטוס "${ST_HE[o.status] || o.status}" — אי אפשר לבטל דרך הבוט, רק דרך המכבסה.` };
    setPending(pendKey(user, req, codeM), { action: 'cancel', order: o });
    return { reply: `⚠️ ביטול הזמנה אצל ${o.tenant_name} (סטטוס נוכחי: ${ST_HE[o.status] || o.status}). לאישור מפורש שלחו בדיוק: "אישור ביטול ${codeM.toUpperCase()}". הבקשה בתוקף ל-2 דקות.` };
  }
  if ((low.includes('שנה') || low.includes('שינוי') || low.includes('חלון')) && codeM && !low.includes('אישור')) {
    const o = await findOrderByCode(codeM);
    if (!o) return { reply: `לא מצאתי הזמנה עם קוד מעקב ${codeM.toUpperCase()}.` };
    if (['delivered', 'cancelled'].includes(o.status)) return { reply: `ההזמנה בסטטוס "${ST_HE[o.status]}" — לא ניתן לשנות חלון איסוף.` };
    const base = new Date(); const opts = [];
    for (let d = 1; d <= 3 && opts.length < 3; d++) {
      const day = new Date(base.getTime() + d * 24 * 3600 * 1000);
      const label = day.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
      opts.push({ at: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), d % 2 ? 8 : 13)), label: `${label} ${d % 2 ? '08:00–12:00' : '12:00–17:00'}` });
    }
    setPending(pendKey(user, req, codeM), { action: 'reschedule', order: o, options: opts });
    return { reply: `אפשרויות חלון איסוף חדש להזמנה ${codeM.toUpperCase()} אצל ${o.tenant_name}:\n` + opts.map((o2, i) => `${i + 1}) ${o2.label}`).join('\n') + `\nלאישור מפורש שלחו: "אישור שינוי ${codeM.toUpperCase()} <מספר האפשרות>". בתוקף ל-2 דקות.` };
  }
  // N7: סיכום יומי לבעל מכבסה (תבנית owner_daily_summary, סימולציה בלבד)
  if (low.includes('סיכום') && (low.includes('יומי') || low.includes('היום'))) {
    if (!user) return { reply: 'סיכום יומי זמין לבעלי מכבסה מחוברים בלבד (בסימולציה אפשר להתחבר עם קוד הדמו).' };
    const { rows: mem } = await q('SELECT tenant_id FROM tenant_members WHERE user_id=$1 LIMIT 1', [user.id]);
    if (!mem[0]) return { reply: 'החשבון הזה לא משויך למכבסה, אז אין סיכום יומי להציג.' };
    const { rows: agg } = await q(
      `SELECT count(*)::int AS n, coalesce(sum(total) FILTER (WHERE status<>'cancelled'),0)::numeric(10,2) AS rev,
              count(*) FILTER (WHERE status='cancelled')::int AS cancelled
       FROM orders WHERE tenant_id=$1 AND (created_at AT TIME ZONE 'Asia/Jerusalem')::date = (now() AT TIME ZONE 'Asia/Jerusalem')::date`, [mem[0].tenant_id]);
    const { renderTemplateByKey, postUserMessage } = require('../usermessages');
    const dateHe = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
    const vars = { 'תאריך': dateHe, 'מספר_הזמנות': agg[0].n, 'הכנסה': agg[0].rev, 'חריגים': agg[0].cancelled ? `${agg[0].cancelled} ביטולים` : 'אין' };
    const t = await renderTemplateByKey('owner_daily_summary', vars);
    const body = t ? t.body : `סיכום יומי: ${agg[0].n} הזמנות, ₪${agg[0].rev}.`;
    await postUserMessage(user.id, { tenantId: mem[0].tenant_id, kind: 'template', title: t ? t.title : 'סיכום יומי', body }).catch(() => {});
    return { reply: body + '\n(נשמר גם במרכז ההודעות שלך — סימולציה בלבד)' };
  }
  // N6: "איפה ההזמנה שלי" לפי קוד מעקב (tracking_code — 8 תווים hex, מודפס על אישור ההזמנה)
  if (low.includes('איפה') || low.includes('מעקב') || low.includes('track')) {
    const code = (m.match(/[0-9A-Fa-f]{6,8}/) || [])[0];
    if (!code) return { reply: 'כדי לבדוק איפה ההזמנה שלך, כתבו את קוד המעקב (8 ספרות/אותיות שמופיע באישור ההזמנה), למשל: "איפה ההזמנה A1B2C3D4".' };
    const { rows } = await q(
      `SELECT o.status, o.created_at, o.updated_at, t.name AS tenant_name FROM orders o
       JOIN tenants t ON t.id=o.tenant_id WHERE o.tracking_code=upper($1)`, [code]);
    const stHe = { new: 'חדשה', confirmed: 'אושרה', picked_up: 'נאספה', in_work: 'בעבודה', ready: 'מוכנה', out_for_delivery: 'בדרך אליך', delivered: 'נמסרה', cancelled: 'בוטלה' };
    if (!rows[0]) return { reply: `לא מצאתי הזמנה עם קוד מעקב ${code.toUpperCase()}. בדקו שהקוד מופיע כמו באישור ההזמנה ונסו שוב.` };
    const o = rows[0];
    return { reply: `ההזמנה שלך אצל ${o.tenant_name} (קוד ${code.toUpperCase()}) בסטטוס: ${stHe[o.status] || o.status}. עודכן לאחרונה ב-${new Date(o.updated_at).toLocaleString('he-IL')}.` };
  }
  if (low.includes('שעות') || low.includes('פתוח') || low.includes('סגור') || low.includes('פעילות')) {
    // N6: שעות פתיחה לפי מכבסה מסוימת — מחלצים את שם המכבסה מהמשפט ("שעות פתיחה של מכבסת דמו")
    const nameQ = m.replace(/^(מה )?(שעות|מתי|האם)\s*(ה)?(פתיחה|פתוח|סגור|פעילות|עבודה)?\s*(של|ב|ל|אצל)?/i, '').replace(/[?״"'.!]/g, '').trim();
    let t;
    if (nameQ && nameQ !== m.trim()) {
      const { rows } = await q('SELECT name, hours FROM tenants WHERE approved=true AND name ILIKE $1 ORDER BY name LIMIT 3', ['%' + nameQ.replace(/[%_]/g, '') + '%']);
      if (rows.length > 1) return { reply: 'מצאתי כמה מכבסות דמו דומות:\n' + rows.map(x => `• ${x.name}`).join('\n') + '\nעל איזו מהן לענות?' };
      t = rows;
    } else {
      const { rows } = await q('SELECT name, hours FROM tenants WHERE approved=true ORDER BY name LIMIT 1');
      t = rows;
    }
    if (!t[0]) return { reply: `לא מצאתי מכבסת דמו בשם "${nameQ}". כתבו "מכבסות" כדי לראות את הרשימה.` };
    if (!t[0].hours || !Object.keys(t[0].hours).length) return { reply: `ל-${t[0].name} לא הוזנו שעות פעילות (דמו).` };
    const lines = Object.entries(t[0].hours).map(([d, ranges]) =>
      `• יום ${DAY_HE[Number(d)] || d}: ${(ranges || []).map(([a, b]) => `${a}–${b}`).join(', ') || 'סגור'}`);
    return { reply: `שעות הפעילות של ${t[0].name} (דמו):\n` + lines.join('\n') };
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
  if (/^(עזרה|help|מה אפשר|איך)/.test(low)) return { reply: menuText() };
  return { reply: 'לא הבנתי 🤔\n' + menuText() };
}

r.post('/chat', limiter('botsim', 30, 10 * 60 * 1000, (req) => req.ip), async (req, res) => {
  try {
    const user = await optionalUser(req);
    const out = await botReply((req.body || {}).message, user, req);
    res.json({ simulated: true, reply: out.reply });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
