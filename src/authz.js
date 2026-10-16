// הרשאות תפקיד משותפות — תשתית לכל המפתחים. דוגמת שימוש (מפתח K):
//   const { requireTenantOwner } = require('../authz');
//   r.put('/financials', requireAuth, requireTenantOwner, handler);
// בעלים בלבד = מנהל פלטפורמה, או חבר tenant שתפקידו owner (לא staff).
const { q } = require('./db');

async function requireTenantOwner(req, res, next) {
  const slug = req.params.slug;
  const { rows: t } = await q('SELECT id FROM tenants WHERE slug=$1', [slug]);
  if (!t[0]) return res.status(404).json({ error: 'מכבסה לא נמצאה' });
  if (req.user.role === 'admin') return next();
  const { rows } = await q('SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2', [t[0].id, req.user.id]);
  if (!rows[0]) return res.status(403).json({ error: 'אין הרשאה למכבסה זו' });
  if (rows[0].role !== 'owner') return res.status(403).json({ error: 'פעולה זו זמינה לבעלים בלבד' });
  next();
}

module.exports = { requireTenantOwner };
