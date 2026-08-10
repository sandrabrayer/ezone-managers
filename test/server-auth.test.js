'use strict';
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://example.invalid/exec';
process.env.APP_PIN = '123456';
process.env.SESSION_SECRET = 'k'.repeat(32);

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app, _loginAttempts } = require('../server');
const { signToken } = require('../lib/auth');

function request(server, method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path,
        headers: Object.assign(
          data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
          headers || {}
        ) },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, text: buf }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('server auth', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  await t.test('/healthz is open', async () => {
    const r = await request(server, 'GET', '/healthz');
    assert.equal(r.status, 200);
  });

  await t.test('/api/sheets without token → 401', async () => {
    const r = await request(server, 'GET', '/api/sheets?action=managersOverview');
    assert.equal(r.status, 401);
  });

  await t.test('/api/sheets with garbage token → 401', async () => {
    const r = await request(server, 'GET', '/api/sheets?action=managersOverview', {
      headers: { Authorization: 'Bearer nope.deadbeef' }
    });
    assert.equal(r.status, 401);
  });

  await t.test('login with wrong PIN → 401', async () => {
    _loginAttempts.clear();
    const r = await request(server, 'POST', '/api/login', { body: { pin: '000000' } });
    assert.equal(r.status, 401);
  });

  await t.test('login with correct PIN → token that passes the gate (upstream 502 is fine)', async () => {
    _loginAttempts.clear();
    const r = await request(server, 'POST', '/api/login', { body: { pin: '123456' } });
    assert.equal(r.status, 200);
    const { token } = JSON.parse(r.text);
    assert.ok(token && token.includes('.'));
    // Gate passes (not 401). Upstream fetch is MOCKED to fail so no real
    // network I/O ever happens; the proxy maps the failure to 502.
    const realFetch = global.fetch;
    global.fetch = async () => { throw new Error('mocked upstream failure'); };
    try {
      const g = await request(server, 'GET', '/api/sheets?action=managersOverview', {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.notEqual(g.status, 401);
      assert.equal(g.status, 502);
    } finally {
      global.fetch = realFetch;
    }
  });

  await t.test('login is rate-limited after 8 attempts per window', async () => {
    _loginAttempts.clear();
    let last;
    for (let i = 0; i < 9; i++) {
      last = await request(server, 'POST', '/api/login', { body: { pin: '000000' } });
    }
    assert.equal(last.status, 429);
    // even the CORRECT pin is refused while limited
    const r = await request(server, 'POST', '/api/login', { body: { pin: '123456' } });
    assert.equal(r.status, 429);
    _loginAttempts.clear();
  });

  await t.test('server-only lib/auth.js is NOT served over HTTP', async () => {
    const r = await request(server, 'GET', '/lib/auth.js');
    // SPA fallback returns index.html, never the module source
    assert.ok(!r.text.includes('createHmac'));
  });

  await t.test('client-shared lib/bonus-eligibility.js IS served', async () => {
    const r = await request(server, 'GET', '/lib/bonus-eligibility.js');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('tierForPatients') || r.text.includes('bonus'));
  });

  await t.test('a locally forged token signed with the wrong key → 401', async () => {
    const forged = signToken('w'.repeat(32), 1);
    const r = await request(server, 'GET', '/api/sheets?action=managersOverview', {
      headers: { Authorization: `Bearer ${forged}` }
    });
    assert.equal(r.status, 401);
  });
});
