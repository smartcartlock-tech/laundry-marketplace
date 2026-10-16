// CX-B1: ניהול "הכתובות שלי" — הוספה, עריכה, מחיקה, ברירת מחדל, הערות לשליח
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { uuidParams } = require('../validate');

const r = express.Router();
r.use(requireAuth);

const COLS = 'id, label, address, courier_note, is_default, created_at';

r.get('/', async (req, res) => {
  const { rows } = await q(
    `SELECT ${COLS} FROM user_addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at DESC LIMIT 20`,
    [req.user.id]);
  res.json({ addresses: rows });
});

function clean(body) {
  const address = String((body || {}).address || '').trim();
  const label = String((body || {}).label || '').trim().slice(0, 30) || 'בית';
  const note = String((body || {}).courier_note || '').trim().slice(0, 200) || null;
  if (!address || address.length < 5) return { error: 'כתובת חסרה או קצרה מדי' };
  if (address.length > 200) return { error: 'כתובת ארוכה מדי' };
  return { address, label, note, isDefault: !!(body || {}).is_default };
}

r.post('/', async (req, res) => {
  const v = clean(req.body); if (v.error) return res.status(400).json({ error: v.error });
  const { rows: dup } = await q('SELECT id FROM user_addresses WHERE user_id=$1 AND address=$2', [req.user.id, v.address]);
  if (dup[0]) return res.status(409).json({ error: 'הכתובת כבר שמורה אצלך' });
  const { rows: cnt } = await q('SELECT count(*)::int AS n FROM user_addresses WHERE user_id=$1', [req.user.id]);
  if (cnt[0].n >= 20) return res.status(409).json({ error: 'ניתן לשמור עד 20 כתובות' });
  if (v.isDefault || cnt[0].n === 0) await q('UPDATE user_addresses SET is_default=false WHERE user_id=$1', [req.user.id]);
  const makeDefault = v.isDefault || cnt[0].n === 0;
  const { rows } = await q(
    `INSERT INTO user_addresses(user_id, label, address, courier_note, is_default) VALUES ($1,$2,$3,$4,$5) RETURNING ${COLS}`,
    [req.user.id, v.label, v.address, v.note, makeDefault]);
  res.status(201).json({ address: rows[0] });
});

r.put('/:id', uuidParams('id'), async (req, res) => {
  const v = clean(req.body); if (v.error) return res.status(400).json({ error: v.error });
  const { rows } = await q(
    `UPDATE user_addresses SET label=$3, address=$4, courier_note=$5 WHERE id=$1 AND user_id=$2 RETURNING ${COLS}`,
    [req.params.id, req.user.id, v.label, v.address, v.note]);
  if (!rows[0]) return res.status(404).json({ error: 'כתובת לא נמצאה' });
  res.json({ address: rows[0] });
});

r.post('/:id/default', uuidParams('id'), async (req, res) => {
  const { rows: own } = await q('SELECT id FROM user_addresses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!own[0]) return res.status(404).json({ error: 'כתובת לא נמצאה' });
  await q('UPDATE user_addresses SET is_default=false WHERE user_id=$1', [req.user.id]);
  await q('UPDATE user_addresses SET is_default=true WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

r.delete('/:id', uuidParams('id'), async (req, res) => {
  const { rows } = await q('DELETE FROM user_addresses WHERE id=$1 AND user_id=$2 RETURNING is_default', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'כתובת לא נמצאה' });
  if (rows[0].is_default) {
    await q(`UPDATE user_addresses SET is_default=true WHERE id=(
      SELECT id FROM user_addresses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1)`, [req.user.id]);
  }
  res.json({ ok: true });
});

module.exports = r;
