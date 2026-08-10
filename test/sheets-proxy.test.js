'use strict';
/* /api/sheets proxy tests — global.fetch is MOCKED so no test ever performs
 * real network I/O (the Apps Script backend must never be hit from CI).
 * All env values below are dummies. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
process.env.APP_PIN = '123456';
process.env.SESSION_SECRET = 'k'.repeat(32);

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('../server');
const { signToken } = require('../lib/auth');

const TOKEN = signToken(process.env.SESSION_SECRET, 1);

function request(server, path, headers) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
    }).on('error', reject);
  });
}

test('sheets proxy (mocked upstream)', async (t) => {
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  const auth = { Authorization: `Bearer ${TOKEN}` };
  let lastFetchUrl = null;

  function mockUpstream(body, { status = 200, contentType = 'application/json' } = {}) {
    global.fetch = async (url) => {
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
    const r = await request(server, '/api/sheets?action=managersOverview', auth);
    assert.equal(r.status, 200);
    assert.equal(r.text, '{"houses":[]}');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(lastFetchUrl, 'https://apps-script.test/exec?action=managersOverview');
  });

  await t.test('forwards ONLY allowlisted query keys (action, house, month)', async () => {
    mockUpstream('{}');
    await request(server,
      '/api/sheets?action=managersOverview&house=ramot&month=2026-07&evil=1&redirect=x', auth);
    const qs = new URL(lastFetchUrl).searchParams;
    assert.equal(qs.get('action'), 'managersOverview');
    assert.equal(qs.get('house'), 'ramot');
    assert.equal(qs.get('month'), '2026-07');
    assert.equal(qs.has('evil'), false);
    assert.equal(qs.has('redirect'), false);
  });

  await t.test('passes upstream non-200 status through', async () => {
    mockUpstream('{"error":"nope"}', { status: 500 });
    const r = await request(server, '/api/sheets?action=managersOverview', auth);
    assert.equal(r.status, 500);
  });

  await t.test('upstream network failure → 502 upstream_error', async () => {
    global.fetch = async () => { throw new Error('boom'); };
    const r = await request(server, '/api/sheets?action=managersOverview', auth);
    assert.equal(r.status, 502);
    assert.equal(JSON.parse(r.text).error, 'upstream_error');
  });

  await t.test('mocked upstream is never reached without a valid token', async () => {
    let called = false;
    global.fetch = async () => { called = true; return { status: 200, text: async () => '{}', headers: { get: () => null } }; };
    const r = await request(server, '/api/sheets?action=managersOverview');
    assert.equal(r.status, 401);
    assert.equal(called, false);
  });

  await t.test('unknown /api route → 404 JSON, not the SPA shell', async () => {
    const r = await request(server, '/api/nope', auth);
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.text).error, 'not found');
  });
});
