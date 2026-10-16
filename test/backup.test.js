// גיבוי/ייצוא: הרשאות אדמין, מבנה התשובה, ותכולת טבלאות ליבה.
const test = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('GET /api/admin/export דורש אדמין ומחזיר dump מלא', async (t) => {
  const { api } = await startApp(t);
  const noAuth = await api('/api/admin/export');
  assert.equal(noAuth.status, 401);
  const token = await api.login('+972500000001');
  const ok = await api('/api/admin/export', { token });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.exported_at);
  assert.ok(ok.json.tables.tenants.length >= 4, '4 מכבסות דמו');
  assert.ok(ok.json.tables.users.length >= 5, 'משתמשי דמו');
  assert.ok(ok.json.tables.price_items.length > 0);
});
