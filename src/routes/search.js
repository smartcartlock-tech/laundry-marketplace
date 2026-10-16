// הצעות חיפוש חכמות: שמות מכבסות, ערים ושירותים — להשלמה חיה בשורת החיפוש בדף הבית
const express = require('express');
const { q } = require('../db');
const r = express.Router();

r.get('/search/suggest', async (req, res) => {
  const query = String(req.query.q || '').trim();
  res.set('Cache-Control', 'public, max-age=30');
  if (!query) return res.json({ suggestions: [] });
  const like = `%${query}%`;
  const [laundries, cities, services] = await Promise.all([
    q(`SELECT name, slug, city FROM tenants WHERE approved AND is_open IS NOT NULL AND (name ILIKE $1 OR city ILIKE $1) ORDER BY name LIMIT 4`, [like]),
    q(`SELECT DISTINCT city FROM tenants WHERE approved AND is_open IS NOT NULL AND city ILIKE $1 ORDER BY city LIMIT 3`, [like]),
    q(`SELECT DISTINCT sv AS service FROM tenants t, unnest(t.services) sv WHERE t.approved AND t.is_open IS NOT NULL AND sv ILIKE $1 ORDER BY sv LIMIT 3`, [like]),
  ]);
  const suggestions = [
    ...laundries.rows.map(l => ({ type: 'laundry', label: l.name, sub: l.city || '', slug: l.slug })),
    ...cities.rows.map(c => ({ type: 'city', label: c.city })),
    ...services.rows.map(s => ({ type: 'service', label: s.service })),
  ].slice(0, 8);
  res.json({ suggestions });
});

module.exports = r;
