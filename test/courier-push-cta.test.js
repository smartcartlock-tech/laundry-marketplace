// T12: הרשמה להתראות Push ממסכי שליח — CTA במסלול יום ופרופיל + קישור ל-#/notif-settings
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const P = f => path.join(__dirname, '..', 'public', f);

test('courier-day.js: CTA להרשמת Push במסלול יום ובפרופיל, עם זיהוי מנוי קיים', () => {
  const src = fs.readFileSync(P('js/courier-day.js'), 'utf8');
  assert.ok(src.includes('courierPushState'), 'חסרה פונקציית courierPushState');
  assert.ok(src.includes('pushManager.getSubscription'), 'אין בדיקת מנוי קיים');
  const ctaCount = (src.match(/data-act="pushSubscribe"/g) || []).length;
  assert.ok(ctaCount >= 2, 'צפוי CTA לפחות במסלול יום ובפרופיל, נמצא ' + ctaCount);
  assert.ok(/onAct\(\{[\s\S]*pushSubscribe:\s*\(\)\s*=>\s*pushSubscribe/.test(src), 'pushSubscribe לא רשום ב-onAct');
  execSync(`node --check ${JSON.stringify(P('js/courier-day.js'))}`);
});

test('תת-הניווט של מסכי השליח מקשר ל-#/notif-settings', () => {
  const day = fs.readFileSync(P('js/courier-day.js'), 'utf8');
  assert.ok(day.includes('href="#/notif-settings"'), 'courierSubtabs בלי קישור להגדרות התראות');
  const tasks = fs.readFileSync(P('js/courier.js'), 'utf8');
  const chips = (tasks.match(/href="#\/notif-settings"/g) || []).length;
  assert.ok(chips >= 2, 'מסך המשימות/רווחים בלי קישור ל-notif-settings, נמצא ' + chips);
  execSync(`node --check ${JSON.stringify(P('js/courier.js'))}`);
});

test('push.js: פונקציית pushSubscribe קיימת ומעדכנת את #push-btn', () => {
  const src = fs.readFileSync(P('js/push.js'), 'utf8');
  assert.ok(src.includes('async function pushSubscribe'), 'pushSubscribe חסרה');
  assert.ok(src.includes("getElementById('push-btn')"), 'pushSubscribe לא מעדכנת #push-btn');
  assert.ok(src.includes("/push/vapid-public-key") && src.includes("/push/subscribe"), 'נתיבי שרת חסרים');
});
