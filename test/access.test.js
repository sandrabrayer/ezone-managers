'use strict';
/* The app is fully open: no password, no key, no cookie.
 *
 * Covers: every route works with no credential of any kind, the feed reaches
 * the client complete (patient names included), no login UI or login route
 * exists, the rate limit still caps the open proxy, the security headers and
 * robots.txt are present, and no SERVER secret (the Apps Script URL) leaks
 * into a response.
 *
 * All env values below are dummies and global.fetch is MOCKED — no test ever
 * reaches the real Apps Script. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app, _rateLimiters } = require('../server');

const PATIENT = 'ישראל ישראלי';

const HOUSE_PAYLOAD = JSON.stringify({
  ok: true,
  month: '2026-09',
  key: 'ramot',
  name: 'רמות השבים',
  manager: 'אורן',
  entriesMonth: 1,
  exitsMonth: 1,
  activity: [
    { date: '2026-09-03', kind: 'entry', name: PATIENT },
    { date: '2026-09-11', kind: 'exit', name: 'דנה כהן' }
  ]
});

function request(server, path, { headers, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
    });
    req.on('error', reject);
    req.end();
  });
}

function mockUpstream(body, { status = 200, contentType = 'application/json' } = {}) {
  global.fetch = async () => ({
    status,
    text: async () => body,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) }
  });
}

test('fully open app', async (t) => {
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  t.beforeEach(() => { _rateLimiters.allowSheets.clear(); });

  // ── every route works with no credential ─────────────────────────
  await t.test('the app shell is served with no key and no cookie', async () => {
    const r = await request(server, '/');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('houseDetailTpl'));
  });

  await t.test('/api/sheets works with no key and no cookie', async () => {
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(r.text).ok, true);
  });

  await t.test('a deep link to a house tab is served the shell, not a gate', async () => {
    const r = await request(server, '/ramot');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('houseDetailTpl'));
  });

  await t.test('/healthz is open', async () => {
    const r = await request(server, '/healthz');
    assert.equal(r.status, 200);
  });

  // ── the feed reaches the client complete ─────────────────────────
  await t.test('patient names ARE returned — no redaction anywhere', async () => {
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersHouse&house=ramot');
    assert.ok(r.text.includes(PATIENT), 'the name must reach the client unchanged');
    assert.ok(r.text.includes('דנה כהן'));
    const body = JSON.parse(r.text);
    for (const row of body.activity) {
      assert.equal(typeof row.name, 'string');
      assert.equal('nameHidden' in row, false, 'the redaction flag is gone');
    }
  });

  await t.test('the upstream body is passed through byte-for-byte', async () => {
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersHouse&house=ramot');
    assert.equal(r.text, HOUSE_PAYLOAD);
  });

  await t.test('a non-JSON upstream body is passed through as-is (no redaction step)', async () => {
    mockUpstream('<html>upstream said no</html>', { contentType: 'text/html' });
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.status, 200);
    assert.equal(r.text, '<html>upstream said no</html>');
  });

  // ── nothing gate-shaped remains ──────────────────────────────────
  await t.test('there is no login route', async () => {
    const r = await request(server, '/api/login', { method: 'POST' });
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.text).error, 'not found');
  });

  await t.test('the shell carries no login markup', async () => {
    const r = await request(server, '/');
    for (const needle of ['loginOverlay', 'loginPin', 'קוד גישה', 'מוסתר']) {
      assert.ok(!r.text.includes(needle), `shell still carries ${needle}`);
    }
  });

  await t.test('a ?key= param is now just an ignored query param — 200, no cookie, no redirect', async () => {
    const r = await request(server, '/?key=anything-at-all');
    assert.equal(r.status, 200, 'no key check, so no 404 and no redirect');
    assert.equal(r.headers['set-cookie'], undefined, 'no cookie is ever set');
    assert.equal(r.headers.location, undefined);
  });

  await t.test('a leftover cookie from the key era changes nothing', async () => {
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersHouse&house=ramot', {
      headers: { Cookie: 'ezm_full=1789794151242.deadbeef; ezm_session_token=stale' }
    });
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(PATIENT));
    assert.equal(r.headers['set-cookie'], undefined);
  });

  await t.test('the server never sets a cookie on any route', async () => {
    for (const p of ['/', '/healthz', '/robots.txt', '/api/sheets?action=managersOverview']) {
      mockUpstream('{"ok":true}');
      const r = await request(server, p);
      assert.equal(r.headers['set-cookie'], undefined, `a cookie was set on ${p}`);
    }
  });

  // ── rate limit ───────────────────────────────────────────────────
  await t.test('/api/sheets is rate-limited per IP (300 per window)', async () => {
    mockUpstream('{"ok":true}');
    let last;
    for (let i = 0; i < 301; i++) last = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(last.status, 429);
    assert.equal(JSON.parse(last.text).error, 'יותר מדי בקשות. נסו שוב מאוחר יותר.');
  });

  await t.test('the rate limit does not apply to the app shell itself', async () => {
    mockUpstream('{"ok":true}');
    for (let i = 0; i < 301; i++) await request(server, '/api/sheets?action=managersOverview');
    const r = await request(server, '/');
    assert.equal(r.status, 200, 'a rate-limited visitor can still load the page');
  });

  // ── headers, robots, secrets ─────────────────────────────────────
  await t.test('X-Robots-Tag: noindex, nofollow on every response', async () => {
    for (const p of ['/', '/healthz', '/robots.txt', '/api/sheets?action=managersOverview']) {
      mockUpstream('{"ok":true}');
      const r = await request(server, p);
      assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow', `missing on ${p}`);
    }
  });

  await t.test('robots.txt disallows everything', async () => {
    const r = await request(server, '/robots.txt');
    assert.equal(r.status, 200);
    assert.match(r.text, /User-agent:\s*\*/i);
    assert.match(r.text, /Disallow:\s*\//);
  });

  await t.test('security headers are set', async () => {
    const r = await request(server, '/');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(r.headers['x-powered-by'], undefined);
  });

  await t.test('the index.html CSP holds: no inline <script> in the shell', async () => {
    const r = await request(server, '/');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]*\S/.test(r.text),
      'an inline script would be blocked by script-src \'self\'');
  });

  await t.test('the Apps Script URL never appears in a response', async () => {
    mockUpstream('{"ok":true}');
    for (const p of ['/', '/app.js', '/healthz', '/api/sheets?action=managersOverview']) {
      const r = await request(server, p);
      assert.ok(!r.text.includes('apps-script.test'), `APPS_SCRIPT_URL leaked on ${p}`);
      assert.ok(!r.text.includes('/exec'), `Apps Script /exec URL leaked on ${p}`);
    }
  });

  await t.test('a proxy exception returns no detail (the URL can appear in err.message)', async () => {
    global.fetch = async () => { throw new Error(`Failed to parse URL from ${process.env.APPS_SCRIPT_URL}`); };
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.status, 502);
    assert.deepEqual(JSON.parse(r.text), { error: 'upstream_error' });
    assert.ok(!r.text.includes('apps-script.test'));
  });

  await t.test('no server-only module is reachable over HTTP', async () => {
    for (const f of ['/lib/auth.js', '/lib/redact.js', '/server.js', '/package.json']) {
      const r = await request(server, f);
      // Deleted or unmounted: the SPA shell answers, never module source.
      assert.ok(!r.text.includes('createHmac'), `${f} source was served`);
      assert.ok(!r.text.includes('APPS_SCRIPT_URL'), `${f} source was served`);
    }
  });

  await t.test('client-shared lib/bonus-eligibility.js IS served', async () => {
    const r = await request(server, '/lib/bonus-eligibility.js');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('tierForPatients') || r.text.includes('bonus'));
  });

  await t.test('the proxy still forwards ONLY allowlisted query keys', async () => {
    let seen = null;
    global.fetch = async (url) => {
      seen = String(url);
      return { status: 200, text: async () => '{"ok":true}', headers: { get: () => null } };
    };
    await request(server, '/api/sheets?action=managersHouse&house=ramot&month=2026-07&evil=1&key=x');
    const qs = new URL(seen).searchParams;
    assert.equal(qs.get('action'), 'managersHouse');
    assert.equal(qs.get('house'), 'ramot');
    assert.equal(qs.get('month'), '2026-07');
    assert.equal(qs.has('evil'), false);
    assert.equal(qs.has('key'), false);
  });
});
