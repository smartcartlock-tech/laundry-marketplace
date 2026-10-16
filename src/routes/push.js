// E9.T3: רישום מנויי push מהאפליקציה
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { publicKey } = require('../push');

const r = express.Router();

r.get('/push/vapid-public-key', async (req, res) => {
  res.json({ key: await publicKey() });
});

r.post('/push/subscribe', requireAuth, async (req, res) => {
  const sub = (req.body || {}).subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth)
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
