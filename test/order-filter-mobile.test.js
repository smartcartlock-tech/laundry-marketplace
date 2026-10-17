// P1 מובייל (17.10): שורת הסינון ב"ההזמנות שלי" — בלי סחיטה ב-375px
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

test('orders filter bar: wrap, full-width select, touch targets >=44px', () => {
  const src = fs.readFileSync('public/js/customer-account.js', 'utf8');
  const m = src.match(/<div style="display:flex;flex-wrap:wrap[^>]*>\s*<select class="inp" id="of-status"[^>]*>[\s\S]*?id="of-to"[^>]*>/);
  assert.ok(m, 'סרגל הסינון עם flex-wrap לא נמצא');
  const bar = m[0];
  assert.ok(bar.includes('flex-wrap:wrap'), 'השורה חייבת flex-wrap כדי לא לסחוט ב-375');
  const sel = bar.match(/id="of-status"[^>]*style="([^"]*)"/)[1];
  assert.ok(sel.includes('1 1 100%'), 'בחירת הסטטוס ברוחב מלא — לא נסחטת לחץ בלבד');
  for (const id of ['of-status', 'of-from', 'of-to']) {
    const st = bar.match(new RegExp(`id="${id}"[^>]*style="([^"]*)"`))[1];
    assert.ok(st.includes('min-height:44px'), id + ': יעד מגע >=44px');
    assert.ok(!/(^|;)flex:1;/.test(st), id + ': בלי flex:1 חשוף שגורם לסחיטה');
  }
});
