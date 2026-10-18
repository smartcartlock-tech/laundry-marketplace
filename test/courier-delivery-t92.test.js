// T92: אישור מסירה — משוב מיידי ('מעבד…' / שגיאה אדומה בחלון בלי סגירה / ✓ אופטימי)
// ואיחוד זרימת המסירה בשני מסכי השליח (משימות + מסלול יום): אין סגירה חד-לחיצתית בלי אישור לקוח.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startApp } = require('./helpers');
const dayJs = fs.readFileSync('public/js/courier-day.js', 'utf8');
const courierJs = fs.readFileSync('public/js/courier.js', 'utf8');

test('חלון קוד: שגיאה אדומה בתוך החלון (role=alert) והחלון לא נסגר על קוד שגוי', () => {
  const fn = dayJs.match(/function courierConfirmDelivery\(orderId,cashPre\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'courierConfirmDelivery קיימת');
  assert.match(fn[0], /id="cd-err" role="alert"/, 'איזור שגיאה ייעודי בתוך החלון');
  assert.match(fn[0], /showErr\(e\.message\)/, 'שגיאת שרת מוצגת בתוך החלון');
  assert.match(fn[0], /ok\.disabled=false;ok\.textContent='אישור מסירה'/, 'כפתור חוזר לפעילות אחרי שגיאה — החלון נשאר פתוח');
  assert.doesNotMatch(fn[0], /xmodal/, 'לא משתמש ב-xmodal הגנרי (נסגר על אישור)');
});

test('חלון קוד: משוב מיידי — מעבד… מהלחיצה, ✓ אופטימי בהצלחה, ועדכון כרטיס (route)', () => {
  const fn = dayJs.match(/function courierConfirmDelivery\(orderId,cashPre\)\{[\s\S]*?\n\}/);
  assert.ok(fn[0].indexOf("ok.textContent='מעבד…'") < fn[0].indexOf('await api('), "'מעבד…' מוצג לפני הקריאה לשרת");
  assert.match(fn[0], /✅<\/div><b>המסירה אושרה<\/b>/, 'מצב ✓ אופטימי בחלון');
  assert.match(fn[0], /toast\('המסירה אושרה ✓'\);route\(\)/, 'עדכון הכרטיס אחרי האישור');
  assert.match(fn[0], /e\.status===0[\s\S]*cqPush/, 'כשל רשת נשמר בתור האופליין');
});

test('חלון צילום: אותו משוב — מעבד…, שגיאה בחלון, ✓ בהצלחה', () => {
  const fn = dayJs.match(/function courierPhotoDelivery\(orderId,cashPre\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'courierPhotoDelivery קיימת');
  assert.match(fn[0], /id="pd-err" role="alert"/, 'איזור שגיאה בתוך חלון הצילום');
  assert.match(fn[0], /btn\.textContent='מעבד…'/, 'מצב עיבוד');
  assert.match(fn[0], /showErr\(e\.message\)/, 'שגיאת שרת בחלון בלי סגירה');
  assert.match(fn[0], /✅<\/div><b>המסירה אושרה עם צילום<\/b>/, 'מצב ✓');
});

test('איחוד זרימה: מסך המשימות מציע אותן שתי אפשרויות האישור, בלי סגירה חד-לחיצתית', () => {
  const ofd = courierJs.match(/\$\{o\.status==='out_for_delivery'\?`[^`]*`:''\}/);
  assert.ok(ofd, 'כפתורי out_for_delivery במסך המשימות');
  assert.match(ofd[0], /data-act="courierConfirmDelivery"/, 'אישור בקוד זמין');
  assert.match(ofd[0], /data-act="courierPhotoDelivery"/, 'אישור בצילום זמין');
  assert.doesNotMatch(courierJs, /data-b="delivered"/, 'אין יותר סגירת מסירה חד-לחיצתית בלי אישור לקוח');
  const day = dayJs.match(/\$\{st\.kind==='deliver'\?`[^`]*`:''\}/);
  assert.ok(day, 'כפתורי deliver במסלול היום');
  assert.equal(day[0].includes('courierConfirmDelivery'), ofd[0].includes('courierConfirmDelivery'), 'אותה זרימה בשני המסכים');
});

test('שרת: קוד שגוי נדחה וההזמנה לא נסגרת — הלקוח יכול לנסות שוב (חוזה שה-UI מסתמך עליו)', async (t) => {
  const { api } = await startApp(t);
  const admin = await api.login('+972500000001');
  const customer = await api.login('+972500000002');
  const courier = await api.login('+972500000005');
  const l = await api('/api/laundries/achuza');
  const item = l.json.items[0];
  const r = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'רחוב הבדיקה 1, תל אביב' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const oid = r.json.order.id;
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'confirmed' } });
  await api('/api/admin/routes/auto-build', { method: 'POST', token: admin, body: {} });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'picked_up' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'in_work' } });
  await api(`/api/t/achuza/orders/${oid}/status`, { method: 'POST', token: admin, body: { status: 'ready' } });
  await api(`/api/courier/orders/${oid}/mark`, { method: 'POST', token: courier, body: { action: 'out_for_delivery' } });
  const wrong = await api(`/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code: '999999', cash: { outcome: 'collected' } } });
  assert.equal(wrong.status, 400, 'קוד שגוי נדחה');
  assert.match(wrong.json.error, /שגוי/, 'הודעה מילולית ברורה לתצוגה בחלון');
  const track = await api(`/api/courier/day-route`, { token: courier });
  const stop = track.json.stops.find(s => s.order.id === oid);
  assert.ok(stop && !stop.done, 'ההזמנה נשארה פתוחה אחרי קוד שגוי — אפשר לנסות שוב');
  const code = (await api('/api/orders/' + oid, { token: admin })).json.order.delivery_code;
  assert.ok(/^[0-9]{6}$/.test(code), 'קוד מסירה בן 6 ספרות');
  const ok = await api(`/api/courier/orders/${oid}/confirm-delivery`, { method: 'POST', token: courier, body: { method: 'code', code, cash: { outcome: 'collected' } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});
