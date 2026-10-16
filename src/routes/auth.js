const express = require('express');
const crypto = require('crypto');
const { q } = require('../db');
const { sign, requireAuth } = require('../auth');
const { sendCode } = require('../otp-provider');

const r = express.Router();

// B2: קודי OTP נשמרים כ-HMAC בלבד (לא גלויים). המפתח: OTP_SECRET או JWT_SECRET כגיבוי.
const OTP_HMAC_KEY = () => process.env.OTP_SECRET || process.env.JWT_SECRET || 'dev-insecure-secret';
function hashOtp(code) {
  return crypto.createHmac('sha256', OTP_HMAC_KEY()).update(String(code)).digest('hex');
}
function otpMatches(row, code) {
  if (row.code_hash) {
    const a = Buffer.from(row.code_hash, 'hex'), b = Buffer.from(hashOtp(code), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return row.code === code; // שורות מדור קדם (פגות תוך 10 דקות בכל מקרה)
}
const { limiter } = require('../ratelimit');
const { isDemo } = require('../config');
// A2: קוד דמו מוצג רק במצב demo — ב-pilot לעולם לא (גם אם DEMO_OTP=true ב-env)
const DEMO_OTP = () => isDemo && process.env.DEMO_OTP !== 'false';

function normalizeTarget(raw) {
  const t = String(raw || '').trim();
  if (t.includes('@')) return { kind: 'email', target: t.toLowerCase() };
  let p = t.replace(/[^\d+]/g, '');
  if (p.startsWith('0')) p = '+972' + p.slice(1);
  if (!p.startsWith('+')) p = '+' + p;
  return { kind: 'phone', target: p };
}

// נרמול היעד לפני הקיצוב — המגבלה נמדדת על היעד הקנוני (E.164), לא על הקלט הגולמי
const normalizeBody = (req, res, next) => {
  if (req.body && req.body.target) req.body.target = normalizeTarget(req.body.target).target;
  next();
};
const ipLimit = (scope, max) => limiter(scope, max, 10 * 60 * 1000, (req) => req.ip);
r.post('/otp/request', normalizeBody, limiter('otp-request', 5, 10 * 60 * 1000), ipLimit('otp-request-ip', 30), async (req, res) => {
  try {
    const { kind, target } = normalizeTarget(req.body.target);
    if (!target || target.length < 5) return res.status(400).json({ error: 'מספר טלפון או אימייל לא תקין' });
    if (kind === 'phone' && !/^\+972\d{8,9}$/.test(target)) return res.status(400).json({ error: 'מספר טלפון ישראלי לא תקין' });
    const code = String(crypto.randomInt(100000, 999999));
    // A4: ספק OTP מוחלף (src/otp-provider.js) — whatsapp/בוט אם מוגדר, demo רק במצב demo
    const delivery = await sendCode(target, code, { kind, demoOtp: DEMO_OTP() });
    if (!delivery.sent) return res.status(503).json({ error: "שליחת OTP לא מוגדרת כרגע" });
    const channel = delivery.channel, demoCode = delivery.demoCode; // מצב דמו: הקוד מוצג על המסך גם אם נשלח בוואטסאפ
    // B2: נשמר רק HMAC של הקוד, לעולם לא הקוד הגלוי
    await q('INSERT INTO otp_codes(channel, target, code, code_hash, expires_at) VALUES ($1,$2,$3,$4, now() + interval \'10 minutes\')',
      [channel, target, null, hashOtp(code)]);
    res.json({ ok: true, channel, ...(demoCode ? { demoCode } : {}) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.post('/otp/verify', normalizeBody, limiter('otp-verify', 10, 10 * 60 * 1000), ipLimit('otp-verify-ip', 60), async (req, res) => {
  try {
    const { target } = normalizeTarget(req.body.target);
    const code = String(req.body.code || '').trim();
    // B2: הקוד העדכני בלבד; עד 10 ניסיונות שגויים לקוד (מעבר ל-rate limit הכללי)
    const { rows } = await q(
      `SELECT * FROM otp_codes WHERE target=$1 AND NOT consumed AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`, [target]);
    const row = rows[0];
    if (!row) return res.status(401).json({ error: 'קוד שגוי או פג תוקף' });
    if (row.attempts >= 10) return res.status(429).json({ error: 'יותר מדי ניסיונות — בקשו קוד חדש' });
    if (!otpMatches(row, code)) {
      await q('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [row.id]);
      return res.status(401).json({ error: 'קוד שגוי או פג תוקף' });
    }
    await q('UPDATE otp_codes SET consumed=true WHERE id=$1', [row.id]);
    const isEmail = target.includes('@');
    let { rows: u } = isEmail
      ? await q('SELECT * FROM users WHERE email=$1', [target])
      : await q('SELECT * FROM users WHERE phone=$1', [target]);
    let isNew = false;
    if (!u[0]) {
      // E3.T4: שיוך מקור לקוח — הרשמה מדף ממותג נרשמת כ'לקוח שלה' של אותה מכבסה
      let signupSource = null, signupTenant = null;
      if (req.body.signup_source === 'branded' && req.body.signup_slug) {
        const { rows: bt } = await q('SELECT id FROM tenants WHERE slug=$1 AND approved', [req.body.signup_slug]);
        if (bt[0]) { signupSource = 'branded'; signupTenant = bt[0].id; }
      }
      const ins = isEmail
        ? await q('INSERT INTO users(email, name, signup_source, signup_tenant_id) VALUES ($1,$2,$3,$4) RETURNING *', [target, req.body.name || null, signupSource, signupTenant])
        : await q('INSERT INTO users(phone, name, signup_source, signup_tenant_id) VALUES ($1,$2,$3,$4) RETURNING *', [target, req.body.name || null, signupSource, signupTenant]);
      u = ins.rows;
      isNew = true;
    } else if (req.body.name && req.body.name.trim() && !u[0].name) {
      // השלמת שם רק אם חסר — לא דורסים שם קיים של משתמש (QA2.T1)
      const upd = await q('UPDATE users SET name=$2 WHERE id=$1 RETURNING *', [u[0].id, req.body.name.trim()]);
      u = upd.rows;
    }
    res.json({ token: sign(u[0]), user: publicUser(u[0]), is_new: isNew });
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
    if (!expected) return res.status(503).json({ error: 'התחברות עם גוגל אינה מוגדרת' }); // לא מדלגים על בדיקת audience
    if (info.aud !== expected) return res.status(401).json({ error: 'audience לא תואם' });
    if (info.email_verified !== true && info.email_verified !== 'true') return res.status(401).json({ error: 'נדרשת כתובת גוגל מאומתת' });
    let { rows: u } = await q('SELECT * FROM users WHERE google_sub=$1 OR email=$2', [info.sub, info.email]);
    let isNew = false;
    if (!u[0]) {
      const ins = await q('INSERT INTO users(google_sub, email, name) VALUES ($1,$2,$3) RETURNING *',
        [info.sub, info.email, info.name || null]);
      u = ins.rows;
      isNew = true;
    } else if (!u[0].google_sub) {
      await q('UPDATE users SET google_sub=$1 WHERE id=$2', [info.sub, u[0].id]);
    }
    res.json({ token: sign(u[0]), user: publicUser(u[0]), is_new: isNew });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

r.get('/me', requireAuth, async (req, res) => {
  const { rows: memberships } = await q(
    'SELECT t.slug, t.name, m.role FROM tenant_members m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1', [req.user.id]);
  const { rows: courier } = await q('SELECT id, model, approved, rejected_reason FROM couriers WHERE user_id=$1', [req.user.id]);
  res.json({ user: publicUser(req.user), memberships, courier: courier[0] || null });
});

function publicUser(u) { return { id: u.id, phone: u.phone, email: u.email, name: u.name, role: u.role }; }

// B1: התנתקות — מבטלת את כל הטוקנים הקיימים של המשתמש (העלאת token_version)
r.post('/logout', requireAuth, async (req, res) => {
  await q('UPDATE users SET token_version=token_version+1 WHERE id=$1', [req.user.id]);
  res.json({ ok: true });
});

module.exports = r;
