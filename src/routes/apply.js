// B2 (מוצר): טופס בקשת הצטרפות ציבורי — נשמר בלבד, בלי הודעות אוטומטיות לאף אחד.
// הגבלת קצת + שדה honeypot נגד בוטים (בוט שמילא → תשובת הצלחה שקטה בלי שמירה).
const express = require('express');
const { q } = require('../db');
const { limiter } = require('../ratelimit');

const r = express.Router();

r.post('/apply', limiter('apply', 5, 10 * 60 * 1000, (req) => req.ip), async (req, res) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot — בוטים ממלאים, בני אדם לא רואים את השדה
    const name = String(b.name || '').trim();
    const city = String(b.city || '').trim();
    const phone = String(b.phone || '').trim();
    const est = Number(b.est_orders) || null;
    if (name.length < 2) return res.status(400).json({ error: 'שם מכבסה חובה' });
    if (!city) return res.status(400).json({ error: 'עיר חובה' });
    if (!/^\+?972\d{8,9}$|^0\d{8,9}$/.test(phone.replace(/[\s-]/g, ''))) return res.status(400).json({ error: 'מספר טלפון ישראלי לא תקין' });
    const { rows } = await q(
      'INSERT INTO tenant_applications(laundry_name, city, phone, est_orders) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, city, phone, est]);
    res.status(201).json({ ok: true, id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
