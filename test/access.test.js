'use strict';
/* Personal-code access (13 Oct 2026) — replaces the open-app model of
 * 12 Sep 2026. Covers: nothing with data is served without a login; codes,
 * cookie flags, rate limit; a house manager sees ONLY their house (feeds
 * filtered server-side, other houses 403); admins see all; logout; a removed
 * code logs out; the work proxy sends the secret + the server-decided house /
 * role / actor and never trusts the browser for them; headers, robots.txt and
 * no secret ever in a response.
 *
 * All env values are dummies; global.fetch is MOCKED. */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, _rateLimiters } = require('../server');
const accessLib = require('../lib/access');

const OVERVIEW = JSON.stringify({
  ok: true, month: '2026-10', totals: { activePatients: 50 },
  houses: [
    { key: 'raanana', patientsNow: 11, manager: 'שחר' },
    { key: 'ramot', patientsNow: 13, manager: 'אורן' },
    { key: 'arfoni', patientsNow: 9, manager: 'חנן' }
  ]
});
const SNAPSHOTS = JSON.stringify({ ok: true, rows: [{ month: '2026-09', houseId: 'ramot' }, { month: '2026-09', houseId: 'arfoni' }, { month: '2026-09', houseId: 'pardes' }] });

let calls = [];
function mockUpstream(byAction) {
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), method: opts.method || 'GET', body });
    const action = body ? body.action : u.searchParams.get('action');
    const text = typeof byAction === 'function' ? byAction(action, u, body) : (byAction[action] || '{"ok":true}');
    return { status: 200, text: async () => text, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) } };
  };
}

