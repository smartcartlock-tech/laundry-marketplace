// מועדפים מסונכרנים לחשבון — המשך של המועדפים המקומיים (E13.T6): אותם מועדפים בכל מכשיר כשמחוברים
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();
r.use(requireAuth);

r.get('/', async (req, res) => {
  const { rows } = await q(
    `SELECT t.slug, t.name, t.color, t.letter, uf.created_at
     FROM user_favorites uf JOIN tenants t ON t.id = uf.tenant_id
     WHERE uf.user_id=$1 ORDER BY uf.created_at DESC`, [req.user.id]);
  res.json({ favorites: rows });
});

r.post('/', async (req, res) => {
  const slug = String((req.body || {}).slug || '').slice(0, 80);
  if (!slug) return res.status(400).json({ error: 'חסר slug' });
  const { rows: t } = await q('SELECT id FROM tenants WHERE slug=$1 AND approved', [slug]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  await q('INSERT INTO user_favorites(user_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, t[0].id]);
  res.json({ ok: true });
});

r.delete('/:slug', async (req, res) => {
  const { rowCount } = await q(
    'DELETE FROM user_favorites uf USING tenants t WHERE uf.user_id=$1 AND uf.tenant_id=t.id AND t.slug=$2',
    [req.user.id, String(req.params.slug).slice(0, 80)]);
  res.json({ ok: true, removed: rowCount > 0 });
});

module.exports = r;
