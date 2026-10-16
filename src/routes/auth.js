const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');
const { sign, requireAuth } = require('../auth');
const { sendWhatsApp } = require('../notify');

const r = express.Router();
const DEMO_OTP = () => process.env.DEMO_OTP !== 'false'; // ברירת מחדל: מצב דמו פעיל

function normalizeTarget(raw) {
  const t = String(raw || '').trim();
  if (t.includes('@')) return { kind: 'email', target: t.toLowerCase() };
  let p = t.replace(/[^\d+]/g, '');
  if (p.startsWith('0')) p = '+972' + p.slice(1);
  if (!p.startsWith('+')) p = '+' + p;
  return { kind: 'phone', target: p };
}

r.post('/otp/request', async (req, res) => {
  try {
    const { kind, target } = normalizeTarget(req.body.target);
    if (!target || target.length < 5) return res.status(400).json({ error: 'מספר טלפון או אימייל לא תקין' });
    const code = String(crypto.randomInt(100000, 999999));
    let channel = 'demo', demoCode;
    if (kind === 'phone') {
      const sent = await sendWhatsApp(target, `קוד הכניסה שלך ל״מכבסה בקליק״: ${code}`);
      if (sent.sent) channel = 'whatsapp';
    }
    // email: נדרש ספק דואר (Brevo/SMTP) — לא מוגדר; נופל לדמו
    if (channel === 'demo') {
      if (!DEMO_OTP()) return res.status(503).json({ error: "שליחת OTP לא מוגדרת כרגע" });
      demoCode = code; // מוצג למשתמש — מצב דמו בלבד
    }
    await q('INSERT INTO otp_codes(channel, target, code, expires_at) VALUES ($1,$2,$3, now() + interval \'10 minutes\')',
      [channel, target, code]);
    res.json({ ok: true, channel, ...(demoCode ? { demoCode } : {}) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.post('/otp/verify', async (req, res) => {
  try {
    const { target } = normalizeTarget(req.body.target);
    const code = String(req.body.code || '').trim();
    const { rows } = await q(
      `SELECT * FROM otp_codes WHERE target=$1 AND code=$2 AND NOT consumed AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`, [target, code]);
    if (!rows[0]) return res.status(401).json({ error: 'קוד שגוי או פג תוקף' });
    await q('UPDATE otp_codes SET consumed=true WHERE id=$1', [rows[0].id]);
    const isEmail = target.includes('@');
    let { rows: u } = isEmail
      ? await q('SELECT * FROM users WHERE email=$1', [target])
      : await q('SELECT * FROM users WHERE phone=$1', [target]);
    if (!u[0]) {
      const ins = isEmail
        ? await q('INSERT INTO users(email, name) VALUES ($1,$2) RETURNING *', [target, req.body.name || null])
        : await q('INSERT INTO users(phone, name) VALUES ($1,$2) RETURNING *', [target, req.body.name || null]);
      u = ins.rows;
    }
    res.json({ token: sign(u[0]), user: publicUser(u[0]) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// Google Sign-In: מקבל ID token מהלקוח ומוודא מול גוגל
r.post('/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'חסר credential' });
    const resp = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!resp.ok) return res.status(401).json({ error: 'טוקן גוגל לא תקין' });
    const info = await resp.json();
    const expected = process.env.GOOGLE_CLIENT_ID;
    if (expected && info.aud !== expected) return res.status(401).json({ error: 'audience לא תואם' });
    let { rows: u } = await q('SELECT * FROM users WHERE google_sub=$1 OR email=$2', [info.sub, info.email]);
    if (!u[0]) {
      const ins = await q('INSERT INTO users(google_sub, email, name) VALUES ($1,$2,$3) RETURNING *',
        [info.sub, info.email, info.name || null]);
      u = ins.rows;
    } else if (!u[0].google_sub) {
      await q('UPDATE users SET google_sub=$1 WHERE id=$2', [info.sub, u[0].id]);
    }
    res.json({ token: sign(u[0]), user: publicUser(u[0]) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.get('/me', requireAuth, async (req, res) => {
  const { rows: memberships } = await q(
    'SELECT t.slug, t.name, m.role FROM tenant_members m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1', [req.user.id]);
  const { rows: courier } = await q('SELECT id, model, approved FROM couriers WHERE user_id=$1', [req.user.id]);
  res.json({ user: publicUser(req.user), memberships, courier: courier[0] || null });
});

function publicUser(u) { return { id: u.id, phone: u.phone, email: u.email, name: u.name, role: u.role }; }

module.exports = r;
