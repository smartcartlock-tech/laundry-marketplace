// A4 (מוצר): ספק OTP מוחלף — הממשק היחיד לשליחת קוד כניסה.
// OTP_PROVIDER=auto (ברירת מחדל): whatsapp/בוט אם מוגדר, אחרת demo (במצב demo בלבד).
// OTP_PROVIDER=whatsapp|bot: כופה שליחה אמיתית דרך notify (הבוט מקבל עדיפות שם) — כשל = sent:false.
// OTP_PROVIDER=demo: עוקף שליחה — חוקי רק במצב demo; ב-pilot נחסם כדי שלא יוצג קוד על המסך.
const { sendWhatsApp } = require('./notify');
const { isDemo } = require('./config');

function whatsappConfigured() {
  return !!((process.env.BOT_OUTBOUND_URL && process.env.BOT_OUTBOUND_KEY) ||
    (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM));
}

// target: E164 phone (או email — כרגע ללא ספק דואר, נופל לדמו); demoOtp: האם מותר להציג קוד דמו.
// מחזיר {sent, channel, demoCode?} — sent=false משמעו 503 ללקוח.
async function sendCode(target, code, { kind = 'phone', demoOtp = false } = {}) {
  const provider = (process.env.OTP_PROVIDER || 'auto').trim();
  const wantReal = provider === 'whatsapp' || provider === 'bot' || (provider === 'auto' && whatsappConfigured());
  if (wantReal && kind === 'phone') {
    const r = await sendWhatsApp(target, `קוד הכניסה שלך ל״מכבסה בקליק״: ${code}`);
    if (r.sent) return { sent: true, channel: 'whatsapp', demoCode: demoOtp ? code : undefined };
    // ממצא 6: הבוט בסימולציה (סנדבוקס) — ההודעה טופלה, לא להחזיר 503
    if (r.via === 'bot-simulated') return { sent: true, channel: 'whatsapp-sim', demoCode: demoOtp ? code : undefined };
    if (provider !== 'auto') return { sent: false, channel: 'whatsapp', reason: r.reason };
  }
  // demo מותר רק במצב demo — ב-pilot לעולם לא מוצג קוד (A2)
  if (demoOtp && isDemo) return { sent: true, channel: 'demo', demoCode: code };
  return { sent: false, channel: 'demo', reason: 'no-provider' };
}

module.exports = { sendCode, whatsappConfigured };
