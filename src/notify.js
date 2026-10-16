// שליחת הודעות וואטסאפ דרך Twilio (סנדבוקס/פרודקשן). נופל בשקט ל-log בלבד.
const { q } = require('./db');
const { sendPushToUser } = require('./push');

let twilioClient = null;
function twilio() {
  if (twilioClient !== null) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (sid && tok) { try { twilioClient = require('twilio')(sid, tok); return twilioClient; } catch (e) { /* fall */ } }
  twilioClient = false;
  return false;
}

// E10.T4: שליחה יזומה דרך הבוט של CleanShop — הוא בעל המספר והסשן, אז ההודעה יוצאת ממנו.
// מופעל רק כש-BOT_OUTBOUND_URL + BOT_OUTBOUND_KEY מוגדרים; אחרת נופל ל-Twilio ישיר/לוג.
async function sendViaBot(toE164, body, tag) {
  const url = process.env.BOT_OUTBOUND_URL, key = process.env.BOT_OUTBOUND_KEY;
  if (!url || !key) return { sent: false, reason: 'bot-not-configured' };
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/api/outbound/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-outbound-key': key },
      body: JSON.stringify({ to: toE164, body, tag }),
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
  const viaBot = await sendViaBot(toE164, body, 'notify');
  if (viaBot.sent || viaBot.via === 'bot-simulated') return viaBot;
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

async function notifyUser(userId, tenantId, body, phone) {
  let sent = false, channel = 'log';
  // E9.T3: ניסיון push קודם — נפילה חזרה לוואטסאפ/לוג
  try { const p = await sendPushToUser(userId, { title: 'מכבסה בקליק', body }); if (p.sent > 0) { sent = true; channel = 'push'; } } catch (e) {}
  if (phone) {
    const r = await sendWhatsApp(phone, body);
    sent = r.sent; channel = 'whatsapp';
  }
  await q('INSERT INTO notifications(user_id, tenant_id, channel, body, sent) VALUES ($1,$2,$3,$4,$5)',
    [userId, tenantId, channel, body, sent]);
}

module.exports = { sendWhatsApp, sendViaBot, notifyUser };
