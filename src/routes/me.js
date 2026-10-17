// C2 + G17.T5-T7/T16: זכויות נושא מידע (תיקון 13) — ייצוא מלא, מחיקה מחוזקת ב-OTP
// עם חסימת הזמנות פעילות, אנונימיזציה מלאה בכל הטבלאות, ותצוגת "מה נשמר".
// מסמכים חשבונאיים והזמנות נשמרים (חובת שמירת רשומות) אך מתנתקים מזהות הלקוח.
const express = require('express');
const crypto = require('crypto');
const { q, pool } = require('../db');
const { requireAuth } = require('../auth');
const { sendCode } = require('../otp-provider');
const { limiter } = require('../ratelimit');
const { SCREEN_OTP } = require('../config');
const { sendWhatsApp, notifyUser } = require('../notify');

const r = express.Router();

// HMAC בדוגמת auth.js (B2) — אותו מפתח, טבלה נפרדת (מיגרציה 115)
const OTP_HMAC_KEY = () => process.env.OTP_SECRET || process.env.JWT_SECRET || 'dev-insecure-secret';
const hashOtp = (code) => crypto.createHmac('sha256', OTP_HMAC_KEY()).update(String(code)).digest('hex');
// A2: קוד דמו מוצג רק במצב demo — ב-pilot לעולם לא
const DEMO_OTP = SCREEN_OTP;

/* ---------- G17.T7: מפות המחיקה/השמירה — מכוסות בטסט (רשימת טבלאות מלאה) ---------- */
// טבלאות שנמחקות לחלוטין במחיקת חשבון (user_id או יעד טלפון/אימייל)
const WILL_DELETE = [
  'הפרופיל האישי (שם, טלפון, אימייל, חיבורי גוגל/פייסבוק)',
  'כתובות שמורות והערות לשליח',
  'עגלות פתוחות',
  'התחברויות פעילות בכל המכשירים',
  'העדפות כביסה והעדפות התראות',
  'מועדפים (מכבסות שסימנת)',
  'מנוי משפחתי — חברים והזמנות פתוחות',
  'ביקורות שכתבת',
  'הודעות והתראות אישיות',
  'תוכן דיווחי תקלות ותמונות שהעלית',
  'פרופיל שליח ומסמכי שליח (רישיון/ביטוח/תמונה)',
  'חברות כצוות במכבסות ובחשבונות עסקיים',
  'תבניות הזמנה חוזרת',
  'טיוטות הצטרפות מכבסה',
  'מנוי פעיל — יבוטל אוטומטית',
];
// מה נשמר אחרי המחיקה (מוצג למשתמש לפני האישור) — מנותק מזהות
const KEPT = [
  'הזמנות ופריטי הזמנה — בלי כתובת, מיקום או הערות (חובת שמירת רשומות תפעולית)',
  'מסמכים חשבונאיים (חשבוניות/קבלות/זיכויים) — חובת שמירה בחוק',
  'מנויים מבוטלים והיסטוריית ניצול — רישום בלבד',
  'היסטוריית נקודות מועדון — מנותקת מזהות',
  'שלד דיווחי תקלות (סוג וסטטוס טיפול) — בלי תוכן ותמונות',
  'היסטוריית מסלולים/התחשבנות שליח — אם היית שליח, מנותקת מזהות',
];

