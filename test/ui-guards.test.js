'use strict';
/* UI guard tests — static checks on public/ files that catch regressions a
 * unit test can't (CSS/HTML interplay). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('login overlay: [hidden] must actually hide it (display:flex would win otherwise)', () => {
  const css = pub('styles.css');
  assert.match(css, /\.login-overlay\[hidden\]\s*\{\s*display:\s*none/, 
    '.login-overlay[hidden]{display:none} is required — the base rule sets display:flex, which overrides the UA hidden rule');
});

test('login overlay markup starts hidden and app.js controls it via the hidden property', () => {
  const html = pub('index.html');
  assert.match(html, /id="loginOverlay"[^>]*\bhidden\b/);
  const js = pub('app.js');
  assert.ok(js.includes('ov.hidden = false'), 'showLogin must clear hidden');
  assert.ok(js.includes('ov.hidden = true'), 'hideLogin must set hidden');
});

test('SW cache version is v3+ (bumped whenever shell files change)', () => {
  const sw = pub('sw.js');
  const m = sw.match(/const CACHE = 'ezone-managers-v(\d+)'/);
  assert.ok(m && Number(m[1]) >= 3);
});
