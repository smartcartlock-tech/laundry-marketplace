// T83 שומרי לקוח: חתימת handlers של onAct לפי delegate.js (מקבלים אלמנט, קוראים dataset) + אייקון מפה בלי URL כפול.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');

test('T83: handlers של support-chat קוראים dataset (delegate מעביר אלמנט, לא ארגומנטים)', () => {
  const src = pub('js/support-chat.js');
  for (const h of ['scOrder', 'scOpenThread', 'scOpenManage', 'scOpenAdmin']) {
    const m = src.match(new RegExp(h + ':(?:async\\s*)?(?:\\(([^)]*)\\)|(\\w+))=>'));
    assert.ok(m, h + ' רשום');
    const args = (m[1] || m[2] || '').trim();
    assert.ok(!/^(a|a,b|a, b)$/.test(args), h + ' לא מקבל (a,b) גולמיים — delegate מעביר אלמנט');
  }
  // כל data-act בקובץ רשום ב-onAct
  const acts = [...new Set([...src.matchAll(/data-act="(sc[A-Za-z]+)"/g)].map(x => x[1]))];
  for (const a of acts) assert.ok(src.includes(a + ':'), a + ' רשום ב-onAct');
});

test('T82: אייקון סמן מפה — בלי שרשור imagePath כפול', () => {
  const src = pub('js/track-map.js');
  assert.ok(src.includes("L.Icon.Default.imagePath=''"), 'imagePath מתאפס כדי למנוע URL כפול');
  assert.ok(src.includes('L.icon({iconUrl'), 'אייקון מפורש עם נתיב מוחלט');
  assert.ok(!src.includes("'/vendor/leaflet/images//vendor"), 'אין URL כפול');
});
