// E6: חברות בקהילת המכבסות — משתמש שחבר במכבסה מאושרת (זהות מכבסה מאומתת)
const { q } = require('./db');

async function myTenant(userId) {
  const { rows } = await q(
    `SELECT t.id, t.name, t.slug FROM tenant_members m JOIN tenants t ON t.id=m.tenant_id
     WHERE m.user_id=$1 AND t.approved ORDER BY m.role='owner' DESC LIMIT 1`, [userId]);
  return rows[0] || null;
}

async function requireCommunityMember(req, res, next) {
  const tenant = await myTenant(req.user.id);
  if (!tenant && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'הקהילה פתוחה לבעלי מכבסות מאומתים בלבד' });
  }
  req.myTenant = tenant;
  next();
}

module.exports = { requireCommunityMember, myTenant };
