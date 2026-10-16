// N4: דוא"ל/וואטסאפ כסימולציה בלבד — "שליחה" רושמת את ההודעה בתיבת דואר יוצא מדומה.
// אין כאן שום קריאה לספק חיצוני (Twilio/SMTP). שום דבר לא יוצא לאנשים אמיתיים.
const express = require('express');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { limiter } = require('../ratelimit');

const r = express.Router();
r.use(requireAuth);

r.post('/send', limiter('simoutbox', 20, 10 * 60 * 1000, (req) => req.user.id), async (req, res) => {
  try {
    const b = req.body || {};
    const channel = String(b.channel || '');
    const recipient = String(b.recipient || '').trim();
    const subject = b.subject ? String(b.subject).trim() : null;
    const body = String(b.body || '').trim();
    if (!['whatsapp', 'email'].includes(channel)) return res.status(400).json({ error: 'ערוץ לא נתמך (whatsapp/email)' });
    if (!recipient) return res.status(400).json({ error: 'נמען חובה' });
    if (channel === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) return res.status(400).json({ error: 'כתובת דוא"ל לא תקינה' });
    if (channel === 'whatsapp' && !/^\+?[\d\s-]{9,15}$/.test(recipient)) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
    if (channel === 'email' && !subject) return res.status(400).json({ error: 'נושא חובה לדוא"ל' });
    if (!body) return res.status(400).json({ error: 'גוף ההודעה חובה' });
    const { rows } = await q(
      'INSERT INTO simulated_outbox(user_id, channel, recipient, subject, body, meta) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.id, channel, recipient, subject, body, JSON.stringify({ simulated: true, note: 'סימולציה — לא נשלח' })]);
    res.status(201).json({ simulated: true, message: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.get('/', async (req, res) => {
  try {
    const { rows } = await q(
      'SELECT id, channel, recipient, subject, body, created_at FROM simulated_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]);
    res.json({ simulated: true, messages: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
