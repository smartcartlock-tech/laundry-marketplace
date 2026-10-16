// N9: מרוץ סטטוס בלוח הניהול — הכפתור נועל עד תגובה, ו-409 מסטטוס מיושן מרענן בשקט
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startApp } = require('./helpers');

test('N9: שרת — POST כפול לאותו סטטוס מחזיר 409 "ברצף" גם במקביל', async (t) => {
  const { api } = await startApp(t);
  const customer = await api.login('+972500000002');
  const owner = await api.login('+972500000003');

  const page = await api('/api/laundries/achuza');
  const bag = page.json.items.find(i => i.name.includes('שק'));
  const created = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12' } });
  assert.equal(created.status, 201);
  const oid = created.json.order.id;
  const url = `/api/t/achuza/orders/${oid}/status`;

  // רציף: ראשון מצליח, שנייה על אותו יעד (כפתור מיושן/לחיצה כפולה) — 409 עם ההודעה שהלקוח מזהה
  const first = await api(url, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  assert.equal(first.status, 200);
  const repeat = await api(url, { method: 'POST', token: owner, body: { status: 'confirmed' } });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.json.error, 'מעבר סטטוס חייב להיות לשלב הבא ברצף');

  // במקביל על הזמנה חדשה: בדיוק אחד מצליח
  const created2 = await api('/api/orders', { method: 'POST', token: customer, body: { slug: 'achuza', items: [{ item_id: bag.id, qty: 1 }], address: 'הרצל 12' } });
  assert.equal(created2.status, 201);
  const url2 = `/api/t/achuza/orders/${created2.json.order.id}/status`;
  const [a, b] = await Promise.all([
    api(url2, { method: 'POST', token: owner, body: { status: 'confirmed' } }),
    api(url2, { method: 'POST', token: owner, body: { status: 'confirmed' } }),
  ]);
  const codes = [a.status, b.status].sort();
  assert.deepEqual(codes, [200, 409], 'one wins, one gets the sequence 409');
});

test('N9: לקוח — הכפתור ננעל עד תגובה ו-409 של סטטוס מיושן מרענן בלי טוסט שגיאה', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'community.js'), 'utf8');
  assert.ok(src.includes('_statusLocks'), 'in-flight lock set exists');
  assert.ok(src.includes('if(_statusLocks.has(id))return;'), 'duplicate click ignored while in flight');
  assert.ok(src.includes('btn.disabled=true'), 'button disabled during request');
  assert.ok(src.includes("e.status===409&&e.message==='מעבר סטטוס חייב להיות לשלב הבא ברצף'"), 'stale-state 409 handled explicitly');
  assert.ok(/409&&e\.message==='מעבר סטטוס חייב להיות לשלב הבא ברצף'\)\{route\(\);return\}/.test(src), 'stale 409 refreshes quietly instead of error toast');
  assert.ok(src.includes("setStatus:t=>setStatus(t.dataset.a,t.dataset.b,t.dataset.c,t)"), 'registration passes the button element');
});
