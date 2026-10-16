// ביקורת סשנים: לכל JWT נוצר jti שמגובה בשורת auth_sessions — מאפשר רשימת מכשירים, ניתוק מרחוק ותפוגה
const crypto = require('crypto');
const { q } = require('./db');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // כמו תוקף ה-JWT

async function createSession(req, userId) {
  const jti = crypto.randomUUID();
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  await q('INSERT INTO auth_sessions(user_id, jti, user_agent, ip, expires_at) VALUES ($1,$2,$3,$4,$5)',
    [userId, jti, ua, req.ip || null, new Date(Date.now() + SESSION_TTL_MS)]);
  return jti;
}

// מחזיר את שורת הסשן אם תקף, אחרת null. last_seen מתעדכן לכל היותר פעם ב-5 דקות כדי לא לכתוב בכל בקשה
async function checkSession(jti) {
  if (!jti) return null;
  const { rows } = await q(
    `UPDATE auth_sessions SET last_seen_at = CASE WHEN now() - last_seen_at > interval '5 minutes' THEN now() ELSE last_seen_at END
     WHERE jti=$1 AND revoked_at IS NULL AND expires_at > now() RETURNING *`, [jti]);
  return rows[0] || null;
}

module.exports = { createSession, checkSession };
