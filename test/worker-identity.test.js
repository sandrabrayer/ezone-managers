'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/feedback-due');
const W = require('../public/work');
const C = require('../public/crm');

const TODAY = '2026-11-21';
const ALIKE = [
  { workerId: 'staff-A', name: 'דנה', phone: '050-111-2222', kind: 'guide', role: 'מדריכה', startDate: '2026-01-01' },
  { workerId: 'staff-B', name: 'דנה', phone: '050-333-4444', kind: 'guide', role: 'מדריכה', startDate: '2026-04-01' }
];
const legacy = (roster, logRows = []) => ({
  today: TODAY, team: { available: true, staff: roster, today: [], shifts: [] },
  feedback: { supported: true, rows: logRows },
  logs: { staffTalks: [], events: [], familyCalls: [] }
});

test('two workers sharing a name remain independent and historic name-only feedback belongs to neither', () => {
  const x = F.houseFeedback(ALIKE, [
    { employee: 'דנה', doneAt: '2026-10-01' },
    { employeeId: 'staff-A', employee: 'דנה הישנה', doneAt: '2026-09-10' },
    { workerId: 'staff-B', employee: 'דנה', doneAt: '2026-10-20' }
  ], TODAY);
  assert.equal(x.items.length, 2);
  const a = x.items.find(i => i.employeeId === 'staff-A');
  const b = x.items.find(i => i.employeeId === 'staff-B');
  assert.equal(a.lastFeedback, '2026-09-10');
  assert.equal(b.lastFeedback, '2026-10-20');
  assert.deepEqual([a.phoneSuffix, b.phoneSuffix].sort(), ['2222', '4444']);
  assert.ok(x.items.every(i => i.identityAmbiguous && i.writeBlocked), 'name-only write cannot distinguish the people');
  const list = W.feedbackListHtml(legacy(ALIKE));
  assert.equal((list.match(/נדרש זיהוי עובד\/ת מאומת/g) || []).length, 2);
  assert.equal((list.match(/data-fb-form/g) || []).length, 0);
});

test('phone distinguishes people in the local UI, but neither phone nor name invents history', () => {
  const two = [
    { name: 'רוני', phone: '054-111-1234', kind: 'guide', startDate: '2026-01-01' },
    { name: 'רוני', phone: '054-111-5678', kind: 'guide', startDate: '2026-04-01' }
  ];
  assert.equal(F.validPhone(two[0]), '0541111234');
  assert.equal(F.validPhone({ phone: '+972541115678' }), '0541115678');
  assert.equal(F.employeeRef(two[0], two), 'phone:0541111234');
  assert.equal(F.employeeRef(two[1], two), 'phone:0541115678');
  assert.equal(F.resolveEmployee(two, 'רוני'), null, 'a bare name never selects the first match');
  assert.equal(F.resolveEmployee(two, F.employeeRef(two[1], two)), two[1]);
  const old = F.houseFeedback(two, [{ employee: 'רוני', doneAt: '2026-10-01' }], TODAY);
  assert.ok(old.items.every(i => i.lastFeedback === ''), 'old name-only feedback not guessed');
  const roster = legacy(two);
  const h = W.teamHtml(roster);
  assert.match(h, /data-emp-open="phone:0541111234"/);
  assert.match(h, /data-emp-open="phone:0541115678"/);
  const c1 = C.employeeCardHtml(roster, 'phone:0541111234', { available: false });
  const c2 = C.employeeCardHtml(roster, 'phone:0541115678', { available: false });
  assert.match(c1, /054-111-1234/);
  assert.doesNotMatch(c1, /054-111-5678/);
  assert.match(c2, /054-111-5678/);
  assert.doesNotMatch(c2, /054-111-1234/);
});

test('unknown or repeated phone does not become a fake personal identity', () => {
  const noPhone = [{ name: 'אבי' }, { name: 'אבי' }];
  assert.equal(F.employeeRef(noPhone[0], noPhone), '');
  assert.equal(F.resolveEmployee(noPhone, 'אבי'), null);
  const sharedPhone = [{ name: 'אבי', phone: '0500001111' }, { name: 'אבי', phone: '0500001111' }];
  assert.equal(F.employeeRef(sharedPhone[0], sharedPhone), '');
  assert.equal(F.resolveEmployee(sharedPhone, 'phone:0500001111'), null);
  assert.equal(F.validPhone({ phone: 'fake' }), '');
  assert.equal(F.validPhone({ phone: '05012345' }), '');
  const h = W.teamHtml(legacy(noPhone.map(e => ({ ...e, kind: 'guide' }))));
  assert.doesNotMatch(h, /data-emp-open=/);
  assert.match(h, /ללא זיהוי חד-משמעי/);
});

test('personal cost and birthdate do not use the first same-name payroll row', () => {
  const d = legacy(ALIKE);
  d.logs.staffTalks = [{
    id: 'l1', employeeName: 'דנה', summary: 'private note belongs to unknown worker',
    talkDate: TODAY, author: 'מנהל', canEdit: true
  }];
  const costs = {
    available: true, month: '2026-11', total: 45000,
    workers: [{ name: 'דנה', cost: 17000, birthDate: '1981-01-03' }]
  };
  const c = C.employeeCardHtml(d, 'wid:staff-A', costs);
  assert.match(c, /050-111-2222/);
  assert.doesNotMatch(c, /17,000/);
  assert.doesNotMatch(c, /3\/1\/1981/);
  assert.doesNotMatch(c, /private note belongs/);
  assert.doesNotMatch(c, /data-emp-talk/);
  assert.match(c, /שם זהה/);
  const specific = { ...costs, workers: [{ workerId: 'staff-A', name: 'דנה', cost: 17000, birthDate: '1981-01-03' }] };
  assert.match(C.employeeCardHtml(d, 'wid:staff-A', specific), /17,000/);
  assert.doesNotMatch(C.employeeCardHtml(d, 'wid:staff-B', specific), /17,000/);
  assert.match(C.employeeCardHtml(d, 'דנה', costs), /לא ניתן לזהות/);
});

test('same stable ID is one employee despite duplicate roster rows; rename follows ID only', () => {
  const input = [{ workerId: 'W1', name: 'רחל', startDate: '2026-02-01' },
                 { workerId: 'W1', name: 'רחל', startDate: '2026-02-01' }];
  const rows = [{ workerId: 'W1', employee: 'שם קודם', doneAt: '2026-09-20' },
                { employee: 'רחל', doneAt: '2026-11-01' }];
  const out = F.houseFeedback(input, rows, TODAY);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].lastFeedback, '2026-09-20');
  assert.equal(out.items[0].writeBlocked, true, 'until Dashboard accepts stable worker ID');
  assert.equal(out.items[0].phoneSuffix, undefined);
});

test('simple unambiguous name-only feedback remains writable and retains its historic result', () => {
  const roster = [{ name: 'אורית', startDate: '2026-01-01' }];
  const r = F.houseFeedback(roster, [{ employee: 'אורית', doneAt: '2026-09-01' }], TODAY);
  assert.equal(r.items[0].writeBlocked, false);
  assert.equal(r.items[0].lastFeedback, '2026-09-01');
  const h = W.feedbackListHtml(legacy(roster));
  assert.match(h, /data-fb-form/);
  assert.equal(F.resolveEmployee(roster, 'אורית'), roster[0]);
});
