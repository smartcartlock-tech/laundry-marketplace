// CX5: העדפות התראות של הלקוח המחובר
const express = require('express');
const { requireAuth } = require('../auth');
const { getPrefs, setPrefs } = require('../notification-prefs');

const r = express.Router();

r.get('/', requireAuth, async (req, res) => res.json(await getPrefs(req.user.id)));
r.put('/', requireAuth, async (req, res) => {
  const { status_updates, marketing } = req.body || {};
  if (status_updates !== undefined && typeof status_updates !== 'boolean') return res.status(400).json({ error: 'status_updates חייב להיות boolean' });
  if (marketing !== undefined && typeof marketing !== 'boolean') return res.status(400).json({ error: 'marketing חייב להיות boolean' });
  res.json(await setPrefs(req.user.id, { status_updates, marketing }));
});

module.exports = r;
