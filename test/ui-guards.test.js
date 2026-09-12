'use strict';
/* UI guard tests — static checks on public/ files that catch regressions a
 * unit test can't (CSS/HTML interplay). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('no login UI remains in the shell (the app is open to every visitor)', () => {
  const html = pub('index.html');
  const css = pub('styles.css');
  for (const needle of ['loginOverlay', 'loginPin', 'loginBtn', 'login-card', 'קוד גישה']) {
    assert.ok(!html.includes(needle), `index.html still carries login markup: ${needle}`);
  }
  assert.ok(!css.includes('.login-overlay'), 'the login overlay CSS is dead code');
});

test('app.js has no login code path and sends no session token', () => {
  const js = pub('app.js');
  for (const needle of ['showLogin', 'submitLogin', 'wireLogin', '/api/login', 'Authorization', 'Bearer']) {
    assert.ok(!js.includes(needle), `app.js still carries login code: ${needle}`);
  }
  assert.ok(js.includes('clearLegacySession'),
    'a stale PIN-era token from a returning visitor must be cleared on boot');
});

test('the shell has no inline <script> (CSP is script-src self)', () => {
  const html = pub('index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]*\S/.test(html),
    'inline scripts are blocked by the CSP — use an external file');
  assert.ok(html.includes('/sw-register.js'), 'SW registration moved to its own file');
});

test('robots.txt disallows the whole app', () => {
  const txt = pub('robots.txt');
  assert.match(txt, /User-agent:\s*\*/i);
  assert.match(txt, /Disallow:\s*\//);
});

test('no redaction machinery is left behind in the client', () => {
  const js = pub('app.js');
  const css = pub('styles.css');
  assert.ok(!js.includes('nameHidden'), 'the redaction flag is gone from the client');
  assert.ok(!js.includes('מוסתר'), 'names render normally — no withheld label');
  assert.ok(!css.includes('is-redacted'), 'the redacted-name style is dead code');
});

test('the patient name is still escaped before it reaches innerHTML', () => {
  const js = pub('app.js');
  // The Patients sheet is hand-edited and the name goes into innerHTML. This
  // escape is an XSS fix, independent of who may see the name.
  assert.match(js, /<span class="log-name">\$\{escapeHtml_\(item\.name\)/,
    'activityRowHtml must escape item.name — never interpolate it raw');
  assert.ok(!/<span class="log-name">\$\{item\.name/.test(js),
    'a raw name interpolation would let a spreadsheet cell inject markup');
});

test('SW cache version is v12+ (bumped whenever shell files change)', () => {
  const sw = pub('sw.js');
  const m = sw.match(/const CACHE = 'ezone-managers-v(\d+)'/);
  assert.ok(m && Number(m[1]) >= 12);
});

test('top bar drops the "איזון" (E-ZONE) wordmark', () => {
  const html = pub('index.html');
  const header = html.match(/<header class="top-bar">[\s\S]*?<\/header>/);
  assert.ok(header, 'top-bar header must exist');
  assert.doesNotMatch(header[0], /איזון/,
    'the E-ZONE wordmark must not appear in the top bar — header is emblem + app name only');
});

test('top bar shows the shared E-ZONE emblem next to the Hebrew app name', () => {
  const html = pub('index.html');
  const header = html.match(/<header class="top-bar">[\s\S]*?<\/header>/)[0];

  const img = header.match(/<img[^>]*class="brand-emblem"[^>]*>/);
  assert.ok(img, 'top bar must contain a brand-emblem <img>');

  const src = img[0].match(/src="([^"]+)"/);
  assert.ok(src, 'brand-emblem must have a src');
  // Header branding rollout: the header carries the amber E-ZONE emblem shared
  // across the ecosystem (copied from ezone-coordinators), NOT this app's own
  // PWA icon — the manifest icons stay app-specific.
  assert.equal(src[1], '/icons/ezone-emblem-192.png',
    `brand-emblem src (${src && src[1]}) must be the shared amber E-ZONE emblem`);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'icons', 'ezone-emblem-192.png')),
    'the shared emblem asset must be committed at public/icons/ezone-emblem-192.png');

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
