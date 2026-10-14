'use strict';
/* Test helper (not a test): dummy codes + login for the server tests. */
const ADMIN_CODE = '90000001';
const ORAN_CODE = '10000002';   // ramot manager
const HANAN_CODE = '10000003';  // efroni manager
process.env.MANAGERS_WORK_SECRET = 'test-work-secret-0123456789abcdef';
process.env.MANAGER_ACCESS = JSON.stringify([
  { code: ADMIN_CODE, name: 'סנדרה', role: 'admin' },
  { code: ORAN_CODE, name: 'אורן', house: 'ramot' },
  { code: HANAN_CODE, name: 'חנן', house: 'efroni' }
]);
const http = require('node:http');

function request(server, path, { headers = {}, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const h = { ...headers };
    let data;
    if (body !== undefined) { data = typeof body === 'string' ? body : JSON.stringify(body); if (!h['Content-Type']) h['Content-Type'] = 'application/json'; }
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: h }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const NAME_BY_CODE = { [ADMIN_CODE]: 'סנדרה', [ORAN_CODE]: 'אורן', [HANAN_CODE]: 'חנן' };

/* Log in with a code (+ that person's username); returns the Cookie header value. */
async function login(server, code, username = NAME_BY_CODE[code]) {
  const r = await request(server, '/api/login', { method: 'POST', body: { username, code } });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${r.text}`);
  return String(r.headers['set-cookie'][0]).split(';')[0];
}

module.exports = { ADMIN_CODE, ORAN_CODE, HANAN_CODE, request, login };
