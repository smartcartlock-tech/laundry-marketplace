// שליחת הודעות וואטסאפ דרך הבוט של CleanShop (או Twilio כשהבוט לא מוגדר). נופל בשקט ל-log בלבד.
// כללי בטיחות (ממצאי בודק בוט, אוקט 26 + שומר G5 של אפיק A — רשימת היתר אחת משותפת):
//  * כשהבוט מוגדר — הוא הערוץ היחיד. אין נפילה ל-Twilio ישיר אחרי דחייה/כשל של הבוט (רשימת ההיתר שלו לא נעקפת).
//  * במצב demo — שליחה ישירה ב-Twilio רק ל-DEMO_NOTIFY_ALLOWLIST (config; ב-render.yaml: מספר חיים); השאר סימולציה בלוג.
//  * ל-fetch יוצא יש timeout של 5 שניות.
const { q } = require('./db');
const { sendPushToUser } = require('./push');
const { isDemo, DEMO_NOTIFY_ALLOWLIST } = require('./config');

let twilioClient = null;
function twilio() {
  if (twilioClient !== null) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (sid && tok) { try { twilioClient = require('twilio')(sid, tok); return twilioClient; } catch (e) { /* fall */ } }
  twilioClient = false;
  return false;
}

function botConfigured() {
  return !!(process.env.BOT_OUTBOUND_URL && process.env.BOT_OUTBOUND_KEY);
}

// E10.T4: שליחה יזומה דרך הבוט של CleanShop — הוא בעל המספר והסשן, אז ההודעה יוצאת ממנו.
// מופעל רק כש-BOT_OUTBOUND_URL + BOT_OUTBOUND_KEY מוגדרים.
async function sendViaBot(toE164, body, tag) {
  const url = process.env.BOT_OUTBOUND_URL, key = process.env.BOT_OUTBOUND_KEY;
  if (!url || !key) return { sent: false, reason: 'bot-not-configured' };
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/api/outbound/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-outbound-key': key },
      body: JSON.stringify({ to: toE164, body, tag }),
      signal: AbortSignal.timeout(5000), // ממצא 2: לא להיתקע בלי timeout
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && (d.status === 'sent' || d.status === 'simulated')) return { sent: d.status === 'sent', via: `bot-${d.status}` };
    return { sent: false, reason: d.error || d.status || `http-${r.status}` };
  } catch (e) {
    console.warn('[notify] bot outbound failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

async function sendWhatsApp(toE164, body) {
  // ממצא 1: כשהבוט מוגדר הוא הערוץ היחיד — דחייה/כשל שלו סופיים, בלי עקיפה דרך Twilio ישיר.
  if (botConfigured()) return sendViaBot(toE164, body, 'notify');
  // G5 + ממצא 1: בדמו, שליחה ישירה ב-Twilio רק לרשימת ההיתר — אחרת סימולציה בלוג, לא פונים לאנשים אמיתיים.
  if (isDemo && !DEMO_NOTIFY_ALLOWLIST.includes(toE164)) {
    console.log(`[notify] demo: שליחה אמיתית ל-${toE164} נחסמה (לא ב-DEMO_NOTIFY_ALLOWLIST) — סומנה כסימולציה`);
    return { sent: false, simulated: true, reason: 'demo-not-allowlisted' };
  }
  const client = twilio();
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886
  if (!client || !from) return { sent: false, reason: 'twilio-not-configured' };
  try {
    await client.messages.create({ from, to: `whatsapp:${toE164}`, body });
    return { sent: true };
  } catch (e) {
    console.warn('[notify] whatsapp failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

const { statusMuted } = require('./notification-prefs'); // CX5

async function notifyUser(userId, tenantId, body, phone, title) {
  let sent = false, channel = 'log';
  // CX5: הלקוח השתיק עדכוני סטטוס — נרשם כ-muted, לא נשלח דבר
  if (await statusMuted(userId)) {
    await q('INSERT INTO notifications(user_id, tenant_id, channel, body, sent) VALUES ($1,$2,$3,$4,$5)', [userId, tenantId, 'muted', body, false]).catch(() => {});
    return;
  }
  // N7: שקט בשבת וחגים (אופט-אין בדף ההגדרות) — נרשם כ-shabbat-muted, לא נשלח דבר
  if (await require('./shabbat').shabbatMuted(userId)) {
    await q('INSERT INTO notifications(user_id, tenant_id, channel, body, sent) VALUES ($1,$2,$3,$4,$5)', [userId, tenantId, 'shabbat-muted', body, false]).catch(() => {});
    return;
  }
  // E9.T3: ניסיון push קודם — נפילה חזרה לוואטסאפ/לוג רק אם ה-push לא הצליח (ממצא 6: לא דורסים sent מוצלח)
  try { const p = await sendPushToUser(userId, { title: title || 'מכבסה בקליק', body }); if (p.sent > 0) { sent = true; channel = 'push'; } } catch (e) {}
  if (!sent && phone) {
    const r = await sendWhatsApp(phone, body);
    if (r.sent || r.via === 'bot-simulated') { sent = true; channel = 'whatsapp'; }
  }
  await q('INSERT INTO notifications(user_id, tenant_id, channel, body, sent) VALUES ($1,$2,$3,$4,$5)',
    [userId, tenantId, channel, body, sent]);
  require('./usermessages').postOrderMessage(userId, { tenantId, kind: 'order', title: title || 'עדכון מהמכבסה', body }).catch(() => {}); // N6+N7: מראה במרכז ההודעות (מכבד העדפת order_messages)
}

module.exports = { sendWhatsApp, sendViaBot, notifyUser };
