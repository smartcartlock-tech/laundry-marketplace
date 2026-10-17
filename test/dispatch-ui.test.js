// T81: מסך שליח — הצגת הצעות שיבוץ אוטומטי (fetch, תגית, פעולות, רישום handlers)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync('public/js/courier-day.js', 'utf8');

test('כרטיס ההצעות מושך גם הצעות שיבוץ אוטומטי ומציג תגית מזהה', () => {
  assert.match(src, /api\('\/dispatch\/offers'\)/, 'שליפת /dispatch/offers');
  assert.match(src, /שיבוץ אוטומטי/, 'תגית מזהה להצעה אוטומטית');
  assert.match(src, /data-act="courierDispatchAccept"/, 'כפתור קבלה');
  assert.match(src, /data-act="courierDispatchDecline"/, 'כפתור דחייה');
});

test('פעולות קבלה/דחייה מחוברות ל-onAct ופונות לנקודות ה-dispatch', () => {
  assert.match(src, /courierDispatchAccept:t=>courierDispatchAccept/, 'רישום accept');
  assert.match(src, /courierDispatchDecline:t=>courierDispatchDecline/, 'רישום decline');
  assert.match(src, /api\('\/dispatch\/offers\/'\+offerId\+'\/accept'/, 'קריאת accept');
  assert.match(src, /api\('\/dispatch\/offers\/'\+offerId\+'\/decline'/, 'קריאת decline');
});

test('שרת: route של dispatch רשום ו-hook על confirmed', () => {
  const server = fs.readFileSync('src/server.js', 'utf8');
  assert.match(server, /app\.use\('\/api\/dispatch', require\('\.\/routes\/dispatch'\)\)/, 'mount ב-server.js');
  const tenant = fs.readFileSync('src/routes/tenant.js', encoding = 'utf8');
  assert.match(tenant, /autodispatch.*status-confirmed/, 'הוק שיבוץ על מעבר ל-confirmed');
});