test('personal-code access', async (t) => {
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  t.beforeEach(() => { calls = []; _rateLimiters.allowSheets.clear(); _rateLimiters.allowLogin.clear(); mockUpstream({ managersOverview: OVERVIEW, occupancySnapshots: SNAPSHOTS }); });
  const req = auth.request;

  await t.test('the app shell is served without a login (it holds no data)', async () => {
    const r = await req(server, '/');
    assert.equal(r.status, 200);
    assert.match(r.text, /<html/);
  });

  await t.test('no data without a login: /api/sheets, /api/me and /api/work → 401, nothing proxied', async () => {
    for (const [p, opts] of [['/api/sheets?action=managersOverview', {}], ['/api/me', {}], ['/api/work', { method: 'POST', body: { op: 'houseData' } }]]) {
      const r = await req(server, p, opts);
      assert.equal(r.status, 401, p);
      assert.equal(JSON.parse(r.text).error, 'login_required');
    }
    assert.equal(calls.length, 0, 'the upstream is never reached');
  });

  await t.test('login needs the username AND the code of the SAME person; a wrong pair says nothing about which part was wrong', async () => {
    const tries = [
      { username: 'אורן', code: '12345678' },          // right user, wrong code
      { username: 'סנדרה', code: auth.ORAN_CODE },     // someone else's code
      { username: 'nobody', code: auth.ORAN_CODE },     // unknown user
      { code: auth.ORAN_CODE },                         // no username
      { username: 'אורן' }                               // no code
    ];
    for (const body of tries) {
      const r = await req(server, '/api/login', { method: 'POST', body });
      assert.equal(r.status, 401, JSON.stringify(body));
      assert.equal(JSON.parse(r.text).error, 'שם משתמש או קוד שגויים');
      assert.equal(r.headers['set-cookie'], undefined);
    }
    const spaced = await req(server, '/api/login', { method: 'POST', body: { username: '  אורן ', code: auth.ORAN_CODE } });
    assert.equal(spaced.status, 200, 'surrounding spaces are ignored');
  });

  await t.test('a wrong code is refused; a right one sets an HttpOnly, SameSite=Strict session cookie', async () => {
    const bad = await req(server, '/api/login', { method: 'POST', body: { username: 'אורן', code: '12345678' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers['set-cookie'], undefined);
    const ok = await req(server, '/api/login', { method: 'POST', body: { username: 'אורן', code: auth.ORAN_CODE } });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.text).user, { name: 'אורן', role: 'manager', house: 'ramot' });
    const c = ok.headers['set-cookie'][0];
    assert.match(c, /^mgr_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000/);
    assert.doesNotMatch(c, new RegExp(auth.ORAN_CODE), 'the code itself is never in the cookie');
  });

  await t.test('login needs JSON and is rate-limited per IP (10 per window)', async () => {
    const form = await req(server, '/api/login', { method: 'POST', body: 'code=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    for (let i = 0; i < 10; i++) await req(server, '/api/login', { method: 'POST', body: { username: 'x', code: '00000000' } });
    const blocked = await req(server, '/api/login', { method: 'POST', body: { username: 'סנדרה', code: auth.ADMIN_CODE } });
    assert.equal(blocked.status, 429, 'even the right code is refused once the limit is hit');
  });

  await t.test('a forged or tampered cookie is refused', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const [name, value] = cookie.split('=');
    const [payload, sig] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ n: 'אורן', h: 'raanana', r: 'admin', f: 'x', e: Date.now() + 1e9 })).toString('base64url');
    for (const v of [`${forged}.${sig}`, `${payload}.${sig}x`, 'garbage']) {
      const r = await req(server, '/api/me', { headers: { Cookie: `${name}=${v}` } });
      assert.equal(r.status, 401, v.slice(0, 20));
    }
  });

  await t.test('a house manager sees ONLY their house: overview and snapshots filtered, other houses 403', async () => {
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const o = JSON.parse((await req(server, '/api/sheets?action=managersOverview', { headers: { Cookie: cookie } })).text);
    assert.deepEqual(o.houses.map((h) => h.key), ['ramot']);
    assert.deepEqual(o.totals, { activePatients: 13 }, 'no network-wide totals');
    const s = JSON.parse((await req(server, '/api/sheets?action=occupancySnapshots', { headers: { Cookie: cookie } })).text);
    assert.deepEqual(s.rows.map((r) => r.houseId), ['ramot']);
    assert.equal((await req(server, '/api/sheets?action=managersHouse&house=ramot', { headers: { Cookie: cookie } })).status, 200);
    const other = await req(server, '/api/sheets?action=managersHouse&house=raanana', { headers: { Cookie: cookie } });
    assert.equal(other.status, 403);
    // Efroni's backend id is 'arfoni': Hanan still gets his house.
    const hanan = await auth.login(server, auth.HANAN_CODE);
    const ho = JSON.parse((await req(server, '/api/sheets?action=managersOverview', { headers: { Cookie: hanan } })).text);
    assert.deepEqual(ho.houses.map((h) => h.key), ['arfoni']);
  });

  await t.test('an admin sees every house, byte-for-byte', async () => {
    const cookie = await auth.login(server, auth.ADMIN_CODE);
    const r = await req(server, '/api/sheets?action=managersOverview', { headers: { Cookie: cookie } });
    assert.equal(r.text, OVERVIEW);
    assert.equal((await req(server, '/api/sheets?action=managersHouse&house=raanana', { headers: { Cookie: cookie } })).status, 200);
  });

  await t.test('only the three read actions are proxied', async () => {
    const cookie = await auth.login(server, auth.ADMIN_CODE);
    for (const a of ['getData', 'managersWork', 'saveAll', '']) {
      const r = await req(server, `/api/sheets?action=${a}`, { headers: { Cookie: cookie } });
      assert.equal(r.status, 400, a);
    }
    assert.equal(calls.length, 0);
  });

  await t.test('work proxy: the server decides house / role / actor and adds the secret; the browser cannot override them', async () => {
    mockUpstream(() => '{"ok":true}');
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const r = await req(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: {
      op: 'logAdd', log: 'staffTalks', house: 'raanana', role: 'admin', actor: 'סנדרה', secret: 'x',
      entry: { employeeName: 'רינה', talkDate: '2026-10-12', summary: 'שיחה' } } });
    assert.equal(r.status, 200);
    const sent = calls[0];
    assert.equal(sent.method, 'POST');
    assert.equal(sent.url, 'https://apps-script.test/exec', 'POST to the script itself — nothing in the URL');
    assert.deepEqual([sent.body.action, sent.body.house, sent.body.role, sent.body.actor, sent.body.secret],
      ['managersWork', 'ramot', 'manager', 'אורן', process.env.MANAGERS_WORK_SECRET]);
    assert.deepEqual(JSON.parse(sent.body.entry), { employeeName: 'רינה', talkDate: '2026-10-12', summary: 'שיחה' });
  });

  await t.test('work proxy: an admin names the house; bad ops / logs / houses are refused; JSON only', async () => {
    mockUpstream(() => '{"ok":true}');
    const admin = await auth.login(server, auth.ADMIN_CODE);
    await req(server, '/api/work', { method: 'POST', headers: { Cookie: admin }, body: { op: 'houseData', house: 'pardes', month: '2026-10' } });
    assert.deepEqual([calls[0].body.house, calls[0].body.role, calls[0].body.month], ['pardes', 'admin', '2026-10']);
    const bads = [{ op: 'drop' }, { op: 'logAdd', log: 'salaries' }, { op: 'houseData', house: 'nowhere' }];
    for (const b of bads) assert.notEqual((await req(server, '/api/work', { method: 'POST', headers: { Cookie: admin }, body: b })).status, 200, JSON.stringify(b));
    const form = await req(server, '/api/work', { method: 'POST', headers: { Cookie: admin, 'Content-Type': 'text/plain' }, body: '{"op":"houseData","house":"ramot"}' });
    assert.equal(form.status, 415, 'a cross-site form post is refused');
    const patch = await req(server, '/api/work', { method: 'POST', headers: { Cookie: admin }, body: { op: 'logUpdate', log: 'events', house: 'ramot', id: 'abc', patch: { followUpDone: true, author: 'x' } } });
    assert.equal(patch.status, 200);
    assert.deepEqual(JSON.parse(calls.at(-1).body.patch), { followUpDone: true, deleted: false }, 'only the two known flags pass');
  });

  await t.test('house cost: a manager only ever gets their OWN house cost; the family-calls log is refused', async () => {
    mockUpstream(() => '{"ok":true,"cost":{"available":false,"reason":"not_configured"}}');
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const r = await req(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: { op: 'houseCost', house: 'raanana', month: '2026-10' } });
    assert.equal(r.status, 200);
    assert.deepEqual([calls[0].body.op, calls[0].body.house, calls[0].body.role, calls[0].body.month], ['houseCost', 'ramot', 'manager', '2026-10']);
    assert.equal(calls[0].body.log, undefined, 'no log field on a read op');
    const fc = await req(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: { op: 'logAdd', log: 'familyCalls', entry: {} } });
    assert.equal(fc.status, 400);
  });

  await t.test('the backend refusing the secret shows as 503, not as data', async () => {
    mockUpstream(() => '{"ok":false,"error":"unauthorized"}');
    const cookie = await auth.login(server, auth.ORAN_CODE);
    const r = await req(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: { op: 'houseData' } });
    assert.equal(r.status, 503);
  });

  await t.test('logout clears the cookie', async () => {
    const r = await req(server, '/api/logout', { method: 'POST', body: {} });
    assert.match(r.headers['set-cookie'][0], /^mgr_session=; .*Max-Age=0/);
  });

  await t.test('X-Robots-Tag and security headers on every response; robots.txt disallows all', async () => {
    const r = await req(server, '/');
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['content-security-policy'], /script-src 'self'/);
    assert.match((await req(server, '/robots.txt')).text, /Disallow: \//);
  });

  await t.test('no secret ever reaches a browser: not the script URL, not the work secret, not a code', async () => {
    mockUpstream(() => { throw new Error('fetch https://apps-script.test/exec failed'); });
    const cookie = await auth.login(server, auth.ADMIN_CODE);
    for (const r of [
      await req(server, '/api/sheets?action=managersOverview', { headers: { Cookie: cookie } }),
      await req(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body: { op: 'houseData', house: 'ramot' } }),
      await req(server, '/api/me', { headers: { Cookie: cookie } }),
      await req(server, '/')
    ]) {
      assert.doesNotMatch(r.text, /apps-script\.test|test-work-secret|90000001|10000002/);
    }
  });

  await t.test('no server-only module is reachable; bonus-eligibility.js is', async () => {
    assert.equal((await req(server, '/lib/access.js')).status, 200, 'SPA shell, not the module');
    assert.doesNotMatch((await req(server, '/lib/access.js')).text, /MANAGER_ACCESS/);
    assert.match((await req(server, '/lib/bonus-eligibility.js')).text, /RULE_SETS/);
    assert.doesNotMatch((await req(server, '/server.js')).text, /MANAGERS_WORK_SECRET/);
  });
});

