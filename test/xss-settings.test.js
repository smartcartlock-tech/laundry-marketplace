// אבטחה: Stored XSS בשדות מכבסה — ולידציית שרת + escaping בלקוח
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { startApp } = require('./helpers');

async function ownerLogin(api) {
  const r = await api('/api/auth/otp/request', { method: 'POST', body: { target: '+972500000003' } });
  const v = await api('/api/auth/otp/verify', { method: 'POST', body: { target: '+972500000003', code: r.json.demoCode } });
  return v.json.token;
}

test('PATCH settings דוחה שם עם HTML/JS', async (t) => {
  const { api } = await startApp(t);
  const token = await ownerLogin(api);
  for (const name of [`<img src=x onerror=alert(1)>`, `a"><script>1</script>`]) {
    const r = await api('/api/t/achuza/settings', { method: 'PATCH', token, body: { name } });
    assert.equal(r.status, 400, name);
  }
  // גרש חוקי בשם (גרשיים עברית) — מתקבל ומוצג בטוח דרך esc/data-attributes
  const quoted = await api('/api/t/achuza/settings', { method: 'PATCH', token, body: { name: `מכבסת האחוזה ג'רוש` } });
  assert.equal(quoted.status, 200);
  assert.equal(quoted.json.tenant.name, `מכבסת האחוזה ג'רוש`);
  const ok = await api('/api/t/achuza/settings', { method: 'PATCH', token, body: { name: 'מכבסת האחוזה המשודרגת' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.tenant.name, 'מכבסת האחוזה המשודרגת');
});

test('PATCH settings דוחה צבע שאינו hex', async (t) => {
  const { api } = await startApp(t);
  const token = await ownerLogin(api);
  for (const color of ['red" onmouseover="alert(1)', 'javascript:alert(1)', '#12345', 'rgb(1,2,3)']) {
    const r = await api('/api/t/achuza/settings', { method: 'PATCH', token, body: { color } });
    assert.equal(r.status, 400, color);
  }
  const ok = await api('/api/t/achuza/settings', { method: 'PATCH', token, body: { color: '#a1b2c3' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.tenant.color, '#a1b2c3');
});

test('PATCH settings דוחה שעות זדוניות ומקבל שעות תקינות', async (t) => {
  const { api } = await startApp(t);
  const token = await ownerLogin(api);
  const evil = await api('/api/t/achuza/settings', { method: 'PATCH', token, body: { hours: { 0: [['</span><script>alert(1)</script>', '20:00']] } } });
  assert.equal(evil.status, 400);
  const evil2 = await api('/api/t/achuza/settings', { method: 'PATCH', token, body: { hours: { 7: [['08:00', '20:00']] } } });
  assert.equal(evil2.status, 400);
  const ok = await api('/api/t/achuza/settings', { method: 'PATCH', token, body: { hours: { 0: [['08:00', '13:00'], ['15:00', '20:00']], 2: [['08:00', '20:00']] } } });
  assert.equal(ok.status, 200);
  const pub = await api('/api/laundries/achuza');
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.json.laundry.hours['2'], [['08:00', '20:00']]);
});

test('צד לקוח: אין שדות מכבסה בתוך מחרוזות JS של onclick; צבע עובר cssColor', () => {
  const mk = fs.readFileSync('public/js/marketplace.js', 'utf8');
  assert.ok(!mk.includes("onclick=\"toggleFav('${"), 'toggleFav inline עם שדות');
  assert.ok(!mk.includes("onclick=\"shareLaundry('${"), 'shareLaundry inline');
  assert.ok(mk.includes('data-act="toggleFav"') && mk.includes('data-act="shareLaundry"'), 'data-act attributes');
  assert.ok(mk.includes('cssColor(l.color)'), 'צבע דרך cssColor');
  assert.ok(mk.includes('r.map(x=>esc(x))'), 'שעות עוברות esc');
  for (const f of ['public/js/club.js', 'public/js/orders.js', 'public/js/community.js']) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!s.includes(".color||'#0e7a8a'}"), f + ' צבע גולמי');
  }
});
