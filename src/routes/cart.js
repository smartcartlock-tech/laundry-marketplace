const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();
r.use(requireAuth);

// E14.T1: עגלה בענן — סנכרון הסל בין מכשירים (רשומה אחת לכל משתמש)
r.get('/', async (req, res) => {
  const { rows } = await q('SELECT items, updated_at FROM user_carts WHERE user_id=$1', [req.user.id]);
  res.json({ items: rows[0] ? rows[0].items : [], updated_at: rows[0] ? rows[0].updated_at : null });
});

r.put('/', async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'פורמט עגלה לא תקין' });
  if (items.length > 200) return res.status(400).json({ error: 'עגלה גדולה מדי' });
  // ולידציה קלה לכל שורה — התוכן המחייב נבדק מול המחירון ביצירת הזמנה
  const clean = [];
  for (const it of items) {
    if (!it || typeof it.slug !== 'string' || typeof it.item_id !== 'string') return res.status(400).json({ error: 'שורת עגלה לא תקינה' });
    const qty = Number(it.qty);
    if (!(qty > 0 && qty <= 100)) return res.status(400).json({ error: 'כמות לא תקינה' });
    clean.push({ slug: it.slug.slice(0, 80), item_id: it.item_id.slice(0, 80), name: String(it.name || '').slice(0, 120), price: Number(it.price) || 0, unit: ['item', 'kg', 'bag'].includes(it.unit) ? it.unit : 'item', qty });
  }
  if (!clean.length) {
    await q('DELETE FROM user_carts WHERE user_id=$1', [req.user.id]);
    return res.json({ ok: true, items: [] });
  }
  const { rows } = await q(
    `INSERT INTO user_carts(user_id, items, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (user_id) DO UPDATE SET items=EXCLUDED.items, updated_at=now()
     RETURNING updated_at`, [req.user.id, JSON.stringify(clean)]);
  res.json({ ok: true, items: clean, updated_at: rows[0].updated_at });
});

module.exports = r;
