// A4 (מוצר): ספק OTP מוחלף — הממשק היחיד לשליחת קוד כניסה.
// OTP_PROVIDER=auto (ברירת מחדל): whatsapp/בוט אם מוגדר, אחרת demo (במצב demo בלבד).
// OTP_PROVIDER=whatsapp|bot: כופה שליחה אמיתית דרך notify (הבוט מקבל עדיפות שם) — כשל = sent:false.
// OTP_PROVIDER=demo: עוקף שליחה — חוקי רק במצב demo; ב-pilot נחסם כדי שלא יוצג קוד על המסך.
const { sendWhatsApp } = require('./notify');
const { sendSms, inforuConfigured } = require('./sms-inforu');
const { isDemo } = require('./config');

// T86: מספרי הדמו של המערכת — תמיד מקבלים קוד על המסך ולא שולחים אליהם SMS אמיתי,
// כדי שהדמו והבדיקות ימשיכו לעבוד גם כשהספק האמיתי דולק.
const DEMO_PHONES = new Set((process.env.DEMO_OTP_PHONES || '+972500000001,+972500000002,+972500000003,+972500000004,+972500000031')
  .split(',').map(s => s.trim()).filter(Boolean));

function whatsappConfigured() {
  return !!((process.env.BOT_OUTBOUND_URL && process.env.BOT_OUTBOUND_KEY) ||
    (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM));
}

// target: E164 phone (או email — כרגע ללא ספק דואר, נופל לדמו); demoOtp: האם מותר להציג קוד דמו.
// מחזיר {sent, channel, demoCode?} — sent=false משמעו 503 ללקוח.
async function sendCode(target, code, { kind = 'phone', demoOtp = false } = {}) {
  const provider = (process.env.OTP_PROVIDER || 'auto').trim();
  // T86: Inforu — מספרי דמו לא מקבלים SMS אמיתי וממשיכים עם קוד על המסך
  if (kind === 'phone' && DEMO_PHONES.has(target) && demoOtp) {
    return { sent: true, channel: 'demo', demoCode: code };
  }
  const wantInforu = provider === 'inforu' || (provider === 'auto' && inforuConfigured());
  if (wantInforu && kind === 'phone') {
    const minutes = Number(process.env.OTP_EXPIRY_MINUTES || 5);
    const text = (process.env.OTP_MESSAGE_TEMPLATE || 'קוד האימות שלך הוא: {CODE}. הקוד תקף ל-{MINUTES} דקות.')
      .replace('{CODE}', code).replace('{MINUTES}', String(minutes));
    const r = await sendSms(target, text);
    if (r.sent) return { sent: true, channel: 'sms' }; // בלי demoCode — קוד אמיתי לא מוצג על המסך
    if (provider === 'inforu') return { sent: false, channel: 'sms', reason: r.reason };
  }
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

module.exports = { sendCode, whatsappConfigured, DEMO_PHONES };
