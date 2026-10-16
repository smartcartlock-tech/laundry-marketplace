// B1 (מוצר): צ'ק-ליסט מוכנות מכבסה — מה חסר לפני go-live.
// GET /api/t/:slug/checklist — בעלים/צוות בלבד. מחזיר פריטים + אחוז השלמה + פעולה מתקנת לכל פריט.
const express = require('express');
const { q } = require('../db');
const { requireAuth, requireTenantMember } = require('../auth');

const r = express.Router({ mergeParams: true });
r.use(requireAuth, requireTenantMember);

r.get('/checklist', async (req, res) => {
  const t = req.tenant;
  const [prices, windows, couriers] = await Promise.all([
    q('SELECT count(*)::int AS n FROM price_items WHERE tenant_id=$1', [t.id]),
    q("SELECT count(*)::int AS n FROM pickup_windows WHERE tenant_id=$1 AND kind='pickup'", [t.id]),
    q('SELECT count(*)::int AS n FROM couriers WHERE tenant_id=$1', [t.id]),
  ]);
  const hoursSet = t.hours && Object.keys(t.hours).length > 0;
  const items = [
    { key: 'prices',   label: 'מחירון לא ריק',        done: prices.rows[0].n > 0,                          action: 'הוסף פריטים למחירון' },
    { key: 'window',   label: 'חלון איסוף מוגדר',      done: windows.rows[0].n > 0,                         action: 'הגדר לפחות חלון איסוף אחד' },
    { key: 'hours',    label: 'שעות פעילות מוגדרות',   done: !!hoursSet,                               action: 'מלא שעות פתיחה וסגירה' },
    { key: 'phone',    label: 'טלפון עסקי',            done: !!(t.phone && String(t.phone).trim()),    action: 'הוסף מספר טלפון ליצירת קשר' },
    { key: 'logo',     label: 'לוגו',                  done: !!t.logo,                                 action: 'העלה לוגו של המכבסה' },
    { key: 'address',  label: 'כתובת עם מיקום מפה',    done: !!(t.address && t.lat != null && t.lng != null), action: 'השלם כתובת וסמן מיקום על המפה' },
    { key: 'courier',  label: 'שליח צמוד למכבסה',     done: couriers.rows[0].n > 0,                        action: 'צרף שליח צמוד — לא חובה אם אתם מסתמכים על שליחי הפלטפורמה/המשותפים' },
  ];
  const doneCount = items.filter(i => i.done).length;
  res.json({ items, done: doneCount, total: items.length,
    percent: Math.round(100 * doneCount / items.length), complete: doneCount === items.length });
});

module.exports = r;
