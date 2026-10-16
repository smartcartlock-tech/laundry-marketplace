// שליחת הודעות וואטסאפ דרך Twilio (סנדבוקס/פרודקשן). נופל בשקט ל-log בלבד.
const { q } = require('./db');

let twilioClient = null;
function twilio() {
  if (twilioClient !== null) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (sid && tok) { try { twilioClient = require('twilio')(sid, tok); return twilioClient; } catch (e) { /* fall */ } }
  twilioClient = false;
  return false;
}

async function sendWhatsApp(toE164, body) {
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
  if (phone) {
    const r = await sendWhatsApp(phone, body);
    sent = r.sent; channel = 'whatsapp';
  }
  await q('INSERT INTO notifications(user_id, tenant_id, channel, body, sent) VALUES ($1,$2,$3,$4,$5)',
    [userId, tenantId, channel, body, sent]);
}

module.exports = { sendWhatsApp, notifyUser };
