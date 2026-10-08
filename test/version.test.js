'use strict';
/* GET /api/version — public deploy-verification endpoint.
 * Returns exactly {commit, builtAt}; commit comes from RAILWAY_GIT_COMMIT_SHA
 * and is only echoed when it is a hex SHA. No network, dummy env only. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('../server');

function get(server, path) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
    }).on('error', reject);
  });
}

test('/api/version', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const saved = process.env.RAILWAY_GIT_COMMIT_SHA;
  t.after(() => {
    server.close();
    if (saved === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
    else process.env.RAILWAY_GIT_COMMIT_SHA = saved;
  });

  await t.test('returns the Railway commit and builtAt only, no-store', async () => {
    const sha = 'ABCDEF0123456789abcdef0123456789abcdef01';
    process.env.RAILWAY_GIT_COMMIT_SHA = sha;
    const r = await get(server, '/api/version');
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-type'], /application\/json/);
    const body = JSON.parse(r.text);
    assert.deepEqual(Object.keys(body).sort(), ['builtAt', 'commit']);
    assert.equal(body.commit, sha.toLowerCase());
    assert.ok(!Number.isNaN(Date.parse(body.builtAt)));
  });

  await t.test('missing SHA → "unknown"', async () => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    const body = JSON.parse((await get(server, '/api/version')).text);
    assert.equal(body.commit, 'unknown');
  });

  await t.test('non-hex env value is never echoed', async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = '<script>alert(1)</script>';
    const r = await get(server, '/api/version');
    assert.equal(JSON.parse(r.text).commit, 'unknown');
    assert.ok(!r.text.includes('script'));
  });

  await t.test('does not leak the Apps Script URL and keeps security headers', async () => {
    const r = await get(server, '/api/version');
    assert.ok(!r.text.includes('apps-script.test'));
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  });
});
