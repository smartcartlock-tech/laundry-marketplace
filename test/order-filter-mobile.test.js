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

test('bottom tabs: 7 לשוניות לא גולשות מעבר לרוחב המסך (min-width:0)', () => {
  const css = fs.readFileSync('public/styles.css', 'utf8');
  const rule = css.match(/#tabs a\{([^}]*)\}/);
  assert.ok(rule, 'כלל #tabs a לא נמצא');
  assert.ok(rule[1].includes('min-width:0'), '#tabs a חייב min-width:0 כדי שהטקסט יכול להצטמצם ב-375');
  const tabs = fs.readFileSync('public/js/tabs.js', 'utf8');
  assert.ok(tabs.includes('החשבון שלי'), 'T19: הלשונית הקבועה קיימת');
});
