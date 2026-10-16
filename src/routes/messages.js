// N1: מרכז הודעות בתוך האפליקציה — קריאת ההודעות הפנימיות של המשתמש וסימון נקרא.
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();
r.use(requireAuth);

r.get('/', async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT m.id, m.kind, m.title, m.body, m.data, m.read_at, m.created_at, t.name AS tenant_name
       FROM user_messages m LEFT JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id=$1 ORDER BY m.created_at DESC LIMIT 50`, [req.user.id]);
    const { rows: c } = await q('SELECT count(*)::int AS n FROM user_messages WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
    res.json({ messages: rows, unread: c[0].n });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.get('/unread-count', async (req, res) => {
  try {
    const { rows } = await q('SELECT count(*)::int AS n FROM user_messages WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
    res.json({ unread: rows[0].n });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.post('/:id/read', async (req, res) => {
  try {
    const { rowCount } = await q('UPDATE user_messages SET read_at=now() WHERE id=$1 AND user_id=$2 AND read_at IS NULL', [req.params.id, req.user.id]);
    res.json({ ok: true, updated: rowCount });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.post('/read-all', async (req, res) => {
  try {
    const { rowCount } = await q('UPDATE user_messages SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
    res.json({ ok: true, updated: rowCount });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