// G17.T6: בדיקת חוסמים/אזהרות לפני מחיקה (משמשת גם preview וגם בדיקה חוזרת בתוך הטרנזקציה)
async function getDeletionState(queryFn, uid) {
  const activeOrders = await queryFn(
    `SELECT id, status FROM orders WHERE customer_id=$1 AND status NOT IN ('delivered','cancelled') ORDER BY created_at DESC LIMIT 10`, [uid]);
  const courier = await queryFn('SELECT id FROM couriers WHERE user_id=$1', [uid]);
  let courierOrders = { rows: [] };
  if (courier.rows[0]) {
    courierOrders = await queryFn(
      `SELECT id, status FROM orders WHERE courier_id=$1 AND status NOT IN ('delivered','cancelled') LIMIT 10`, [courier.rows[0].id]);
  }
  const owned = await queryFn(
    `SELECT t.name, (SELECT count(*)::int AS n FROM tenant_members x WHERE x.tenant_id=tm.tenant_id) AS members
     FROM tenant_members tm JOIN tenants t ON t.id=tm.tenant_id
     WHERE tm.user_id=$1 AND tm.role='owner'`, [uid]);
  const subs = await queryFn(`SELECT count(*)::int AS n FROM subscriptions WHERE user_id=$1 AND status='active'`, [uid]);
  const fam = await queryFn('SELECT count(*)::int AS n FROM family_members WHERE owner_user_id=$1', [uid]).catch(() => ({ rows: [{ n: 0 }] }));
  const staff = await queryFn(`SELECT count(*)::int AS n FROM tenant_members WHERE user_id=$1 AND role<>'owner'`, [uid]);

  const blockers = [];
  if (activeOrders.rows.length) blockers.push({
    kind: 'active_orders',
    message: `יש לך ${activeOrders.rows.length} הזמנות פעילות. אפשר למחוק את החשבון רק אחרי שכל ההזמנות הושלמו או בוטלו.`,
    orders: activeOrders.rows,
  });
  if (courierOrders.rows.length) blockers.push({
    kind: 'courier_assignments',
    message: `את/ה משובץ/ת כשליח/ה ל-${courierOrders.rows.length} הזמנות פעילות. סיים/י את המסירות או בטל/י את השיבוץ לפני המחיקה.`,
    orders: courierOrders.rows,
  });
  const soleOwned = owned.rows.filter(t => t.members <= 1);
  if (soleOwned.length) blockers.push({
    kind: 'sole_tenant_owner',
    message: `את/ה הבעלים היחיד/ה של ${soleOwned.map(t => `"${t.name}"`).join(', ')}. העבר/י בעלות או סגור/י את המכבסה לפני מחיקת החשבון.`,
    tenants: soleOwned.map(t => t.name),
  });

  const warnings = [];
  if (subs.rows[0].n) warnings.push({ kind: 'active_subscription', message: 'יש לך מנוי פעיל — הוא יבוטל אוטומטית עם המחיקה.' });
  if (fam.rows[0].n) warnings.push({ kind: 'family_members', message: `${fam.rows[0].n} בני משפחה משתפים את המנוי שלך — השיתוף יבוטל.` });
  if (courier.rows[0]) warnings.push({ kind: 'courier_profile', message: 'פרופיל השליח והמסמכים שהעלית יוסרו.' });
  if (staff.rows[0].n) warnings.push({ kind: 'staff_membership', message: 'החברות שלך כצוות במכבסות תוסר.' });
  return { blockers, warnings };
}

// G17.T7: תצוגת "מה נשמר" לפני אישור — חוסמים, אזהרות, מה נמחק ומה נשמר
r.get('/deletion-preview', requireAuth, async (req, res) => {
  if (req.user.anonymized_at) return res.status(409).json({ error: 'החשבון כבר נמחק' });
  const { blockers, warnings } = await getDeletionState(q, req.user.id);
  res.json({ can_delete: blockers.length === 0, blockers, warnings, will_delete: WILL_DELETE, kept: KEPT });
});

