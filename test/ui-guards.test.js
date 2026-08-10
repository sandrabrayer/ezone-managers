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

test('SW cache version is v5+ (bumped whenever shell files change)', () => {
  const sw = pub('sw.js');
  const m = sw.match(/const CACHE = 'ezone-managers-v(\d+)'/);
  assert.ok(m && Number(m[1]) >= 5);
});

test('top bar drops the "איזון" (E-ZONE) wordmark', () => {
  const html = pub('index.html');
  const header = html.match(/<header class="top-bar">[\s\S]*?<\/header>/);
  assert.ok(header, 'top-bar header must exist');
  assert.doesNotMatch(header[0], /איזון/,
    'the E-ZONE wordmark must not appear in the top bar — header is emblem + app name only');
});

test('top bar shows the app emblem image next to the Hebrew app name', () => {
  const html = pub('index.html');
  const manifest = JSON.parse(pub('manifest.json'));
  const header = html.match(/<header class="top-bar">[\s\S]*?<\/header>/)[0];

  const img = header.match(/<img[^>]*class="brand-emblem"[^>]*>/);
  assert.ok(img, 'top bar must contain a brand-emblem <img>');

  const src = img[0].match(/src="([^"]+)"/);
  assert.ok(src, 'brand-emblem must have a src');
  const iconSrcs = manifest.icons.map((i) => i.src);
  assert.ok(iconSrcs.includes(src[1]),
    `brand-emblem src (${src && src[1]}) must be one of the manifest icons (${iconSrcs.join(', ')})`);

  assert.match(header, /class="brand-name">מנהלים</,
    'top bar must show the app Hebrew name "מנהלים"');
});

test('brand emblem is sized ~30px desktop / 28px mobile and the name does not wrap', () => {
  const css = pub('styles.css');
  assert.match(css, /\.brand-emblem\s*\{[^}]*\bwidth:\s*30px/,
    'brand-emblem is 30px on desktop');
  assert.match(css, /@media\s*\(max-width:\s*480px\)\s*\{\s*\.brand-emblem\s*\{[^}]*\bwidth:\s*28px/,
    'brand-emblem is 28px on mobile (<=480px)');
  assert.match(css, /\.brand-name\s*\{[^}]*white-space:\s*nowrap/,
    'brand-name must not wrap');
});
