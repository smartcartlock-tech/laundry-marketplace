// CX5: העדפות התראות — ברירת מחדל הכל פעיל; שורה קיימת רק אחרי שינוי ראשון
const { q } = require('./db');

async function getPrefs(userId) {
  const { rows } = await q('SELECT status_updates, marketing FROM user_notification_prefs WHERE user_id=$1', [userId]);
  return rows[0] || { status_updates: true, marketing: true };
}

async function setPrefs(userId, patch) {
  const cur = await getPrefs(userId);
  const status = typeof patch.status_updates === 'boolean' ? patch.status_updates : cur.status_updates;
  const mkt = typeof patch.marketing === 'boolean' ? patch.marketing : cur.marketing;
  await q(`INSERT INTO user_notification_prefs(user_id, status_updates, marketing, updated_at) VALUES ($1,$2,$3,now())
           ON CONFLICT (user_id) DO UPDATE SET status_updates=$2, marketing=$3, updated_at=now()`, [userId, status, mkt]);
  return { status_updates: status, marketing: mkt };
}

// האם עדכון סטטוס מושתק ללקוח (קריאה בנקודת החנק של notifyUser)
async function statusMuted(userId) {
  try { return !(await getPrefs(userId)).status_updates; } catch (e) { return false; }
}

module.exports = { getPrefs, setPrefs, statusMuted };
