// T83: צ'אט תמיכה לקוח-מכבסה — בתוך האפליקציה בלבד (בלי התראות החוצה, בלי websockets).
// הרשאות: לקוח רק השרשורים שלו; בעל/צוות מכבסה רק שרשורי הטנאנט שלו; אדמין צופה בהכל
// (בלי שליחה) וכל צפייה מתועדת ב-admin_viewed_at ומוצגת לצדדים כ"צפיית מנהל".
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireAdmin, requireTenantMember } = require('../auth');
const { writeLimiter } = require('../ratelimit');

const r = express.Router();
const BODY_MAX = 2000;

// ניקוי תווי בקרה בלבד — התוכן נשמר כטקסט חופשי ומקודד ב-esc() בצד לקוח (XSS).
function cleanBody(s) {
  return String(s || '').replace(/[--]/g, '').trim();
}

async function tenantMember(tenantId, userId) {
  const { rows } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [tenantId, userId]);
  return !!rows[0];
}

// תפקיד הגישה של המשתמש לשרשור: customer / laundry / admin / null
async function accessRole(thread, user) {
  if (thread.customer_user_id === user.id) return 'customer';
  if (await tenantMember(thread.tenant_id, user.id)) return 'laundry';
  if (user.role === 'admin') return 'admin';
  return null;
}

async function loadThread(id) {
  const { rows } = await q('SELECT * FROM support_threads WHERE id=$1', [id]);
  return rows[0];
}

r.use(requireAuth);
r.use(writeLimiter('chat-write', 60));

