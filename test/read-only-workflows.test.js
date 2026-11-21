'use strict';
// MGR-SEC-02: synthetic-only read-only regression of Managers' real HTTP proxy.
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://synthetic.test/exec';
const auth = require('./helpers-auth');
const cfg = JSON.parse(process.env.MANAGER_ACCESS);
cfg.push({ id: 'readonly-executive', code: '90909090', name: 'Reader Executive', role: 'admin', readOnly: true });
cfg.push({ id: 'readonly-ramot', code: '80808080', name: 'Reader Ramot', house: 'ramot', readOnly: true });
process.env.MANAGER_ACCESS = JSON.stringify(cfg);

const test = require('node:test');
const assert = require('node:assert/strict');
const { app, _rateLimiters } = require('../server');
const A = require('../lib/access');
const W = require('../public/work');
const C = require('../public/crm');
const M = require('../public/meetings');

test('read-only: all existing writes blocked at server; read scope preserved; ordinary manager still writes', async t => {
  const originalFetch = global.fetch;
  const calls = [];
  const saved = new Map();   // synthetic Dashboard store, not production
  global.fetch = async (_url, opts) => {
    const q = JSON.parse(opts.body);
    calls.push(q);
    let data = { ok: true };
    if (q.op === 'meetings') data = { ok: true, meetings: [{ id: 'L1', name: 'Synthetic', visitDate: '2026-11-22', meetingWith: 'אורן', report: saved.get(q.house + ':L1') || null }], today: '2026-11-21' };
    if (q.op === 'meetingReport') {
      const row = { leadId: q.leadId, reporter: q.actor, outcome: q.outcome, note: q.note || '' };
      saved.set(q.house + ':' + q.leadId, row);
      data = { ok: true, saved: row };
    }
    if (q.action === 'managersOverview') data = { ok: true, houses: [{ key: 'ramot', patientsNow: 2 }, { key: 'arfoni', patientsNow: 4 }], totals: { activePatients: 6 } };
    return { status: 200, ok: true, text: async () => JSON.stringify(data), headers: { get: () => 'application/json' } };
  };
  t.after(() => { global.fetch = originalFetch; });
  Object.values(_rateLimiters).forEach(x => x.clear && x.clear());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const executive = await auth.login(server, '90909090', 'Reader Executive');
  const reader = await auth.login(server, '80808080', 'Reader Ramot');
  const manager = await auth.login(server, auth.ORAN_CODE);
  const post = (cookie, body) => auth.request(server, '/api/work', { method: 'POST', headers: { Cookie: cookie }, body });
  for (const cookie of [executive, reader]) {
    const me = JSON.parse((await auth.request(server, '/api/me', { headers: { Cookie: cookie } })).text);
    assert.equal(me.user.readOnly, true);
    const house = cookie === executive ? 'efroni' : 'ramot';
    for (const op of ['houseData', 'houseCost', 'houseStaffCost', 'meetingSummaries', 'meetings', 'shiftUpdates']) {
      assert.equal((await post(cookie, { op, house })).status, 200, op);
    }
    const before = calls.length;
    for (const op of ['logAdd', 'logUpdate', 'dischargeSet', 'feedbackDone', 'meetingReport']) {
      const response = await post(cookie, { op, house, role: 'admin', readOnly: false, actor: 'forged', entry: { arbitrary: true }, leadId: 'L1', outcome: 'advancing' });
      assert.deepEqual([response.status, JSON.parse(response.text).error], [403, 'read_only'], op);
    }
    assert.equal(calls.length, before, 'denied requests must never reach source of truth');
  }
  assert.equal((await auth.request(server, '/api/sheets?action=managersHouse&house=efroni', { headers: { Cookie: reader } })).status, 403);
  const overview = JSON.parse((await auth.request(server, '/api/sheets?action=managersOverview&house=efroni', { headers: { Cookie: reader } })).text);
  assert.deepEqual(overview.houses.map(h => h.key), ['ramot']);
  assert.deepEqual(overview.totals, { activePatients: 2 });
  assert.equal((await post(executive, { op: 'meetings', house: 'pardes' })).status, 200, 'executive reader can view all allowed houses');
  const written = await post(manager, { op: 'meetingReport', house: 'efroni', leadId: 'L1', outcome: 'advancing', note: 'synthetic', submissionId: 'sub-0123456789abcdef' });
  assert.equal(JSON.parse(written.text).saved.reporter, 'אורן');
  assert.deepEqual([calls.at(-1).house, calls.at(-1).actor], ['ramot', 'אורן']);
  const readback = await post(reader, { op: 'meetings' });
  assert.equal(JSON.parse(readback.text).meetings[0].report.note, 'synthetic', 'second user reads the same saved synthetic report from original source');
  assert.equal(saved.size, 1, 'readers cannot create a duplicate report');
});

test('configuration is strict and a signed session resolves current readOnly capability on every request', () => {
  const row = { id: 'sample-person', name: 'Sample', role: 'admin', code: '11111111' };
  assert.equal(A.parseAccess(JSON.stringify([{ ...row, readOnly: 'false' }])).ok, false);
  const before = A.parseAccess(JSON.stringify([row])).users;
  const key = A.sessionKey('synthetic-secret');
  const cookie = A.signSession(before[0], key);
  const after = A.parseAccess(JSON.stringify([{ ...row, readOnly: true }])).users;
  assert.equal(A.readSession(cookie, key, after).readOnly, true);
  assert.equal(A.readSession(cookie, key, []).readOnly, null);
});

test('read-only HTML hides editing in key manager flows, not the history itself', () => {
  const d = { readOnly: true, today: '2026-11-21',
    patients: [{ name: 'Synthetic', entryDate: '2026-10-01', expectedDischarge: { date: '2026-12-01' } }],
    expectedDischargeSupported: true, expectedDischargeModes: ['set', 'clear', 'none'],
    team: { available: true, staff: [{ name: 'Synthetic' }] },
    feedback: { supported: true, rows: [] },
    logs: { staffTalks: [], events: [], familyCalls: [] } };
  assert.doesNotMatch(W.patientsHtml(d), /data-dis-form|data-dis-edit/);
  assert.match(W.patientsHtml(d), /שחרור משוער/);
  assert.doesNotMatch(W.feedbackListHtml(d), /data-fb-form/);
  assert.doesNotMatch(W.logPanelHtml('events', d, { readOnly: true }), /data-wk-form/);
  assert.doesNotMatch(W.familyPanelHtml(d, {}), /data-wk-form/);
  assert.doesNotMatch(C.patientCardHtml(d, 0), /data-pt-discharge|data-pt-family/);
  assert.doesNotMatch(C.familyContactsHtml(d), /data-fam-add/);
  M.setReadOnly(true);
  try {
    const st = { res: { ok: true, today: '2026-11-21', meetings: [{ id: 'L1', name: 'Synthetic', visitDate: '2026-11-21', report: null }] }, today: '2026-11-21' };
    assert.doesNotMatch(M.tabHtml(st), /data-mt-report|data-mt-form/);
    assert.match(M.tabHtml(st), /צפייה בלבד/);
    assert.match(M.homeCardHtml(st), /Synthetic/);
  } finally { M.setReadOnly(false); }
  assert.match(M.tabHtml({ res: { meetings: [{ id: 'L1', name: 'Synthetic', visitDate: '2026-11-21', report: null }], today: '2026-11-21' }, today: '2026-11-21' }), /data-mt-report/, 'ordinary user retains report action');
});
