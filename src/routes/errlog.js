// צפיית אדמין ביומן התקלות: GET /api/admin/errors?limit=50
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const r = express.Router();
r.use(requireAuth, requireAdmin);

r.get('/errors', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await q(
    `SELECT id, ts, method, path, status, message, user_id, ip FROM error_log ORDER BY id DESC LIMIT $1`, [limit]);
  res.json({ errors: rows });
});

// E3: endpoint לבדיקות בלבד (ALLOW_SIMULATE_ERRORS=1 מועבר מ-test) — מייצר 500 אמיתי דרך ה-errorHandler
if (process.env.ALLOW_SIMULATE_ERRORS === '1') {
  r.post('/errors/simulate', (req, res, next) => { next(new Error('simulated test failure')); });
}

module.exports = r;