// לקוח פותח (או מקבל קיים) שרשור מול מכבסה, אופציונלית על הזמנה שלו
r.post('/threads', async (req, res) => {
  try {
    const slug = String(req.body.slug || '').trim();
    const orderId = req.body.order_id || null;
    const { rows: t } = await q('SELECT id, name FROM tenants WHERE slug=$1', [slug]);
    if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
    if (orderId) {
      const { rows: o } = await q('SELECT 1 FROM orders WHERE id=$1 AND customer_id=$2 AND tenant_id=$3', [orderId, req.user.id, t[0].id]);
      if (!o[0]) return res.status(400).json({ error: 'הזמנה לא נמצאה' });
    }
    const { rows: ex } = await q(
      `SELECT * FROM support_threads WHERE tenant_id=$1 AND customer_user_id=$2 AND status='open'
       AND ((order_id IS NULL AND $3::uuid IS NULL) OR order_id=$3) ORDER BY created_at DESC LIMIT 1`,
      [t[0].id, req.user.id, orderId]);
    if (ex[0]) return res.json({ thread: ex[0], existing: true });
    const { rows } = await q(
      'INSERT INTO support_threads(tenant_id, customer_user_id, order_id) VALUES ($1,$2,$3) RETURNING *',
      [t[0].id, req.user.id, orderId]);
    res.status(201).json({ thread: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// רשימת השרשורים של הלקוח
r.get('/threads/mine', async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT st.id, st.status, st.created_at, st.order_id, st.admin_viewed_at, t.name AS tenant_name, t.slug,
        (SELECT body FROM support_messages m WHERE m.thread_id=st.id ORDER BY ts DESC LIMIT 1) AS last_body,
        (SELECT ts FROM support_messages m WHERE m.thread_id=st.id ORDER BY ts DESC LIMIT 1) AS last_ts,
        (SELECT count(*)::int FROM support_messages m WHERE m.thread_id=st.id AND m.sender_role='laundry' AND m.read_at IS NULL) AS unread
       FROM support_threads st JOIN tenants t ON t.id=st.tenant_id
       WHERE st.customer_user_id=$1 ORDER BY last_ts DESC NULLS LAST, st.created_at DESC LIMIT 50`, [req.user.id]);
    res.json({ threads: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// רשימת שרשורים לבעל מכבסה (טנאנט בלבד) — אדמין רשאי דרך requireTenantMember
r.get('/t/:slug/threads', requireTenantMember, async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT st.id, st.status, st.created_at, st.order_id, st.admin_viewed_at,
        u.name AS customer_name, u.phone AS customer_phone,
        (SELECT body FROM support_messages m WHERE m.thread_id=st.id ORDER BY ts DESC LIMIT 1) AS last_body,
        (SELECT ts FROM support_messages m WHERE m.thread_id=st.id ORDER BY ts DESC LIMIT 1) AS last_ts,
        (SELECT count(*)::int FROM support_messages m WHERE m.thread_id=st.id AND m.sender_role='customer' AND m.read_at IS NULL) AS unread
       FROM support_threads st JOIN users u ON u.id=st.customer_user_id
       WHERE st.tenant_id=$1 ORDER BY last_ts DESC NULLS LAST, st.created_at DESC LIMIT 100`, [req.tenant.id]);
    res.json({ threads: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// צפיית אדמין בכל השרשורים — עם תיעוד "צפיית מנהל" לכל שרשור נפתח
r.get('/admin/threads', requireAdmin, async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT st.id, st.status, st.created_at, st.order_id, st.admin_viewed_at,
        t.name AS tenant_name, t.slug, u.name AS customer_name,
        (SELECT body FROM support_messages m WHERE m.thread_id=st.id ORDER BY ts DESC LIMIT 1) AS last_body,
        (SELECT ts FROM support_messages m WHERE m.thread_id=st.id ORDER BY ts DESC LIMIT 1) AS last_ts
       FROM support_threads st JOIN tenants t ON t.id=st.tenant_id JOIN users u ON u.id=st.customer_user_id
       ORDER BY last_ts DESC NULLS LAST, st.created_at DESC LIMIT 200`);
    res.json({ threads: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// קריאת הודעות שרשור — משתתף או אדמין (אדמין: מתועד כ"צפיית מנהל")
r.get('/threads/:id/messages', async (req, res) => {
  try {
    const thread = await loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'שרשור לא נמצא' });
    const role = await accessRole(thread, req.user);
    if (!role) return res.status(403).json({ error: 'אין הרשאה לשרשור זה' });
    if (role === 'admin') {
      await q('UPDATE support_threads SET admin_viewed_at=now() WHERE id=$1', [thread.id]);
      thread.admin_viewed_at = new Date();
    }
    const after = req.query.after ? new Date(req.query.after) : null;
    const { rows } = await q(
      after && !isNaN(after)
        ? 'SELECT id, sender_role, body, read_at, ts FROM support_messages WHERE thread_id=$1 AND tenant_id=$2 AND ts>$3 ORDER BY ts LIMIT 200'
        : 'SELECT id, sender_role, body, read_at, ts FROM support_messages WHERE thread_id=$1 AND tenant_id=$2 ORDER BY ts LIMIT 200',
      after && !isNaN(after) ? [thread.id, thread.tenant_id, after] : [thread.id, thread.tenant_id]);
    res.json({ thread: { id: thread.id, status: thread.status, order_id: thread.order_id, admin_viewed_at: thread.admin_viewed_at }, viewer_role: role, messages: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// שליחת הודעה — משתתפים בלבד (אדמין צופה בלבד, לא כותב)
r.post('/threads/:id/messages', async (req, res) => {
  try {
    const thread = await loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'שרשור לא נמצא' });
    const role = await accessRole(thread, req.user);
    if (role !== 'customer' && role !== 'laundry') return res.status(403).json({ error: 'אין הרשאה לשרשור זה' });
    if (thread.status !== 'open') return res.status(409).json({ error: 'השרשור סגור' });
    const body = cleanBody(req.body.body);
    if (!body) return res.status(400).json({ error: 'הודעה ריקה' });
    if (body.length > BODY_MAX) return res.status(400).json({ error: 'הודעה ארוכה מדי' });
    const { rows } = await q(
      'INSERT INTO support_messages(thread_id, tenant_id, sender_role, body) VALUES ($1,$2,$3,$4) RETURNING id, sender_role, body, read_at, ts',
      [thread.id, thread.tenant_id, role, body]);
    res.status(201).json({ message: rows[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// סימון נקרא — מסמן את הודעות הצד השני
r.post('/threads/:id/read', async (req, res) => {
  try {
    const thread = await loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'שרשור לא נמצא' });
    const role = await accessRole(thread, req.user);
    if (role !== 'customer' && role !== 'laundry') return res.status(403).json({ error: 'אין הרשאה לשרשור זה' });
    const other = role === 'customer' ? 'laundry' : 'customer';
    const { rowCount } = await q(
      'UPDATE support_messages SET read_at=now() WHERE thread_id=$1 AND tenant_id=$2 AND sender_role=$3 AND read_at IS NULL',
      [thread.id, thread.tenant_id, other]);
    res.json({ ok: true, updated: rowCount });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

// סגירת שרשור — משתתף בלבד
r.post('/threads/:id/close', async (req, res) => {
  try {
    const thread = await loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'שרשור לא נמצא' });
    const role = await accessRole(thread, req.user);
    if (role !== 'customer' && role !== 'laundry') return res.status(403).json({ error: 'אין הרשאה לשרשור זה' });
    await q("UPDATE support_threads SET status='closed' WHERE id=$1", [thread.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
