// CX-D2: מסך "החשבון שלי" — עדכון פרטי פרופיל (שם מלא). מותקן על /api/me לצד routes/me (C2).
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();

r.patch('/', requireAuth, async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'שם מלא: 2-60 תווים' });
  const { rows } = await q('UPDATE users SET name=$2 WHERE id=$1 AND anonymized_at IS NULL RETURNING id, name, phone', [req.user.id, name]);
  if (!rows[0]) return res.status(409).json({ error: 'החשבון נמחק' });
  res.json({ user: rows[0] });
});

module.exports = r;
