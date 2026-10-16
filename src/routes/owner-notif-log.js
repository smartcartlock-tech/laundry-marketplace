// N8: לוג התראות מדומות לבעל מכבסה — מה היה נשלח, למי ובאיזה ערוץ, כדי לראות מראש מה יקרה בפרודקשן אמיתי.
const express = require('express');
const { requireAuth } = require('../auth');
const { requireTenantOwner } = require('../authz');
const { q } = require('../db');

const r = express.Router({ mergeParams: true });

const CHANNEL_HE = {
  whatsapp: 'וואטסאפ (יישלח אמיתי בפרודקשן)',
  push: 'פוש לאפליקציה',
  log: 'סימולציה בלבד — לא נשלח',
  muted: 'הושתק ע"י הלקוח',
  'shabbat-muted': 'הושתק — שבת/חג',
};

r.get('/', requireAuth, requireTenantOwner, async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT n.id, n.channel, n.body, n.sent, n.created_at, u.name AS to_name, u.phone AS to_phone
       FROM notifications n JOIN tenants t ON t.id = n.tenant_id LEFT JOIN users u ON u.id = n.user_id
       WHERE t.slug = $1 ORDER BY n.created_at DESC LIMIT 50`, [req.params.slug]);
    res.json({
      simulated: true,
      note: 'מה שהיה נשלח בפרודקשן אמיתי — בסביבת הדמו לא נשלח דבר לאיש.',
      log: rows.map(x => ({
        id: x.id, at: x.created_at,
        to: x.to_name || '—', phone: x.to_phone || '—',
        channel: x.channel, channel_he: CHANNEL_HE[x.channel] || x.channel,
        sent: x.sent, body: x.body,
      })),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
});

module.exports = r;