test('lib/access: a removed or changed code logs that person out; expired sessions fail', () => {
  const a = accessLib.parseAccess(JSON.stringify([{ code: '11112222', name: 'אורן', house: 'ramot' }]));
  const k = accessLib.sessionKey('k'.repeat(32));
  const tok = accessLib.signSession(a.users[0], k, 1000);
  assert.equal(accessLib.readSession(tok, k, a.users, 2000).name, 'אורן');
  const changed = accessLib.parseAccess(JSON.stringify([{ code: '11113333', name: 'אורן', house: 'ramot' }]));
  assert.equal(accessLib.readSession(tok, k, changed.users, 2000), null, 'new code → old session dead');
  assert.equal(accessLib.readSession(tok, k, a.users, 1000 + 31 * 86400000), null, 'expired after 30 days');
});

test('lib/access: MANAGER_ACCESS validation (fail closed on anything odd)', () => {
  const bad = (v) => accessLib.parseAccess(typeof v === 'string' ? v : JSON.stringify(v)).ok;
  assert.equal(bad(''), false);
  assert.equal(bad([]), false);
  assert.equal(bad([{ code: '123', name: 'x', house: 'ramot' }]), false, 'code too short');
  assert.equal(bad([{ code: '12345678', name: 'x', house: 'nowhere' }]), false, 'unknown house');
  assert.equal(bad([{ code: '12345678', name: '', house: 'ramot' }]), false, 'no name');
  assert.equal(bad([{ code: '12345678', name: 'a', house: 'ramot' }, { code: '12345678', name: 'b', role: 'admin' }]), false, 'duplicate code');
  assert.equal(bad([{ code: '12345678', name: '<b>', role: 'admin' }]), false, 'markup in a name');
  assert.equal(bad([{ code: '12345678', name: 'ok', role: 'admin' }]), true);
});

