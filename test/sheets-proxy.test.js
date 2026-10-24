'use strict';
/* /api/sheets proxy mechanics — global.fetch is MOCKED so no test ever
 * performs real network I/O (the Apps Script backend must never be hit from
 * CI). All env values below are dummies.
 *
 * The open-app behaviours (no credential needed, security headers, the rate
 * limit) live in test/access.test.js; this file exercises the proxy itself:
 * the query allowlist, the failure classes, the last-good cache fallback
 * and the safe log line (19 Oct 2026, docs/sheets-resilience.md). */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, _rateLimiters, _readCache } = require('../server');

/* Every call here is made as an ADMIN (sees all houses — the raw feed). */
let COOKIE = '';
const request = (server, path, headers) => auth.request(server, path, { headers: { ...(headers || {}), Cookie: COOKIE } });

test('sheets proxy (mocked upstream)', async (t) => {
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  t.beforeEach(() => { _rateLimiters.allowSheets.clear(); _readCache.clear(); });
  COOKIE = await auth.login(server, auth.ADMIN_CODE);

  let lastFetchUrl = null;
  let lastBody, lastMethod;

  function mockUpstream(body, { status = 200, contentType = 'application/json' } = {}) {
    global.fetch = async (url, opts) => {
      lastBody = JSON.parse(opts.body); lastMethod = opts.method;
      lastFetchUrl = String(url);
      return {
        status,
        text: async () => body,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) }
      };
    };
  }

  await t.test('proxies upstream JSON through with no-store caching', async () => {
    mockUpstream('{"houses":[]}');
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.status, 200);
    assert.equal(r.text, '{"houses":[]}');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(lastFetchUrl, 'https://apps-script.test/exec');
  });

  await t.test('forwards ONLY allowlisted query keys (action, house, month)', async () => {
    mockUpstream('{}');
    await request(server,
      '/api/sheets?action=managersOverview&house=ramot&month=2026-07&evil=1&redirect=x');
    assert.equal(lastMethod, 'POST');
    assert.equal(new URL(lastFetchUrl).search, '');
    assert.equal(lastBody.actorId, 'person-sandra');
    assert.equal(lastBody.secret, process.env.MANAGERS_WORK_SECRET);
    const qs = new URLSearchParams(lastBody);
    assert.equal(qs.get('action'), 'managersOverview');
    assert.equal(qs.get('house'), 'ramot');
    assert.equal(qs.get('month'), '2026-07');
    assert.equal(qs.has('evil'), false);
    assert.equal(qs.has('redirect'), false);
  });

  await t.test('forwards the occupancySnapshots action (monthly occupancy view)', async () => {
    mockUpstream('{"ok":true,"rows":[]}');
    const r = await request(server, '/api/sheets?action=occupancySnapshots');
    assert.equal(r.status, 200);
    assert.equal(r.text, '{"ok":true,"rows":[]}');
    assert.equal(lastFetchUrl, 'https://apps-script.test/exec',
      'the permanent occupancy view uses the SAME proxy path as managersOverview');
  });

  /* ---- failure classes (19 Oct 2026, docs/sheets-resilience.md) ---- */
  const sheetsCache = require('../server')._sheetsCache;
  const logs = [];
  const realErr = console.error;
  console.error = (...a) => { logs.push(a.join(' ')); };
  t.after(() => { console.error = realErr; });
  t.beforeEach(() => { sheetsCache.clear(); logs.length = 0; });
  const lastLog = () => logs.filter((l) => l.startsWith('[sheets]')).pop() || '';
  const timeoutErr = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

  const CLASSES = [
    ['fetch timeout → 504 upstream_timeout', () => { global.fetch = async () => { throw timeoutErr(); }; }, 504, 'upstream_timeout'],
    ['abort → 504 upstream_timeout', () => { global.fetch = async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }; }, 504, 'upstream_timeout'],
    ['network failure → 502 upstream_unreachable', () => { global.fetch = async () => { throw new TypeError('fetch failed https://apps-script.test/exec?secret=x'); }; }, 502, 'upstream_unreachable'],
    ['HTML authorization page → 502 upstream_auth', () => mockUpstream('<html><body>Authorization is required to perform that action.</body></html>', { contentType: 'text/html' }), 502, 'upstream_auth'],
    ['other non-JSON reply → 502 upstream_bad_response', () => mockUpstream('<html>Service error</html>', { contentType: 'text/html' }), 502, 'upstream_bad_response'],
    ['JSON ok:false (Apps Script exception) → 502 upstream_app_error', () => mockUpstream('{"ok":false,"error":"exception","message":"Range out of bounds at Code.gs:1"}'), 502, 'upstream_app_error'],
    ['upstream non-2xx → 502 upstream_app_error', () => mockUpstream('{"error":"nope"}', { status: 500 }), 502, 'upstream_app_error'],
    ['unauthorized (secret mismatch) → 503 upstream_unavailable', () => mockUpstream('{"ok":false,"error":"unauthorized"}'), 503, 'upstream_unavailable']
  ];
  for (const [name, arm, status, code] of CLASSES) {
    await t.test(`${name} (no cached copy) + one safe log line`, async () => {
      arm();
      const r = await request(server, '/api/sheets?action=managersOverview&month=2026-09');
      assert.equal(r.status, status);
      assert.deepEqual(JSON.parse(r.text), { error: code }, 'only the safe code — no message, body or detail');
      assert.notEqual(JSON.parse(r.text).error, 'upstream_error', 'never a bare upstream_error');
      const line = lastLog();
      assert.match(line, new RegExp(`^\\[sheets\\] action=managersOverview class=${code} status=${status} ms=\\d+ served=error$`));
      for (const leak of ['apps-script.test', process.env.MANAGERS_WORK_SECRET, 'secret', 'סנדרה', 'Code.gs', 'html', 'Authorization']) {
        assert.ok(!line.includes(leak), `log line must not contain ${leak}`);
      }
    });
  }

  await t.test('keeps the 15 s timeout', async () => {
    let signal;
    global.fetch = async (_u, opts) => { signal = opts.signal; return { status: 200, text: async () => '{}', headers: { get: () => null } }; };
    await request(server, '/api/sheets?action=managersOverview');
    assert.ok(signal && typeof signal.aborted === 'boolean', 'an abort signal is passed');
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /SHEETS_TIMEOUT_MS = 15000/);
  });

  await t.test('a live read is marked X-Data-Source: live', async () => {
    mockUpstream('{"houses":[{"key":"ramot"}]}');
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.headers['x-data-source'], 'live');
    assert.equal(r.headers['x-data-cached-at'], undefined);
  });

  for (const [name, arm] of CLASSES.map(([n, a]) => [n, a])) {
    await t.test(`cache fallback: ${name} → the last good copy, marked X-Data-Source: cache`, async () => {
      mockUpstream('{"houses":[{"key":"ramot","patientsNow":12}]}');
      const good = await request(server, '/api/sheets?action=managersHouse&house=ramot');
      assert.equal(good.status, 200);
      _readCache.clear();   // the fast copy would answer; this test is about the failure fallback
      arm();
      const r = await request(server, '/api/sheets?action=managersHouse&house=ramot');
      assert.equal(r.status, 200);
      assert.equal(r.text, '{"houses":[{"key":"ramot","patientsNow":12}]}');
      assert.equal(r.headers['x-data-source'], 'cache');
      assert.ok(!Number.isNaN(Date.parse(r.headers['x-data-cached-at'])), 'cached-at is an ISO time');
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.match(lastLog(), /^\[sheets\] action=managersHouse class=upstream_\w+ status=\d{3} ms=\d+ served=cache$/);
    });
  }

  await t.test('cache is per request: another house / month has no copy', async () => {
    mockUpstream('{"houses":[]}');
    await request(server, '/api/sheets?action=managersHouse&house=ramot');
    _readCache.clear();
    global.fetch = async () => { throw timeoutErr(); };
    assert.equal((await request(server, '/api/sheets?action=managersHouse&house=efroni')).status, 504);
    assert.equal((await request(server, '/api/sheets?action=managersHouse&house=ramot&month=2026-08')).status, 504);
  });

  await t.test('a failed reply never overwrites the good copy', async () => {
    mockUpstream('{"houses":[{"key":"ramot"}]}');
    await request(server, '/api/sheets?action=managersOverview');
    _readCache.clear();
    mockUpstream('{"ok":false,"error":"exception"}');
    await request(server, '/api/sheets?action=managersOverview');
    global.fetch = async () => { throw timeoutErr(); };
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.text, '{"houses":[{"key":"ramot"}]}');
  });

  await t.test('a copy older than 72 h is not served', async () => {
    mockUpstream('{"houses":[]}');
    await request(server, '/api/sheets?action=managersOverview');
    for (const v of sheetsCache.values()) v.at -= 73 * 3600 * 1000;
    _readCache.clear();
    global.fetch = async () => { throw timeoutErr(); };
    assert.equal((await request(server, '/api/sheets?action=managersOverview')).status, 504);
  });

  await t.test('the cache is bounded (100 entries)', async () => {
    mockUpstream('{"houses":[]}');
    for (let i = 0; i < 105; i++) await request(server, `/api/sheets?action=managersOverview&month=2026-${String((i % 12) + 1).padStart(2, '0')}&house=h${i}`);
    assert.ok(sheetsCache.size <= 100);
  });

  await t.test('manager: a cached copy is still scoped to their own house and never another person\'s', async () => {
    const oran = await auth.login(server, auth.ORAN_CODE);
    const hanan = await auth.login(server, auth.HANAN_CODE);
    mockUpstream(JSON.stringify({ houses: [{ key: 'ramot', patientsNow: 12 }, { key: 'arfoni', patientsNow: 9 }], totals: { activePatients: 21 } }));
    await auth.request(server, '/api/sheets?action=managersOverview', { headers: { Cookie: oran } });
    _readCache.clear();
    global.fetch = async () => { throw timeoutErr(); };
    const r = await auth.request(server, '/api/sheets?action=managersOverview', { headers: { Cookie: oran } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-data-source'], 'cache');
    const d = JSON.parse(r.text);
    assert.deepEqual(d.houses.map((h) => h.key), ['ramot']);
    assert.deepEqual(d.totals, { activePatients: 12 });
    const other = await auth.request(server, '/api/sheets?action=managersOverview', { headers: { Cookie: hanan } });
    assert.equal(other.status, 504, 'Hanan never gets Oran\'s cached reply');
  });

  await t.test('unknown /api route → 404 JSON, not the SPA shell', async () => {
    const r = await request(server, '/api/nope');
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.text).error, 'not found');
  });
});

test('SW cache ≥ v32 since the read-resilience UI (monotonic from live v31)', () => {
  const sw = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.ok(Number(/const CACHE = 'ezone-managers-v(\d+)';/.exec(sw)[1]) >= 32);
});
