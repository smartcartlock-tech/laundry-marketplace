// A3+B1: קבצי JS חדשים של צד לקוח קיימים, נטענים ב-index.html ונכללים ב-precache של sw.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');

for (const f of ['js/mode-banner.js', 'js/tenant-checklist.js']) {
  test(`${f}: exists, loaded in index.html, precached in sw.js`, () => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', f)), 'file exists');
    assert.ok(pub('index.html').includes(`/js/${path.basename(f)}`), 'loaded in index.html');
    assert.ok(pub('sw.js').includes(`./js/${path.basename(f)}`), 'precached in sw.js');
  });
}

test('A3: banner only in demo mode, 4242 cleared in pilot', () => {
  const js = pub('js/mode-banner.js');
  assert.match(js, /mode\(\) === 'demo'/, 'banner gated on demo');
  assert.match(js, /mode\(\) === 'pilot'/, 'pilot branch exists');
  assert.match(js, /pay-card/, 'clears prefilled demo card in pilot');
  assert.match(pub('styles.css'), /\.mode-banner/, 'banner style appended');
});
