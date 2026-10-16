// E9.T3: רישום מנויי push מהאפליקציה
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { publicKey } = require('../push');

const r = express.Router();

r.get('/push/vapid-public-key', async (req, res) => {
  res.json({ key: await publicKey() });
});

function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 500) return false;
  try {
    const u = new URL(sub.endpoint);
    if (u.protocol !== 'https:') return false; // שירותי push לגיטימיים הם https בלבד
  } catch { return false; }
  const k = sub.keys || {};
  const b64u = /^[A-Za-z0-9\-_]+={0,2}$/;
  return typeof k.p256dh === 'string' && k.p256dh.length <= 200 && b64u.test(k.p256dh)
      && typeof k.auth === 'string' && k.auth.length <= 100 && b64u.test(k.auth);
}

r.post('/push/subscribe', requireAuth, async (req, res) => {
  const sub = (req.body || {}).subscription;
  if (!validSubscription(sub))
    return res.status(400).json({ error: 'מנוי לא תקין' });
  await q(
    `INSERT INTO push_subscriptions(user_id, endpoint, keys) VALUES ($1,$2,$3)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, keys=$3`,
    [req.user.id, sub.endpoint, JSON.stringify(sub.keys)]);
  res.status(201).json({ ok: true });
});

r.post('/push/unsubscribe', requireAuth, async (req, res) => {
  const endpoint = (req.body || {}).endpoint;
  if (endpoint) await q('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [endpoint, req.user.id]);
  res.json({ ok: true });
});

module.exports = r;
