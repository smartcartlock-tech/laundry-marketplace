// T93 בתוכנית 17.10 (T103): פריט מוסתר (active=false) לא דולף לעמוד הממותג /b/:slug ול-API הציבורי.
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('T103: פריט מוסתר נעלם מ-/b/ ומ-/api/laundries/:slug', async (t) => {
  const { base, api } = await startApp(t);
  const owner = await api.login('+972500000003', 'בעל מכבסה לדמו');

  // פריט חדש גלוי — מופיע בשני הערוצים
  const created = await api('/api/t/achuza/items', { method: 'POST', token: owner, body: { name: 'שמיכת פוך טסט103', price: 55, unit: 'item' } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const itemId = created.json.item.id;

  let landing = await (await fetch(base + '/b/achuza')).text();
  assert.ok(landing.includes('שמיכת פוך טסט103'), 'פריט פעיל מופיע בדף הממותג');
  let pub = await api('/api/laundries/achuza');
  assert.ok(pub.json.items.some(i => i.name === 'שמיכת פוך טסט103'), 'פריט פעיל מופיע ב-API הציבורי');

  // הסתרה (מחיקה רכה = active:false)
  const del = await api('/api/t/achuza/items/' + itemId, { method: 'DELETE', token: owner });
  assert.equal(del.status, 200);

  landing = await (await fetch(base + '/b/achuza')).text();
  assert.ok(!landing.includes('שמיכת פוך טסט103'), 'פריט מוסתר נעלם מהדף הממותג מיד');
  pub = await api('/api/laundries/achuza?nocache=' + Date.now(), { token: owner });
  assert.ok(!pub.json.items.some(i => i.name === 'שמיכת פוך טסט103'), 'פריט מוסתר נעלם מה-API הציבורי');
});
