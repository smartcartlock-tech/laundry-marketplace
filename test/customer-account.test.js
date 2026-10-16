// CX-B1/B2/B3: כתובות (CRUD+ברירת מחדל), העדפות כביסה, מנוי משפחתי (דמו)
const { test } = require('node:test');
const assert = require('node:assert');
const { startApp } = require('./helpers');

test('addresses: הוספה, עריכה, ברירת מחדל יחידה, מחיקה עם קידום', async (t) => {
  const { api } = await startApp(t);
  const c = await api.login('+972500000002');
  const a1 = await api('/api/me/addresses', { method: 'POST', token: c, body: { label: 'בית', address: 'רחוב בוגרשוב 12, תל אביב', courier_note: 'קומה 3, קוד 4471' } });
  assert.equal(a1.status, 201);
  assert.equal(a1.json.address.is_default, true, 'כתובת ראשונה הופכת לברירת מחדל');
  assert.equal(a1.json.address.courier_note, 'קומה 3, קוד 4471');
  const a2 = await api('/api/me/addresses', { method: 'POST', token: c, body: { label: 'עבודה', address: 'רחוב דיזנגוף 100, תל אביב' } });
  assert.equal(a2.status, 201);
  assert.equal(a2.json.address.is_default, false);
  // עריכה
  const up = await api('/api/me/addresses/' + a2.json.address.id, { method: 'PUT', token: c, body: { label: 'משרד', address: 'רחוב דיזנגוף 101, תל אביב', courier_note: 'קוד 1234' } });
  assert.equal(up.status, 200);
  assert.equal(up.json.address.label, 'משרד');
  // החלפת ברירת מחדל — רק אחת
  const d = await api('/api/me/addresses/' + a2.json.address.id + '/default', { method: 'POST', token: c });
  assert.equal(d.status, 200);
  const list = await api('/api/me/addresses', { token: c });
  const defaults = list.json.addresses.filter(x => x.is_default);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, a2.json.address.id);
  // מחיקת ברירת המחדל — מקדמת את הנותרת
  const del = await api('/api/me/addresses/' + a2.json.address.id, { method: 'DELETE', token: c });
  assert.equal(del.status, 200);
  const list2 = await api('/api/me/addresses', { token: c });
  assert.equal(list2.json.addresses.length, 1);
  assert.equal(list2.json.addresses[0].is_default, true);
  // ולידציות
  const bad = await api('/api/me/addresses', { method: 'POST', token: c, body: { address: 'קצר' } });
  assert.equal(bad.status, 400);
  // כפילות
  const dup = await api('/api/me/addresses', { method: 'POST', token: c, body: { address: 'רחוב בוגרשוב 12, תל אביב' } });
  assert.equal(dup.status, 409);
  // ניקוי אחרי הטסט
  await api('/api/me/addresses/' + a1.json.address.id, { method: 'DELETE', token: c });
});

test('laundry prefs: ברירת מחדל, שמירה, ולידציית ריח', async (t) => {
  const { api } = await startApp(t);
  const c = await api.login('+972500000002');
  const d = await api('/api/me/laundry-prefs', { token: c });
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.prefs, { scent: '', softener: false, special_instructions: '' });
  const put = await api('/api/me/laundry-prefs', { method: 'PUT', token: c, body: { scent: 'לבנדר', softener: true, special_instructions: 'כותנה בלבד' } });
  assert.equal(put.status, 200);
  assert.equal(put.json.prefs.scent, 'לבנדר');
  assert.equal(put.json.prefs.softener, true);
  const again = await api('/api/me/laundry-prefs', { token: c });
  assert.equal(again.json.prefs.special_instructions, 'כותנה בלבד');
  const bad = await api('/api/me/laundry-prefs', { method: 'PUT', token: c, body: { scent: 'ורדים מטופלים' } });
  assert.equal(bad.status, 400);
  // ניקוי
  await api('/api/me/laundry-prefs', { method: 'PUT', token: c, body: { scent: '', softener: false, special_instructions: '' } });
});

test('family: הזמנה, הצטרפות, חסימת הצטרפות עצמית ושימוש חוזר', async (t) => {
  const { api } = await startApp(t);
  const owner = await api.login('+972500000002');
  const guest = await api.login('+972500000004');
  // יצירת קישור — אידמפוטנטי כל עוד לא נוצל
  const i1 = await api('/api/me/family/invite', { method: 'POST', token: owner });
  assert.equal(i1.status, 201);
  const i2 = await api('/api/me/family/invite', { method: 'POST', token: owner });
  assert.equal(i2.json.token, i1.json.token);
  // הצטרפות עצמית חסומה
  const self = await api('/api/family/join', { method: 'POST', token: owner, body: { token: i1.json.token } });
  assert.equal(self.status, 400);
  // הצטרפות תקינה
  const j = await api('/api/family/join', { method: 'POST', token: guest, body: { token: i1.json.token } });
  assert.equal(j.status, 200);
  // שימוש חוזר חסום
  const re = await api('/api/family/join', { method: 'POST', token: guest, body: { token: i1.json.token } });
  assert.equal(re.status, 409);
  // טוקן לא קיים
  const nf = await api('/api/family/join', { method: 'POST', token: guest, body: { token: 'nope-nope' } });
  assert.equal(nf.status, 404);
  // רשימת בני משפחה
  const fam = await api('/api/me/family', { token: owner });
  assert.equal(fam.json.members.length, 1);
  assert.ok(fam.json.members[0].phone.includes('•'), 'טלפון ממוסך');
  // ניקוי אחרי הטסט (ישירות מהסכמה של הטסט דרך API אין מחיקה — משאירים דמו)
});