test('lib/access: usernames — the name always works; an optional Latin `user` too; case and spaces ignored; unique', () => {
  const a = accessLib.parseAccess(JSON.stringify([
    { code: '11112222', name: 'אורן', house: 'ramot' },
    { code: '33334444', name: 'סנדרה', user: 'Sandra', role: 'admin' }
  ]));
  assert.equal(a.ok, true);
  const f = (u, c) => (accessLib.findUser(a.users, u, c) || {}).name || null;
  assert.equal(f('אורן', '11112222'), 'אורן');
  assert.equal(f('סנדרה', '33334444'), 'סנדרה');
  assert.equal(f(' SANDRA ', '33334444'), 'סנדרה');
  assert.equal(f('sandra', '11112222'), null, 'someone else\'s code');
  assert.equal(f('אורן', '33334444'), null);
  assert.equal(f('', '11112222'), null);
  assert.equal(f('אורן', ''), null);
  const bad = (v) => accessLib.parseAccess(JSON.stringify(v)).ok;
  assert.equal(bad([{ code: '12345678', name: 'a', user: 'x!', role: 'admin' }]), false, 'bad Latin user name');
  assert.equal(bad([{ code: '12345678', name: 'רון', role: 'admin' }, { code: '87654321', name: 'רון', house: 'ramot' }]), false, 'two people with one name');
  assert.equal(bad([{ code: '12345678', name: 'a', user: 'ron', role: 'admin' }, { code: '87654321', name: 'Ron', house: 'ramot' }]), false, 'user clashes with another name');
});

test('docs: the open-access doc is replaced by the access doc', () => {
  const root = path.join(__dirname, '..');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'access.md')));
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'open-access.md')));
});
