// B5: דף תשלום/קבלה פומבי לא חושף PII — כתובת/טלפון רק אחרי 4 ספרות אחרונות של טלפון הלקוח
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

async function makeOrder(api, phone) {
  const customer = await api.login(phone);
  const page = await api('/api/laundries/achuza');
  const item = page.json.items[0];
  const created = await api('/api/orders', { method: 'POST', token: customer,
    body: { slug: 'achuza', items: [{ item_id: item.id, qty: 1 }], address: 'הרצל 12, תל אביב' } });
  return created.json.order.id;
}

test('B5: סיכום תשלום פומבי לא מחזיר כתובת; אימות 4 ספרות חושף; קוד שגוי נדחה', async (t) => {
  const { api, base } = await startApp(t);
  const oid = await makeOrder(api, '+972500000301');

  const sum = await api('/api/pay/' + oid);
  assert.equal(sum.status, 200);
  assert.equal(sum.json.order.address, undefined, 'אין כתובת בסיכום הפומבי');
  assert.ok(sum.json.order.total > 0);

  const wrong = await api(`/api/pay/${oid}/verify`, { method: 'POST', body: { phone_last4: '9999' } });
  assert.equal(wrong.status, 401);
  const short = await api(`/api/pay/${oid}/verify`, { method: 'POST', body: { phone_last4: '03' } });
  assert.equal(short.status, 401);

  const ok = await api(`/api/pay/${oid}/verify`, { method: 'POST', body: { phone_last4: '0301' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.address, 'הרצל 12, תל אביב');
  assert.equal(ok.json.phone, '+972500000301');

  // קבלה פומבית: גם בלי קוד מתקבלת (ממוסכת), גם עם קוד תקין
  const masked = await fetch(`${base}/api/pay/${oid}/receipt.pdf`);
  assert.equal(masked.status, 200);
  assert.match(masked.headers.get('content-type'), /application\/pdf/);
  const full = await fetch(`${base}/api/pay/${oid}/receipt.pdf?v=0301`);
  assert.equal(full.status, 200);
  const mBuf = Buffer.from(await masked.arrayBuffer());
  const fBuf = Buffer.from(await full.arrayBuffer());
  assert.notDeepEqual(mBuf, fBuf, 'קבלה מאומתת שונה מממוסכת');
});

test('B5: ניסיונות אימות מוגבלים בקצב (429 אחרי 10)', async (t) => {
  const { api } = await startApp(t);
  const oid = await makeOrder(api, '+972500000302');
  for (let i = 0; i < 10; i++) {
    const r = await api(`/api/pay/${oid}/verify`, { method: 'POST', body: { phone_last4: '0000' } });
    assert.equal(r.status, 401);
  }
  const blocked = await api(`/api/pay/${oid}/verify`, { method: 'POST', body: { phone_last4: '0302' } });
  assert.equal(blocked.status, 429, 'גם קוד נכון נחסם אחרי חריגה');
});
