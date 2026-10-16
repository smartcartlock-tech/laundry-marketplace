const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { uuidParams } = require('../validate');

const r = express.Router();
r.use(requireAuth);

// E13.T2: כתובות שמורות של הלקוח — לבחירה מהירה בצ׳ק-אאוט
r.get('/', async (req, res) => {
  const { rows } = await q(
    'SELECT id, label, address, created_at FROM user_addresses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
    [req.user.id]);
  res.json({ addresses: rows });
});

r.post('/', async (req, res) => {
  const { label, address } = req.body || {};
  const addr = String(address || '').trim();
  if (!addr || addr.length < 5) return res.status(400).json({ error: 'כתובת חסרה או קצרה מדי' });
  if (addr.length > 200) return res.status(400).json({ error: 'כתובת ארוכה מדי' });
  const lbl = String(label || '').trim().slice(0, 30) || 'בית';
  // כפילות: אותה כתובת כבר שמורה — מחזירים את הקיימת (idempotent)
  const { rows: dup } = await q('SELECT id, label, address FROM user_addresses WHERE user_id=$1 AND address=$2', [req.user.id, addr]);
  if (dup[0]) return res.json({ address: dup[0], existing: true });
  const { rows: cnt } = await q('SELECT count(*)::int AS n FROM user_addresses WHERE user_id=$1', [req.user.id]);
  if (cnt[0].n >= 20) return res.status(409).json({ error: 'ניתן לשמור עד 20 כתובות — מחקו כתובת ישנה' });
  const { rows } = await q(
    'INSERT INTO user_addresses(user_id, label, address) VALUES ($1,$2,$3) RETURNING id, label, address, created_at',
    [req.user.id, lbl, addr]);
  res.status(201).json({ address: rows[0] });
});

r.delete('/:id', uuidParams('id'), async (req, res) => {
  const { rowCount } = await q('DELETE FROM user_addresses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'כתובת לא נמצאה' });
  res.json({ ok: true });
});

module.exports = r;
