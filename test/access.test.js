'use strict';
/* Open app + private full view (Option C).
 *
 * Covers: no login anywhere, the anonymous view never carries a patient name,
 * the ?key= link unlocks the full view through an httpOnly cookie, a wrong or
 * missing key is an indistinguishable 404, both rate limits, the security
 * headers and robots.txt, and that no server secret leaks into any response.
 *
 * All env values below are dummies and global.fetch is MOCKED — no test ever
 * reaches the real Apps Script. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
process.env.FULL_VIEW_KEY = 'F'.repeat(48);

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app, _rateLimiters, COOKIE_NAME } = require('../server');

const KEY = process.env.FULL_VIEW_KEY;
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

/* Runs the ?key= handshake and returns the Cookie header a browser would
 * send back afterwards. */
function cookieFrom(res) {
  const setCookie = res.headers['set-cookie'] || [];
  const target = setCookie.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return target ? target.split(';')[0] : '';
}

test('open app + private full view', async (t) => {
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  t.beforeEach(() => {
    _rateLimiters.allowSheets.clear();
    _rateLimiters.allowKeyCheck.clear();
  });

  // ── no login remains ─────────────────────────────────────────────
  await t.test('/api/login is gone (404 JSON, not a login handler)', async () => {
    const r = await request(server, '/api/login', { method: 'POST' });
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.text).error, 'not found');
  });

  await t.test('the app shell is served with no login markup', async () => {
    const r = await request(server, '/');
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes('loginOverlay'));
    assert.ok(!r.text.includes('קוד גישה'));
  });

  // ── anonymous view ───────────────────────────────────────────────
  await t.test('/api/sheets works with NO login and NO key', async () => {
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(r.text).ok, true);
  });

  await t.test('anonymous response body contains NO patient name', async () => {
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersHouse&house=ramot');
    assert.ok(!r.text.includes(PATIENT), 'patient name leaked into the anonymous view');
    assert.ok(!r.text.includes('דנה כהן'));
    const body = JSON.parse(r.text);
    for (const row of body.activity) {
      assert.equal('name' in row, false);
      assert.equal(row.nameHidden, true);
    }
  });

  await t.test('anonymous view keeps counts, dates and kinds', async () => {
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersHouse&house=ramot');
    const body = JSON.parse(r.text);
    assert.equal(body.entriesMonth, 1);
    assert.equal(body.exitsMonth, 1);
    assert.deepEqual(body.activity.map((a) => a.date), ['2026-09-03', '2026-09-11']);
    assert.deepEqual(body.activity.map((a) => a.kind), ['entry', 'exit']);
    assert.equal(body.manager, 'אורן', 'a manager is staff, not a patient');
  });

  await t.test('an unparseable upstream body is refused, never passed through', async () => {
    mockUpstream('<html>Apps Script exception: patient ' + PATIENT + '</html>',
      { contentType: 'text/html' });
    const r = await request(server, '/api/sheets?action=managersHouse&house=ramot');
    assert.equal(r.status, 502);
    assert.ok(!r.text.includes(PATIENT));
  });

  // ── the ?key= handshake ──────────────────────────────────────────
  await t.test('a valid key sets an httpOnly cookie and redirects the key out of the URL', async () => {
    const r = await request(server, `/?key=${KEY}`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/');
    const setCookie = (r.headers['set-cookie'] || []).join(';');
    assert.match(setCookie, new RegExp(`${COOKIE_NAME}=`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.ok(!setCookie.includes(KEY), 'the raw key must never be the cookie value');
  });

  await t.test('the cookie unlocks the FULL view — patient names present', async () => {
    const handshake = await request(server, `/?key=${KEY}`);
    const cookie = cookieFrom(handshake);
    assert.ok(cookie);
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersHouse&house=ramot', {
      headers: { Cookie: cookie }
    });
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(PATIENT), 'the full view must still show patient names');
  });

  await t.test('a valid key on a deep path keeps the path and other params', async () => {
    const r = await request(server, `/?key=${KEY}&tab=ramot`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/?tab=ramot');
  });

  await t.test('a wrong key → bare 404 with no hint that a key exists', async () => {
    const r = await request(server, '/?key=wrong-key-value');
    assert.equal(r.status, 404);
    assert.equal(r.text, 'Not Found');
    assert.ok(!r.text.includes('key'));
    assert.ok(!r.text.includes('מפתח'));
    assert.equal(r.headers['set-cookie'], undefined, 'a wrong key must set no cookie');
  });

  await t.test('a forged cookie signed with another key does not unlock the full view', async () => {
    const { signToken } = require('../lib/auth');
    const forged = signToken('w'.repeat(48), 1);
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersHouse&house=ramot', {
      headers: { Cookie: `${COOKIE_NAME}=${forged}` }
    });
    assert.ok(!r.text.includes(PATIENT));
  });

  await t.test('a garbage cookie degrades to the anonymous view, never an error screen', async () => {
    mockUpstream(HOUSE_PAYLOAD);
    const r = await request(server, '/api/sheets?action=managersOverview', {
      headers: { Cookie: 'ezm_session_token=old-pin-era-token; ezm_full=nonsense' }
    });
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes(PATIENT));
  });

  await t.test('the shell is served normally to a visitor holding an old session token', async () => {
    const r = await request(server, '/', {
      headers: { Cookie: 'ezm_session_token=stale' }
    });
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('houseDetailTpl'));
  });

  await t.test('a protocol-relative path cannot turn the handshake into an open redirect', async () => {
    const r = await request(server, `//evil.example.com/?key=${KEY}`);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/');
  });

  // ── rate limits ──────────────────────────────────────────────────
  await t.test('the key check is rate-limited (10 per window) and stays a 404', async () => {
    let last;
    for (let i = 0; i < 11; i++) last = await request(server, '/?key=wrong');
    assert.equal(last.status, 404);
    // even the CORRECT key is refused while limited, with the same bare 404
    const r = await request(server, `/?key=${KEY}`);
    assert.equal(r.status, 404);
    assert.equal(r.text, 'Not Found');
    assert.equal(r.headers['set-cookie'], undefined);
  });

  await t.test('/api/sheets is rate-limited per IP (300 per window)', async () => {
    mockUpstream('{"ok":true}');
    let last;
    for (let i = 0; i < 301; i++) last = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(last.status, 429);
    assert.equal(JSON.parse(last.text).error, 'יותר מדי בקשות. נסו שוב מאוחר יותר.');
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

  await t.test('no server secret appears in any response', async () => {
    mockUpstream('{"ok":true}');
    for (const p of ['/', '/app.js', '/healthz', '/api/sheets?action=managersOverview']) {
      const r = await request(server, p);
      assert.ok(!r.text.includes(KEY), `FULL_VIEW_KEY leaked on ${p}`);
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

  // ── module exposure ──────────────────────────────────────────────
  await t.test('server-only lib/auth.js and lib/redact.js are NOT served over HTTP', async () => {
    for (const f of ['/lib/auth.js', '/lib/redact.js']) {
      const r = await request(server, f);
      assert.ok(!r.text.includes('createHmac'), `${f} source was served`);
      assert.ok(!r.text.includes('redactPatientNames'), `${f} source was served`);
    }
  });

  await t.test('client-shared lib/bonus-eligibility.js IS served', async () => {
    const r = await request(server, '/lib/bonus-eligibility.js');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('tierForPatients') || r.text.includes('bonus'));
  });

  await t.test('/healthz is open', async () => {
    const r = await request(server, '/healthz');
    assert.equal(r.status, 200);
  });

  await t.test('the proxy still forwards ONLY allowlisted query keys', async () => {
    let seen = null;
    global.fetch = async (url) => {
      seen = String(url);
      return { status: 200, text: async () => '{"ok":true}', headers: { get: () => null } };
    };
    await request(server, '/api/sheets?action=managersHouse&house=ramot&month=2026-07&evil=1&redirect=x');
    const qs = new URL(seen).searchParams;
    assert.equal(qs.get('action'), 'managersHouse');
    assert.equal(qs.get('house'), 'ramot');
    assert.equal(qs.get('month'), '2026-07');
    assert.equal(qs.has('evil'), false);
    assert.equal(qs.has('redirect'), false);
  });

  await t.test('a key on an API URL is consumed by the handshake, never forwarded upstream', async () => {
    let called = false;
    global.fetch = async () => {
      called = true;
      return { status: 200, text: async () => '{"ok":true}', headers: { get: () => null } };
    };
    const r = await request(server, `/api/sheets?action=managersOverview&key=${KEY}`);
    assert.equal(r.status, 302, 'the key is stripped by a redirect before the proxy runs');
    assert.equal(r.headers.location, '/api/sheets?action=managersOverview');
    assert.equal(called, false, 'the full-view key must never reach the Apps Script');
  });
});
