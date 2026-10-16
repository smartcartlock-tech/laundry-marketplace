// G6: keyboard-a11y.js קיים, נטען ב-index.html, ב-precache של sw.js; לוגיקת Esc/מלכודת Tab/החזרת פוקוס
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');

test('keyboard-a11y.js: exists, loaded in index.html, precached in sw.js', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'js', 'keyboard-a11y.js')), 'file exists');
  assert.ok(pub('index.html').includes('/js/keyboard-a11y.js'), 'loaded in index.html');
  assert.ok(pub('sw.js').includes('./js/keyboard-a11y.js'), 'precached in sw.js');
});

test('keyboard-a11y.js: Esc סוגר, Tab לכוד בדיאלוג, פוקוס חוזר', () => {
  const js = pub('js/keyboard-a11y.js');
  assert.match(js, /Escape/, 'Esc handling');
  assert.match(js, /'Tab'/, 'Tab trap');
  assert.match(js, /focusStack/, 'focus restore stack');
  assert.match(js, /modal-ov/, 'generic overlay hook');
  assert.match(js, /#xm-cancel/, 'xmodal cancel');
});

test('keyboard-a11y.js: ARIA לדיאלוגים — aria-labelledby + שיוך תוויות בתוך overlay', () => {
  const js = pub('js/keyboard-a11y.js');
  assert.match(js, /aria-labelledby/, 'dialog labelledby');
  assert.match(js, /dlg-title-/, 'title id');
  assert.match(js, /label\.lb:not\(\[for\]\)/, 'label association inside overlays');
});
