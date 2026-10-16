// נגישות: a11y.js קיים, נטען ב-index.html ונכלל ב-precache של sw.js; כיסוי ממצאי הביקורת
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');

test('a11y.js: exists, loaded in index.html, precached in sw.js', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'js', 'a11y.js')), 'file exists');
  assert.ok(pub('index.html').includes('/js/a11y.js'), 'loaded in index.html');
  assert.ok(pub('sw.js').includes('./js/a11y.js'), 'precached in sw.js');
});

test('a11y.js: toast עטוף עם role=status ו-aria-live', () => {
  const js = pub('js/a11y.js');
  assert.match(js, /origToast/, 'wraps toast');
  assert.match(js, /role','status'/, 'role=status');
  assert.match(js, /aria-live','polite'/, 'aria-live=polite');
});

test('a11y.js: שיוך תוויות לשדות + aria-labels לשדות הטפסים מהביקורת', () => {
  const js = pub('js/a11y.js');
  assert.match(js, /label\.lb:not\(\[for\]\)/, 'label association pass');
  for (const id of ['ap-name', 'ap-city', 'ap-phone', 'ap-est', 'login-target', 'of-status', 'of-from', 'of-to', 'of-text']) {
    assert.ok(js.includes(`'${id}'`), `aria-label for #${id}`);
  }
});

test('a11y.js: ולידציית aria-invalid על טופסי ההצטרפות והכניסה', () => {
  const js = pub('js/a11y.js');
  assert.match(js, /aria-invalid','true'/, 'sets aria-invalid');
  assert.match(js, /submitApplication/, 'wraps join form submit');
  assert.match(js, /requestOtp/, 'wraps OTP request');
  assert.match(js, /verifyOtp/, 'wraps OTP verify');
});

test('styles.css: מטרות מגע 44px במובייל, קישור דילוג, פוקוס נראה, ניגודיות', () => {
  const css = pub('styles.css');
  assert.match(css, /\.skip-link/, 'skip link style');
  assert.match(css, /:focus-visible/, 'visible focus');
  assert.match(css, /\[aria-invalid="true"\]/, 'invalid field style');
  assert.match(css, /\.stepper button\{min-width:44px;min-height:44px/, 'stepper 44px');
  assert.match(css, /\.chip\{min-height:44px/, 'chips 44px');
  assert.match(css, /\.mut\{color:#5a6873\}/, 'contrast AA for muted text');
});
