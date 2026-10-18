// T117: רגעי שיא — מסך 'ההזמנה התקבלה!', דיאלוג ביטול מתוקן, מונחים ופורמטים אחידים
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const checkout = fs.readFileSync('public/js/checkout.js', 'utf8');
const orders = fs.readFileSync('public/js/orders.js', 'utf8');
const track = fs.readFileSync('public/js/track.js', 'utf8');
const messages = fs.readFileSync('public/js/messages.js', 'utf8');

test("מסך 'ההזמנה התקבלה!': אישור ברור + סיכום + ציפיות + ניווט", () => {
  const fn = checkout.match(/async function showOrderSuccess\(orderId\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'showOrderSuccess קיימת');
  assert.match(fn[0], /ההזמנה התקבלה!/, 'כותרת חגיגית');
  assert.match(fn[0], /<b>סיכום<\/b>/, 'סיכום הזמנה');
  assert.match(fn[0], /מה הלאה\?/, 'ציפיות — מה קורה עכשיו');
  assert.match(fn[0], /data-act="orderSuccessTrack"/, 'כפתור מעקב');
  assert.match(checkout, /showOrderSuccess\(r\.order\.id\)/, 'submitOrder מוביל למסך ההצלחה');
  assert.ok(checkout.includes("orderSuccessTrack:t=>go('#/orders/'+t.dataset.a)"), 'פעולה רשומה');
});

test("דיאלוג ביטול: 'כן, לבטל' מול 'השאירו את ההזמנה' — בלי בלבול", () => {
  const fn = orders.match(/async function cancelOrder\(id\)\{[^;]*;/);
  assert.ok(fn, 'cancelOrder קיימת');
  assert.match(fn[0], /okText:'כן, לבטל',cancelText:'השאירו את ההזמנה'/, 'שני הכפתורים חד-משמעיים');
  assert.doesNotMatch(fn[0], /xconfirm\('לא ניתן לשחזר/, 'הנוסח הישן הוחלף');
});

test('פורמט ₪ אחיד עם מפריד אלפים; משלוח חינם מילולי', () => {
  const helpers = checkout.match(/function fmtShekel[\s\S]*?\n\}/)[0] + '\n' + checkout.match(/function feeLbl[\s\S]*?\n\}/)[0];
  const { fmtShekel, feeLbl } = new Function(helpers + ';return {fmtShekel,feeLbl}')();
  assert.equal(fmtShekel(1240), '₪1,240', 'מפריד אלפים');
  assert.equal(fmtShekel(0), '₪0');
  assert.equal(feeLbl(0), 'משלוח חינם', 'שליחות 0 מוצגות כחינם');
  assert.equal(feeLbl(15), '₪15');
  assert.doesNotMatch(orders, /₪\$\{o\.total\}/, 'אין ₪ גולמי בלי פורמט בסיכומי הזמנה');
  assert.match(orders, /feeLbl\(o\.delivery_fee\)/, 'שליחות דרך feeLbl');
});

test('תאריכים אחידים dd/mm/yyyy בכל מסכי הלקוח של האפיק', () => {
  const fn = checkout.match(/function fmtDMYT[\s\S]*?\n\}/)[0];
  const fmtDMYT = new Function(fn + ';return fmtDMYT')();
  assert.match(fmtDMYT('2026-10-18T10:30:00Z'), /^18\/10\/2026 /, 'dd/mm/yyyy');
  for (const [name, src] of [['orders', orders], ['track', track], ['messages', messages]]) {
    assert.doesNotMatch(src, /fmtDT\(|fmtDate\(|toLocaleString\('he-IL'\)/, name + ': אין פורמט תאריך לא אחיד');
    assert.match(src, /fmtDMYT\(/, name + ': משתמש בפורמט האחיד');
  }
});
