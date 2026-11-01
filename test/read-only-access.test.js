'use strict';
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://apps-script.test/exec';
const auth = require('./helpers-auth');
const users = JSON.parse(process.env.MANAGER_ACCESS);
users.push({ id: 'executive-reader', name: 'Test reader', code: '90000009', role: 'admin', readOnly: true });
users.push({ id: 'house-reader', name: 'House reader', code: '90000008', house: 'pardes', readOnly: true });
process.env.MANAGER_ACCESS = JSON.stringify(users);
const test = require('node:test');
const assert = require('node:assert/strict');
const { app, _rateLimiters } = require('../server');
const A = require('../lib/access');
const W = require('../public/work');

test('read-only accounts: all-house reads, no business writes or client override', async t => {
  const real = global.fetch, calls = [];
  global.fetch = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return { status: 200, text: async () => '{"ok":true}', headers: { get: () => 'application/json' } }; };
  t.after(() => { global.fetch = real; });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => server.close());
  Object.values(_rateLimiters).forEach(x => x.clear && x.clear());
  const cookie = await auth.login(server, '90000009', 'Test reader');
  assert.equal(JSON.parse((await auth.request(server, '/api/me', { headers: { Cookie: cookie } })).text).user.readOnly, true);
  const send = body => auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body });
  for (const house of A.HOUSE_KEYS) for (const op of ['houseData', 'houseCost', 'meetingSummaries']) {
    assert.equal((await send({ op, house })).status, 200, house + ' ' + op);
  }
  const before = calls.length;
  for (const op of ['logAdd', 'logUpdate', 'dischargeSet', 'feedbackDone']) {
    const r = await send({ op, house: 'pardes', role: 'admin', readOnly: false });
    assert.deepEqual([r.status, JSON.parse(r.text).error], [403, 'read_only']);
  }
  assert.equal(calls.length, before, 'no denied write forwarded');
  assert.equal((await send({ op: 'futureMutation', house: 'pardes' })).status, 400);
  const own = await auth.login(server, '90000008', 'House reader');
  assert.equal((await auth.request(server, '/api/sheets?action=managersHouse&house=ramot', { headers: { Cookie: own } })).status, 403);
  const legacy = await auth.login(server, auth.ADMIN_CODE);
  assert.equal((await auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: legacy }, body: { op: 'logAdd', house: 'pardes', log: 'events', entry: {} } })).status, 200);
  const beforeIdentity = calls.length;
  for (const key of ['employeeId', 'workerId']) {
    const response = await auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: legacy }, body: { op: 'feedbackDone', house: 'pardes', employee: 'Synthetic', doneAt: '2026-10-01', [key]: 'w1' } });
    assert.deepEqual([response.status, JSON.parse(response.text).error], [409, 'identity_contract_required']);
  }
  assert.equal(calls.length, beforeIdentity, 'an unsupported identity is never silently discarded upstream');
});

test('readOnly is strict configuration and live session capabilities do not trust the cookie', () => {
  const u = { id: 'test-person', name: 'Test', code: '90000007', role: 'admin' };
  assert.equal(A.parseAccess(JSON.stringify([{ ...u, readOnly: 'false' }])).ok, false);
  const parsed = A.parseAccess(JSON.stringify([u])).users;
  const key = A.sessionKey('synthetic-key'), cookie = A.signSession(parsed[0], key);
  const changed = A.parseAccess(JSON.stringify([{ ...u, readOnly: true }])).users;
  assert.equal(A.readSession(cookie, key, changed).readOnly, true);
  assert.equal(A.readSession(cookie, key, []), null);
});

test('read-only views retain information while removing mutation forms and controls', () => {
  const d = { readOnly: true, today: '2026-11-01', patients: [{ name: 'Synthetic', entryDate: '2026-01-01', expectedDischarge: { date: '2026-11-20' } }],
    expectedDischargeSupported: true, team: { available: true, staff: [{ name: 'Synthetic' }] }, feedback: { supported: true, rows: [] }, logs: { events: [] } };
  assert.doesNotMatch(W.patientsHtml(d), /data-dis-edit|data-dis-form/);
  assert.match(W.patientsHtml(d), /שחרור משוער/);
  assert.doesNotMatch(W.feedbackListHtml(d), /data-fb-form/);
  assert.doesNotMatch(W.logPanelHtml('events', d, { readOnly: true }), /data-wk-form/);
});

test('ambiguous feedback names remain visible but cannot submit a name-only form', () => {
  const d = { today: '2026-11-01', team: { available: true, staff: [{ id: 'w1', name: '<same>' }, { id: 'w2', name: '<same>' }] }, feedback: { supported: true, rows: [] } };
  const html = W.feedbackListHtml(d);
  assert.doesNotMatch(html, /data-fb-form|<same>/);
  assert.equal((html.match(/&lt;same&gt;/g) || []).length, 2);
  assert.match(html, /נדרש זיהוי/);
});
