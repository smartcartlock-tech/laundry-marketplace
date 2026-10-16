// N7: דף הגדרות התראות מורחב — עדכוני סטטוס, הודעות הזמנה, שיווק, שקט בשבת וחגים.
// קורא/כותב את אותה טבלה של CX5 (user_notification_prefs) עם העמודות החדשות ממיגרציה 075.
const express = require('express');
const { requireAuth } = require('../auth');
const { q } = require('../db');
const { isQuietTime } = require('../shabbat');

const r = express.Router();
r.use(requireAuth);
r.use(require('../ratelimit').writeLimiter('notif-settings', 60));

const DEF = { status_updates: true, order_messages: true, marketing: true, quiet_shabbat: false };

r.get('/', async (req, res) => {
  try {
    const { rows } = await q('SELECT status_updates, order_messages, marketing, quiet_shabbat FROM user_notification_prefs WHERE user_id=$1', [req.user.id]);
    const now = isQuietTime();
    res.json({ prefs: { ...DEF, ...(rows[0] || {}) }, quiet_now: now.quiet, quiet_reason: now.reason || null });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.put('/', async (req, res) => {
  try {
    const b = req.body || {};
    for (const k of Object.keys(DEF)) {
      if (b[k] !== undefined && typeof b[k] !== 'boolean') return res.status(400).json({ error: `${k} חייב להיות boolean` });
    }
    const { rows } = await q('SELECT status_updates, order_messages, marketing, quiet_shabbat FROM user_notification_prefs WHERE user_id=$1', [req.user.id]);
    const cur = { ...DEF, ...(rows[0] || {}) };
    const next = { ...cur };
    for (const k of Object.keys(DEF)) if (b[k] !== undefined) next[k] = b[k];
    await q(`INSERT INTO user_notification_prefs(user_id, status_updates, order_messages, marketing, quiet_shabbat, updated_at)
             VALUES ($1,$2,$3,$4,$5,now())
             ON CONFLICT (user_id) DO UPDATE SET status_updates=$2, order_messages=$3, marketing=$4, quiet_shabbat=$5, updated_at=now()`,
      [req.user.id, next.status_updates, next.order_messages, next.marketing, next.quiet_shabbat]);
    res.json({ prefs: next });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
