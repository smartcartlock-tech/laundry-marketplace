const jwt = require('jsonwebtoken');
const { q } = require('./db');

const SECRET = () => process.env.JWT_SECRET || 'dev-insecure-secret';

function sign(user) {
  return jwt.sign({ uid: user.id }, SECRET(), { expiresIn: '60d' });
}

async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'נדרשת התחברות' });
    const payload = jwt.verify(token, SECRET());
    const { rows } = await q('SELECT * FROM users WHERE id=$1', [payload.uid]);
    if (!rows[0]) return res.status(401).json({ error: 'משתמש לא נמצא' });
    req.user = rows[0];
    next();
  } catch (e) { return res.status(401).json({ error: 'טוקן לא תקין' }); }
}

async function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'נדרשת הרשאת מנהל פלטפורמה' });
  next();
}

// טוען tenant לפי :slug ומוודא שהמשתמש חבר בו (בעלים/צוות)
async function requireTenantMember(req, res, next) {
  const { rows: t } = await q('SELECT * FROM tenants WHERE slug=$1', [req.params.slug]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  req.tenant = t[0];
  if (req.user.role === 'admin') return next();
  const { rows } = await q('SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [t[0].id, req.user.id]);
  if (!rows[0]) return res.status(403).json({ error: 'אין הרשאה למכבסה זו' });
  next();
}

async function requireCourier(req, res, next) {
  const { rows } = await q('SELECT * FROM couriers WHERE user_id=$1', [req.user.id]);
  if (!rows[0]) return res.status(403).json({ error: 'נדרשת הרשאת שליח' });
  req.courier = rows[0];
  next();
}

module.exports = { sign, requireAuth, requireAdmin, requireTenantMember, requireCourier };
