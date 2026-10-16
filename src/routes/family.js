// CX-B3: הצטרפות משפחה/שותף למנוי (דמו) — קישור הזמנה להעתקה בלבד, בלי שליחת הודעות
const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const me = express.Router();
me.use(requireAuth);

me.get('/', async (req, res) => {
  const { rows: members } = await q(
    `SELECT fm.member_user_id, fm.created_at, u.phone FROM family_members fm
     JOIN users u ON u.id=fm.member_user_id WHERE fm.owner_user_id=$1 ORDER BY fm.created_at`,
    [req.user.id]);
  const { rows: inv } = await q(
    'SELECT token, created_at FROM family_invites WHERE owner_user_id=$1 AND used_by IS NULL ORDER BY created_at DESC LIMIT 1',
    [req.user.id]);
  const mask = p => p ? String(p).replace(/^(.{5}).+(.{2})$/, '$1•••••$2') : '';
  res.json({
    members: members.map(m => ({ phone: mask(m.phone), since: m.created_at })),
    invite: inv[0] ? { token: inv[0].token } : null,
  });
});

me.post('/invite', async (req, res) => {
  const { rows: existing } = await q(
    'SELECT token FROM family_invites WHERE owner_user_id=$1 AND used_by IS NULL ORDER BY created_at DESC LIMIT 1',
    [req.user.id]);
  if (existing[0]) return res.json({ token: existing[0].token });
  const token = crypto.randomBytes(6).toString('base64url');
  await q('INSERT INTO family_invites(owner_user_id, token) VALUES ($1,$2)', [req.user.id, token]);
  res.status(201).json({ token });
});

const pub = express.Router();
pub.post('/join', requireAuth, async (req, res) => {
  const token = String((req.body || {}).token || '').trim();
  if (!token) return res.status(400).json({ error: 'קישור לא תקין' });
  const { rows } = await q('SELECT id, owner_user_id, used_by FROM family_invites WHERE token=$1', [token]);
  const inv = rows[0];
  if (!inv) return res.status(404).json({ error: 'קישור ההזמנה לא נמצא או שפג תוקפו' });
  if (inv.owner_user_id === req.user.id) return res.status(400).json({ error: 'לא ניתן להצטרף למנוי של עצמך' });
  if (inv.used_by) return res.status(409).json({ error: 'קישור ההזמנה כבר נוצל' });
  await q('UPDATE family_invites SET used_by=$1, used_at=now() WHERE id=$2', [req.user.id, inv.id]);
  await q('INSERT INTO family_members(owner_user_id, member_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [inv.owner_user_id, req.user.id]);
  res.json({ ok: true });
});

module.exports = { me, pub };
