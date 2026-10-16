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

module.exports = r;
