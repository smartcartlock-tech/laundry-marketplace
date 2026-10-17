// T18: עריכת טלפון/אימייל עם אימות OTP (אותה תשתית כמו התחברות — קוד נשמר כ-HMAC בלבד)
// וחיבור/ניתוק חשבון Google. מותקן על /api/me לצד routes/me ו-account-hub.
const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { sendCode } = require('../otp-provider');
const { limiter } = require('../ratelimit');
const { SCREEN_OTP } = require('../config');

const r = express.Router();
r.use(requireAuth);

const OTP_HMAC_KEY = () => process.env.OTP_SECRET || process.env.JWT_SECRET || 'dev-insecure-secret';
const hashOtp = (code) => crypto.createHmac('sha256', OTP_HMAC_KEY()).update(String(code)).digest('hex');
function otpMatches(row, code) {
  if (row.code_hash) {
    const a = Buffer.from(row.code_hash, 'hex'), b = Buffer.from(hashOtp(code), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return row.code === code;
}
const DEMO_OTP = SCREEN_OTP;

function normalize(kind, raw) {
  const t = String(raw || '').trim();
  if (kind === 'email') return t.toLowerCase();
  let p = t.replace(/[^\d+]/g, '');
  if (p.startsWith('0')) p = '+972' + p.slice(1);
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}
const valid = (kind, v) => kind === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) : /^\+972\d{8,9}$/.test(v);

// בקשת שינוי: שולח קוד אימות ליעד החדש (בדמו הקוד מוצג על המסך)
r.post('/contact/request', limiter('me-contact-req', 5, 10 * 60 * 1000), async (req, res) => {
  try {
    const kind = req.body && req.body.kind;
    if (!['phone', 'email'].includes(kind)) return res.status(400).json({ error: 'סוג לא תקין' });
    const target = normalize(kind, req.body && req.body.value);
    if (!valid(kind, target)) return res.status(400).json({ error: kind === 'email' ? 'כתובת אימייל לא תקינה' : 'מספר טלפון ישראלי לא תקין' });
    const col = kind === 'email' ? 'email' : 'phone';
    if (req.user[col] === target) return res.status(400).json({ error: 'זהה לאמצעי הקשר הנוכחי' });
    const { rows: taken } = await q(`SELECT id FROM users WHERE ${col}=$1 AND id<>$2`, [target, req.user.id]);
    if (taken[0]) return res.status(409).json({ error: 'אמצעי הקשר כבר רשום לחשבון אחר' });
    const code = String(crypto.randomInt(100000, 999999));
    const delivery = await sendCode(target, code, { kind, demoOtp: DEMO_OTP() });
    if (!delivery.sent) return res.status(503).json({ error: 'שליחת קוד אימות לא מוגדרת כרגע' });
    await q(`INSERT INTO otp_codes(channel, target, code, code_hash, expires_at) VALUES ($1,$2,$3,$4, now() + interval '10 minutes')`,
      [delivery.channel, target, null, hashOtp(code)]);
    res.json({ ok: true, channel: delivery.channel, target, ...(delivery.demoCode ? { demoCode: delivery.demoCode } : {}) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// אישור שינוי: הקוד שנשלח ליעד החדש מאמת בעלות, ורק אז העדכון מתבצע
r.post('/contact/confirm', limiter('me-contact-cnf', 10, 10 * 60 * 1000), async (req, res) => {
  try {
    const kind = req.body && req.body.kind;
    if (!['phone', 'email'].includes(kind)) return res.status(400).json({ error: 'סוג לא תקין' });
    const target = normalize(kind, req.body && req.body.value);
    const code = String((req.body && req.body.code) || '').trim();
    if (!valid(kind, target) || !code) return res.status(400).json({ error: 'פרטים חסרים' });
    const { rows } = await q(
      `SELECT * FROM otp_codes WHERE target=$1 AND NOT consumed AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [target]);
    const row = rows[0];
    if (!row || !otpMatches(row, code)) {
      if (row) await q('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [row.id]);
      return res.status(401).json({ error: 'קוד שגוי או שפג תוקפו' });
    }
    await q('UPDATE otp_codes SET consumed=true WHERE id=$1', [row.id]);
    const col = kind === 'email' ? 'email' : 'phone';
    const { rows: taken } = await q(`SELECT id FROM users WHERE ${col}=$1 AND id<>$2`, [target, req.user.id]);
    if (taken[0]) return res.status(409).json({ error: 'אמצעי הקשר כבר רשום לחשבון אחר' });
    let updated;
    try {
      ({ rows: updated } = await q(
        `UPDATE users SET ${col}=$2 WHERE id=$1 AND anonymized_at IS NULL RETURNING id, name, phone, email, role`, [req.user.id, target]));
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'אמצעי הקשר כבר רשום לחשבון אחר' });
      throw e;
    }
    if (!updated[0]) return res.status(409).json({ error: 'החשבון נמחק' });
    res.json({ ok: true, user: updated[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.get('/google/status', async (req, res) => {
  const { rows } = await q('SELECT google_sub FROM users WHERE id=$1', [req.user.id]);
  const { rows: em } = await q('SELECT email FROM users WHERE id=$1', [req.user.id]);
  res.json({ connected: !!rows[0].google_sub, email: em[0].email || null });
});

// חיבור חשבון Google לחשבון הנוכחי (אימות ה-id-token מול Google, כמו /auth/google)
r.post('/google/connect', limiter('me-google', 10, 10 * 60 * 1000), async (req, res) => {
  try {
    const credential = String((req.body || {}).credential || '');
    if (!credential) return res.status(400).json({ error: 'חסר אישור Google' });
    const resp = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!resp.ok) return res.status(401).json({ error: 'אימות מול Google נכשל' });
    const info = await resp.json();
    const expected = process.env.GOOGLE_CLIENT_ID;
    if (expected && info.aud !== expected) return res.status(401).json({ error: 'אסימון Google לא מתאים לאפליקציה' });
    if (!info.sub) return res.status(401).json({ error: 'אסימון Google לא תקין' });
    const { rows: taken } = await q('SELECT id FROM users WHERE (google_sub=$1 OR (email IS NOT NULL AND email=$2)) AND id<>$3', [info.sub, info.email || '', req.user.id]);
    if (taken[0]) return res.status(409).json({ error: 'חשבון ה-Google כבר מקושר לחשבון אחר' });
    const { rows } = await q(
      'UPDATE users SET google_sub=$2, email=COALESCE(email,$3) WHERE id=$1 RETURNING id, name, phone, email, role',
      [req.user.id, info.sub, info.email || null]);
    res.json({ ok: true, user: rows[0], google_email: info.email || null });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// ניתוק Google — חסימה אם לא יישאר אמצעי התחברות אחר (מניעת נעילה בחוץ)
r.post('/google/disconnect', async (req, res) => {
  try {
    if (!req.user.google_sub) return res.status(404).json({ error: 'אין חיבור Google פעיל' });
    if (!req.user.phone && !req.user.email) return res.status(400).json({ error: 'לא ניתן לנתק — לא יישאר אמצעי התחברות אחר' });
    await q('UPDATE users SET google_sub=NULL WHERE id=$1', [req.user.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
