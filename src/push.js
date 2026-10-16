// E9.T3: שליחת Web Push עם מפתחות VAPID עצמיים (בחינם, ללא שירות חיצוני בתשלום).
// נפילה חזרה: כל כשל נרשם ב-console בלבד — ה-notification בטבלה נשמר תמיד (notify.js).
const webpush = require('web-push');
const { q } = require('./db');

let ready = false;

async function ensureVapid() {
  if (ready) return;
  let { rows } = await q(`SELECT key, value FROM platform_settings WHERE key IN ('vapid_public','vapid_private')`, []);
  let pub = rows.find(r => r.key === 'vapid_public')?.value;
  let priv = rows.find(r => r.key === 'vapid_private')?.value;
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey; priv = keys.privateKey;
    await q(`INSERT INTO platform_settings(key, value) VALUES ('vapid_public',$1), ('vapid_private',$2)
             ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [pub, priv]);
  }
  webpush.setVapidDetails('mailto:admin@laundry.local', pub, priv);
  ready = true;
}

async function publicKey() { await ensureVapid(); const { rows } = await q(`SELECT value FROM platform_settings WHERE key='vapid_public'`, []); return rows[0].value; }

async function sendPushToUser(userId, payload) {
  try {
    await ensureVapid();
    const { rows } = await q('SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id=$1', [userId]);
    let sent = 0;
    for (const sub of rows) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload));
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await q('DELETE FROM push_subscriptions WHERE id=$1', [sub.id]);
        else console.warn('[push] send failed:', e.message);
      }
    }
    return { attempted: rows.length, sent };
  } catch (e) { console.warn('[push] error:', e.message); return { attempted: 0, sent: 0 }; }
}

module.exports = { ensureVapid, publicKey, sendPushToUser };
