'use strict';
// Opt-in: the real Managers HTTP routes → the real Dashboard #415 Code.gs personal-write path
// (mwAuthorizedEmployee_, mwFeedbackDone_, mwLogAdd_, mwReadFeedback_, mwReadLog_), synthetic in-memory
// sheets only. The certified v2 publication reader itself is #415's own tested part: here a v2
// roster is injected at mwTeam_ (the function both houseData and the writers call).
// DASHBOARD_V2_CHECKOUT=/abs/path/to/E-Zone-Dashboard@f4aad02 TZ=UTC node --test test/worker-identity-v2-dashboard.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('Managers v2 client ↔ real Dashboard #415 Code.gs: per-person ids end to end', { skip: !process.env.DASHBOARD_V2_CHECKOUT }, async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.APPS_SCRIPT_URL = 'https://synthetic.test/exec';
  const auth = require('./helpers-auth');
  const { loadGs } = require(path.join(process.env.DASHBOARD_V2_CHECKOUT, 'test/helpers/gs-sandbox'));
  const g = loadGs({ props: { MANAGERS_WORK_SECRET: process.env.MANAGERS_WORK_SECRET, PROXY_SECRET_MODE: 'enforce' } });
  g.sandbox.Session = { getScriptTimeZone: () => 'UTC' };
  g.run(`todayISODate_ = function () { return '2026-11-21'; }; defaultMonth_ = function () { return '2026-11'; };
    readPatientsForBonus_ = function () { return []; }; readOutpatients_ = function () { return []; };`);
  assert.equal(typeof g.run('mwAuthorizedEmployee_'), 'function', 'this checkout is Dashboard #415');
  const setTeam = (staff, extra) => {
    g.sandbox.__team = Object.assign({ available: true, stale: false, updatedAt: '2026-11-21T08:00:00.000Z', today: [], shifts: [], therapistWeek: [], staff }, extra || {});
    g.run(`mwTeam_ = function (key) { return key === 'ramot' ? JSON.parse(JSON.stringify(__team)) : { available: false, reason: 'not_configured' }; };`);
  };
  const g2 = (o) => Object.assign({ kind: 'guide', role: 'מדריכה', phone: '', onLeave: false, workdays: [], startDate: '2026-01-01' }, o);
  const V2 = [g2({ name: 'דנה', workerId: 'w-A', assignmentId: 'as-A1' }), g2({ name: 'דנה', workerId: 'w-B', assignmentId: 'as-B1' }),
    g2({ name: 'משה', workerId: 'w-C', assignmentId: 'as-C1' })];
  setTeam(V2);
  const originalFetch = global.fetch;
  const sent = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); sent.push(body);
    const data = g.post(body);
    return { ok: true, status: 200, text: async () => JSON.stringify(data), headers: { get: () => 'application/json' } };
  };
  t.after(() => { global.fetch = originalFetch; });
  const { app, _readCache } = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const mine = await auth.login(server, auth.ORAN_CODE);   // ramot
  const work = async (body) => {
    const r = await auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: mine }, body });
    return { status: r.status, data: JSON.parse(r.text) };
  };
  const writes = () => sent.filter((b) => b.op !== 'houseData');

  // Feedback for the SECOND «דנה» only.
  const fb = await work({ op: 'feedbackDone', employee: 'דנה', doneAt: '2026-11-01', workerId: 'w-B', assignmentId: 'as-B1' });
  assert.equal(fb.data.ok, true, JSON.stringify(fb.data));
  assert.deepEqual([fb.data.feedback.workerId, fb.data.feedback.assignmentId], ['w-B', 'as-B1'], 'the Dashboard stored the pair');
  // Name-only on a v2 roster: the Dashboard refuses it (why this client change must be live first).
  const nameOnly = await work({ op: 'feedbackDone', employee: 'משה', doneAt: '2026-11-01' });
  assert.equal(nameOnly.data.error, 'identity_source_contract_required');
  // Swapped pair: refused by Managers before the Dashboard is called.
  const n = writes().length;
  assert.equal((await work({ op: 'feedbackDone', employee: 'דנה', doneAt: '2026-11-01', workerId: 'w-A', assignmentId: 'as-B1' })).status, 409);
  assert.equal(writes().length, n);

  // Read back: the feedback row carries B's pair; the client model gives it to B only.
  const hd = (await work({ op: 'houseData' })).data;
  assert.equal(hd.ok, true, JSON.stringify(hd));
  const F = require('../lib/feedback-due');
  const m = F.houseFeedback(hd.team.staff, hd.feedback.rows, '2026-11-21');
  assert.deepEqual(m.items.filter((x) => x.lastFeedback).map((x) => [x.workerId, x.lastFeedback]), [['w-B', '2026-11-01']]);

  // Staff talk for A, then a follow-up after A is renamed in the source.
  const first = await work({ op: 'logAdd', log: 'staffTalks', entry: { employeeName: 'דנה', talkDate: '2026-11-02', summary: 'synthetic A', workerId: 'w-A', assignmentId: 'as-A1' } });
  assert.equal(first.data.ok, true, JSON.stringify(first.data));
  setTeam(V2.map((x) => (x.workerId === 'w-A' ? Object.assign({}, x, { name: 'דנה לוי' }) : x)));
  _readCache.clear();
  const talks = (await work({ op: 'houseData' })).data.logs.staffTalks;
  const root = talks.find((r) => r.id === first.data.id);
  assert.deepEqual([root.workerId, root.assignmentId], ['w-A', 'as-A1'], 'the talk row carries the pair');
  const who = F.talkIdentity((await work({ op: 'houseData' })).data.team.staff, root.employeeName, root, null);
  assert.deepEqual(who, { ok: true, name: 'דנה לוי', workerId: 'w-A', assignmentId: 'as-A1' });
  const follow = await work({ op: 'logAdd', log: 'staffTalks', entry: { employeeName: who.name, talkDate: '2026-11-03', summary: 'follow-up',
    talkKind: 'followup', parentId: root.id, workerId: who.workerId, assignmentId: who.assignmentId } });
  assert.equal(follow.data.ok, true, JSON.stringify(follow.data));
  // B's pair cannot continue A's thread (Managers passes it — B is real — and the Dashboard refuses the parent).
  const hijack = await work({ op: 'logAdd', log: 'staffTalks', entry: { employeeName: 'דנה', talkDate: '2026-11-03', summary: 'x',
    talkKind: 'followup', parentId: root.id, workerId: 'w-B', assignmentId: 'as-B1' } });
  assert.notEqual(hijack.data.ok, true);

  // Back to v1 (flag off / rollback): ids are refused by Managers, name-only works again.
  setTeam([g2({ name: 'נועה' })]);
  _readCache.clear();
  assert.equal((await work({ op: 'feedbackDone', employee: 'נועה', doneAt: '2026-11-01', workerId: 'w-A', assignmentId: 'as-A1' })).data.error, 'identity_contract_required');
  assert.equal((await work({ op: 'feedbackDone', employee: 'נועה', doneAt: '2026-11-01' })).data.ok, true);
  assert.ok(writes().every((b) => b.house === 'ramot' && b.actorId === 'person-oran'), 'house and actor always from the session');
});