// G17.T6: שליחת OTP ייעודי למחיקה (טבלה נפרדת — קוד מחיקה לא תקף לכניסה)
r.post('/delete/request-otp', requireAuth, limiter('me-del-otp', 3, 10 * 60 * 1000, (req) => req.user.id), async (req, res) => {
  try {
    if (req.user.anonymized_at) return res.status(409).json({ error: 'החשבון כבר נמחק' });
    const target = req.user.phone || req.user.email;
    if (!target) return res.status(400).json({ error: 'אין בחשבון טלפון או אימייל לשליחת קוד' });
    const kind = target.includes('@') ? 'email' : 'phone';
    const code = String(crypto.randomInt(100000, 999999));
    const delivery = await sendCode(target, code, { kind, demoOtp: DEMO_OTP() });
    if (!delivery.sent) return res.status(503).json({ error: 'שליחת קוד אימות לא מוגדרת כרגע' });
    await q('UPDATE account_deletion_otps SET consumed=true WHERE user_id=$1 AND NOT consumed', [req.user.id]);
    await q(`INSERT INTO account_deletion_otps(user_id, code_hash, expires_at) VALUES ($1,$2, now() + interval '10 minutes')`,
      [req.user.id, hashOtp(code)]);
    res.json({ ok: true, channel: delivery.channel, ...(delivery.demoCode ? { demoCode: delivery.demoCode } : {}) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// G17.T16: ייצוא כל המידע האישי של המשתמש כ-JSON — כיסוי כל הטבלאות האישיות
r.get('/export', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const [addresses, orders, items, reviews, points, subs, subUsage, issues, courier, memberships,
    laundryPrefs, notifPrefs, favorites, famMembers, famInvites, notifications, messages,
    documents, recurring, business] = await Promise.all([
    q('SELECT label, address, courier_note, is_default, created_at FROM user_addresses WHERE user_id=$1', [uid]),
    q('SELECT id, tenant_id, status, payment_status, address, pickup_at, subtotal, delivery_fee, discount, total, source, notes, created_at FROM orders WHERE customer_id=$1', [uid]),
    q(`SELECT oi.order_id, oi.name, oi.price, oi.qty FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.customer_id=$1`, [uid]),
    q('SELECT order_id, rating, text, created_at FROM reviews WHERE user_id=$1', [uid]),
    q('SELECT order_id, points, kind, created_at FROM points_ledger WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT plan_id, status, bags_total, bags_used, started_at, period_end FROM subscriptions WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q(`SELECT su.subscription_id, su.order_id, su.bags, su.created_at FROM subscription_usage su JOIN subscriptions s ON s.id=su.subscription_id WHERE s.user_id=$1`, [uid]).catch(() => ({ rows: [] })),
    q('SELECT id, order_id, kind, status, text, created_at FROM issue_reports WHERE customer_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT vehicle, areas, availability, model, approved, created_at FROM couriers WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT tenant_id, role FROM tenant_members WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT scent, softener, special_instructions, updated_at FROM user_laundry_prefs WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT status_updates, marketing, updated_at FROM user_notification_prefs WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q(`SELECT f.tenant_id, t.name AS tenant_name, f.created_at FROM user_favorites f JOIN tenants t ON t.id=f.tenant_id WHERE f.user_id=$1`, [uid]).catch(() => ({ rows: [] })),
    q(`SELECT u.phone AS member_phone, fm.created_at FROM family_members fm JOIN users u ON u.id=fm.member_user_id WHERE fm.owner_user_id=$1`, [uid]).catch(() => ({ rows: [] })),
    q('SELECT token, created_at, used_at FROM family_invites WHERE owner_user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT channel, body, sent, created_at FROM notifications WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT kind, title, body, read_at, created_at FROM user_messages WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT kind, doc_year, doc_number, amount, vat, total, status, issued_at FROM documents WHERE customer_id=$1', [uid]).catch(() => ({ rows: [] })),
    q('SELECT account_id, days, items, pickup_time, address, active, created_at FROM recurring_templates WHERE user_id=$1', [uid]).catch(() => ({ rows: [] })),
    q(`SELECT bau.account_id, ba.name FROM business_account_users bau JOIN business_accounts ba ON ba.id=bau.account_id WHERE bau.user_id=$1`, [uid]).catch(() => ({ rows: [] })),
  ]);
  const u = { ...req.user };
  delete u.token_version;
  // G17.T35: יומן ביקורת בלי PII (actor_id בלבד — בלי actor_label/טלפון) + הודעה ללקוח על הייצוא
  await q(`INSERT INTO audit_log(actor_id, action, target_type) VALUES ($1,'me.export','user')`, [uid])
    .catch(e => console.error('audit me.export:', e.message));
  await notifyUser(uid, null, 'המידע האישי שלך ב״מכבסה בקליק״ יוצא כקובץ JSON. אם לא ביקשת זאת — פנה/י אלינו.', req.user.phone || req.user.email, 'ייצוא מידע אישי')
    .catch(e => console.error('notify me.export:', e.message));
  res.json({
    exported_at: new Date().toISOString(),
    profile: u, // כולל consent_at (G17.T16)
    addresses: addresses.rows,
    orders: orders.rows.map(o => ({ ...o, items: items.rows.filter(i => i.order_id === o.id) })),
    reviews: reviews.rows,
    points_ledger: points.rows,
    subscriptions: subs.rows,
    subscription_usage: subUsage.rows,
    issue_reports: issues.rows,
    courier_profile: courier.rows[0] || null,
    tenant_memberships: memberships.rows,
    business_memberships: business.rows,
    laundry_prefs: laundryPrefs.rows[0] || null,
    notification_prefs: notifPrefs.rows[0] || null,
    favorites: favorites.rows,
    family: { members: famMembers.rows, invites: famInvites.rows },
    notifications: notifications.rows,
    messages: messages.rows,
    documents: documents.rows,
    recurring_templates: recurring.rows,
  });
});

// G17.T6+T7: מחיקת החשבון — דורש OTP ייעודי, חוסם על הזמנות פעילות, אנונימיזציה מלאה.
// נשמר: הזמנות ומסמכים (חובת שמירה), מנותקים מהזהות (כתובת/מיקום/הערות מושמטים).
r.delete('/', requireAuth, async (req, res) => {
  if (req.user.anonymized_at) return res.status(409).json({ error: 'החשבון כבר נמחק' });
  const uid = req.user.id;
  const code = String((req.body || {}).code || '').trim();
  if (!code) return res.status(400).json({ error: 'נדרש קוד אימות — בקשו קוד דרך "מחיקת החשבון" במסך החשבון' });

  // אימות ה-OTP הייעודי (הקוד העדכני בלבד; עד 10 ניסיונות — בדוגמת B2)
  const { rows: otpRows } = await q(
    `SELECT * FROM account_deletion_otps WHERE user_id=$1 AND NOT consumed AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`, [uid]);
  const otp = otpRows[0];
  if (!otp) return res.status(401).json({ error: 'לא נמצא קוד אימות בתוקף — בקשו קוד חדש' });
  if (otp.attempts >= 10) return res.status(429).json({ error: 'יותר מדי ניסיונות — בקשו קוד חדש' });
  const a = Buffer.from(otp.code_hash, 'hex'), b = Buffer.from(hashOtp(code), 'hex');
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
    await q('UPDATE account_deletion_otps SET attempts=attempts+1 WHERE id=$1', [otp.id]);
    return res.status(401).json({ error: 'קוד שגוי או פג תוקף' });
  }

  const delNotifyPhone = req.user.phone || null; // G17.T35: נלכד לפני ההשמטה — להודעת האישור
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // בדיקת חוסמים חוזרת בתוך הטרנזקציה — מצב עשוי להשתנות אחרי ה-preview
    const { blockers } = await getDeletionState((t2, p) => client.query(t2, p), uid);
    if (blockers.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: blockers[0].message, blockers });
    }
    await client.query('UPDATE account_deletion_otps SET consumed=true WHERE id=$1', [otp.id]);

    /* ---- G17.T7: מחיקה מלאה בכל הטבלאות האישיות (רשימה מכוסה בטסט) ---- */
    await client.query('DELETE FROM user_addresses WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM user_carts WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM push_subscriptions WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM otp_codes WHERE target=$1 OR target=$2', [req.user.phone || '', req.user.email || '']);
    await client.query('DELETE FROM account_deletion_otps WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM bot_sessions WHERE phone=$1 OR phone=$2', [req.user.phone || '', req.user.email || '']).catch(() => {});
    await client.query('DELETE FROM simulated_outbox WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM onboarding_drafts WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM user_laundry_prefs WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM user_notification_prefs WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM user_favorites WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM family_invites WHERE owner_user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM family_members WHERE owner_user_id=$1 OR member_user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM reviews WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM notifications WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM user_messages WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM issue_report_photos WHERE report_id IN (SELECT id FROM issue_reports WHERE customer_id=$1)', [uid]).catch(() => {});
    await client.query(`UPDATE issue_reports SET text='' WHERE customer_id=$1`, [uid]).catch(() => {});
    await client.query('DELETE FROM courier_documents WHERE courier_id IN (SELECT id FROM couriers WHERE user_id=$1)', [uid]).catch(() => {});
    await client.query(`UPDATE couriers SET vehicle=NULL, areas='{}', availability='{}' WHERE user_id=$1`, [uid]).catch(() => {});
    await client.query('DELETE FROM tenant_members WHERE user_id=$1', [uid]);
    await client.query('DELETE FROM business_account_users WHERE user_id=$1', [uid]).catch(() => {});
    await client.query('DELETE FROM recurring_templates WHERE user_id=$1', [uid]).catch(() => {});
    await client.query(`UPDATE subscriptions SET status='cancelled', auto_renew=false, updated_at=now() WHERE user_id=$1 AND status='active'`, [uid]).catch(() => {});
    // ההזמנות נשמרות — אך מנותקות מזהות: כתובת איסוף, מיקום והערות מושמטים
    await client.query(`UPDATE orders SET address='', lat=NULL, lng=NULL, notes=NULL WHERE customer_id=$1`, [uid]);
    await client.query(
      `UPDATE users SET name=NULL, email=NULL, google_sub=NULL, facebook_id=NULL,
         phone='deleted_' || id::text, token_version=token_version+1, anonymized_at=now()
       WHERE id=$1`, [uid]);
    await client.query('COMMIT');
    // G17.T35: יומן ביקורת בלי PII + הודעת אישור ללקוח (למספר שהיה רשום לפני ההשמטה; בדמו — סימולציה בלוג)
    await q(`INSERT INTO audit_log(actor_id, action, target_type) VALUES ($1,'me.delete','user')`, [uid])
      .catch(e => console.error('audit me.delete:', e.message));
    if (delNotifyPhone) {
      const body = 'חשבונך ב״מכבסה בקליק״ נמחק ועבר אנונימיזציה. הזמנות ומסמכים נשמרים מנותקי זהות לפי חובת שמירת הרשומות.';
      const nr = await sendWhatsApp(delNotifyPhone, body).catch(() => ({ sent: false }));
      await q('INSERT INTO notifications(user_id, channel, body, sent) VALUES ($1,$2,$3,$4)',
        [uid, nr.sent ? 'whatsapp' : (nr.simulated ? 'whatsapp-sim' : 'log'), 'החשבון נמחק ועבר אנונימיזציה מלאה.', !!nr.sent]).catch(() => {});
    }
    res.json({ ok: true, message: 'החשבון נמחק ועבר אנונימיזציה מלאה. הזמנות ומסמכים נשמרים לפי חובת שמירת הרשומות, מנותקים מהזהות.' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'שגיאת שרת' });
  } finally { client.release(); }
});

// ביקורת סשנים: רשימת מכשירים מחוברים, ניתוק מכשיר בודד, ניתוק מכל המכשירים האחרים
r.get('/sessions', requireAuth, async (req, res) => {
  const { rows } = await q(
    `SELECT id, user_agent, ip, created_at, last_seen_at, expires_at, (jti=$2) AS current
     FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_seen_at DESC`, [req.user.id, req.sessionJti || '']);
  res.json({ sessions: rows });
});

r.delete('/sessions/:id', requireAuth, async (req, res) => {
  const { rowCount } = await q('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
    [req.params.id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'סשן לא נמצא' });
  res.json({ ok: true });
});

r.post('/sessions/revoke-all', requireAuth, async (req, res) => {
  const { rowCount } = await q('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND jti<>$2',
    [req.user.id, req.sessionJti || '']);
  res.json({ ok: true, revoked: rowCount });
});

module.exports = r;
module.exports.WILL_DELETE = WILL_DELETE;
module.exports.KEPT = KEPT;
