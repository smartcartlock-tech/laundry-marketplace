// T86: מתאם SMS של Inforu (api v2). אימות Basic עם INFORU_USERNAME/INFORU_PASSWORD.
// אף פעם לא מדפיסים/רושמים את הסוד. SMS_SENDER_ID חייב להיות רשום אצל Inforu.
const SEND_URL = process.env.INFORU_BASE_URL || 'https://capi.inforu.co.il/api/v2/SMS/SendSms';

function inforuConfigured() {
  return !!(process.env.INFORU_USERNAME && process.env.INFORU_PASSWORD);
}

// phone: E164 ישראלי (+9725...) → מקומי (05...) כמקובל אצל Inforu
function toLocal(phone) {
  return phone.startsWith('+972') ? '0' + phone.slice(4) : phone;
}

// מחזיר {sent, reason?} — לעולם לא זורק; שגיאת רשת/ספק = sent:false
async function sendSms(phone, text) {
  if (!inforuConfigured()) return { sent: false, reason: 'not-configured' };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10000);
  try {
    const resp = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': 'Basic ' + Buffer.from(`${process.env.INFORU_USERNAME}:${process.env.INFORU_PASSWORD}`).toString('base64'),
      },
      body: JSON.stringify({
        Data: {
          Message: text,
          Recipients: [{ Phone: toLocal(phone) }],
          Settings: { Sender: process.env.SMS_SENDER_ID || 'ClickLndry' },
        },
      }),
      signal: ac.signal,
    });
    const j = await resp.json().catch(() => null);
    if (resp.ok && j && j.StatusId === 1) return { sent: true };
    return { sent: false, reason: `inforu:${resp.status}:${j && j.StatusDescription ? j.StatusDescription : 'unknown'}` };
  } catch (e) {
    return { sent: false, reason: 'inforu:' + (e.name === 'AbortError' ? 'timeout' : 'network') };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { sendSms, inforuConfigured };
