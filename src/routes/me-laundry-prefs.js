// CX-B2: העדפות כביסה שמורות — מצורפות אוטומטית כהערה להזמנה (כולל הזמנה חוזרת)
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();
r.use(requireAuth);

const SCENTS = ['', 'רגיל', 'ללא ריח', 'לבנדר', 'אוקיינוס'];
const DEF = { scent: '', softener: false, special_instructions: '' };

r.get('/', async (req, res) => {
  const { rows } = await q('SELECT scent, softener, special_instructions FROM user_laundry_prefs WHERE user_id=$1', [req.user.id]);
  res.json({ prefs: rows[0] || DEF });
});

r.put('/', async (req, res) => {
  const b = req.body || {};
  const scent = String(b.scent || '');
  if (!SCENTS.includes(scent)) return res.status(400).json({ error: 'ריח לא נתמך' });
  const special = String(b.special_instructions || '').trim().slice(0, 300);
  const { rows } = await q(
    `INSERT INTO user_laundry_prefs(user_id, scent, softener, special_instructions, updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (user_id) DO UPDATE SET scent=$2, softener=$3, special_instructions=$4, updated_at=now()
     RETURNING scent, softener, special_instructions`,
    [req.user.id, scent, !!b.softener, special]);
  res.json({ prefs: rows[0] });
});

// שורה מסוגננת שמצורפת להערות ההזמנה בצ׳ק-אאוט
function prefsNote(p) {
  if (!p || (!p.scent && !p.softener && !p.special_instructions)) return '';
  const parts = [];
  if (p.scent) parts.push('ריח: ' + p.scent);
  parts.push('מרכך: ' + (p.softener ? 'כן' : 'לא'));
  if (p.special_instructions) parts.push('הוראות: ' + p.special_instructions);
  return 'העדפות כביסה — ' + parts.join(' · ');
}

module.exports = r;
module.exports.prefsNote = prefsNote;
