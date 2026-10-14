'use strict';
/* /api/sheets proxy mechanics — global.fetch is MOCKED so no test ever
 * performs real network I/O (the Apps Script backend must never be hit from
 * CI). All env values below are dummies.
 *
 * The open-app behaviours (no credential needed, security headers, the rate
 * limit) live in test/access.test.js; this file exercises the proxy itself:
 * the query allowlist, status pass-through and the error path. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');

const test = require('node:test');
const assert = require('node:assert/strict');
const { app, _rateLimiters } = require('../server');

/* Every call here is made as an ADMIN (sees all houses — the raw feed). */
let COOKIE = '';
const request = (server, path, headers) => auth.request(server, path, { headers: { ...(headers || {}), Cookie: COOKIE } });

test('sheets proxy (mocked upstream)', async (t) => {
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  t.beforeEach(() => { _rateLimiters.allowSheets.clear(); });
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

  await t.test('passes upstream non-200 status through', async () => {
    mockUpstream('{"error":"nope"}', { status: 500 });
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.status, 500);
  });

  await t.test('upstream network failure → 502 upstream_error with no detail', async () => {
    global.fetch = async () => { throw new Error('boom'); };
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.status, 502);
    const body = JSON.parse(r.text);
    assert.equal(body.error, 'upstream_error');
    assert.equal(body.message, undefined, 'err.message must not be echoed to the client');
  });

  await t.test('unknown /api route → 404 JSON, not the SPA shell', async () => {
    const r = await request(server, '/api/nope');
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.text).error, 'not found');
  });
});
