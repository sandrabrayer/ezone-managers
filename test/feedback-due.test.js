'use strict';
/* Half-yearly feedback «משוב» — lib/feedback-due.js (docs/feedback-reminders.md). Pure date logic. */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/feedback-due.js');

const TODAY = '2026-10-20';

test('addMonths: +6 calendar months, month ends clamp (never roll into the next month), leap years, year wrap', () => {
  assert.equal(F.addMonths('2026-04-20', 6), '2026-10-20');
  assert.equal(F.addMonths('2026-08-31', 6), '2027-02-28', '31 Aug → 28 Feb');
  assert.equal(F.addMonths('2027-08-31', 6), '2028-02-29', 'leap year');
  assert.equal(F.addMonths('2026-08-30', 6), '2027-02-28');
  assert.equal(F.addMonths('2026-03-31', 6), '2026-09-30', '31 Mar → 30 Sep');
  assert.equal(F.addMonths('2026-12-15', 6), '2027-06-15', 'year wrap');
  assert.equal(F.addMonths('2026-02-28', 6), '2026-08-28', 'a month-end that is not the 31st stays the same day');
  assert.equal(F.addMonths('2026-02-30', 6), '', 'invalid input → no date');
  assert.equal(F.addMonths('', 6), '');
});

test('dueFor: last feedback wins over the start date; no start date and no feedback → unknown, never a guessed date', () => {
  assert.deepEqual(pick(F.dueFor({ name: 'א', startDate: '2025-01-01' }, '2026-07-01', TODAY)), ['2026-07-01', '2027-01-01', 'ok']);
  assert.deepEqual(pick(F.dueFor({ name: 'ב', startDate: '2026-05-01' }, '', TODAY)), ['2026-05-01', '2026-11-01', 'soon']);
  assert.deepEqual(pick(F.dueFor({ name: 'ג', startDate: '2026-04-19' }, '', TODAY)), ['2026-04-19', '2026-10-19', 'overdue']);
  assert.deepEqual(pick(F.dueFor({ name: 'ד', startDate: '2026-04-20' }, '', TODAY)), ['2026-04-20', '2026-10-20', 'soon'], 'due today = soon (not overdue yet)');
  assert.deepEqual(pick(F.dueFor({ name: 'ה' }, '', TODAY)), ['', '', 'unknown']);
  assert.deepEqual(pick(F.dueFor({ name: 'ו', startDate: 'not-a-date' }, '', TODAY)), ['', '', 'unknown']);
  assert.deepEqual(pick(F.dueFor({ name: 'ז' }, '2026-06-01', TODAY)), ['2026-06-01', '2026-12-01', 'ok'], 'feedback without a start date still counts');
});
function pick(o) { return [o.anchor, o.due, o.status]; }

test('soon window = 30 days inclusive; overdue = due before today', () => {
  assert.equal(F.dueFor({ name: 'x', startDate: '2026-05-19' }, '', TODAY).status, 'soon', 'due +30 (inclusive)');
  assert.equal(F.dueFor({ name: 'x', startDate: '2026-05-19' }, '', TODAY).daysLeft, 30);
  assert.equal(F.dueFor({ name: 'x', startDate: '2026-05-20' }, '', TODAY).status, 'ok', 'due +31 → not yet');
  assert.equal(F.dueFor({ name: 'x', startDate: '2026-05-20' }, '', TODAY).daysLeft, 31);
});

test('lastFeedbackBy: the latest real, non-future date per (trimmed) name', () => {
  const m = F.lastFeedbackBy([
    { employee: ' נועה ', doneAt: '2026-03-01' }, { employee: 'נועה', doneAt: '2026-06-01' }, { employee: 'נועה', doneAt: '2026-04-01' },
    { employee: 'נועה', doneAt: '2027-01-01' }, { employee: 'דן', doneAt: 'bad' }, null, { employee: '', doneAt: '2026-01-01' }
  ], TODAY);
  assert.deepEqual(m, { 'נועה': '2026-06-01' });
});

test('houseFeedback: inactive left out, same-name people retained, sorted overdue → soon → ok → unknown', () => {
  const roster = [
    { name: 'בתאריך', startDate: '2026-01-01' },                    // due 2026-07-01 → overdue
    { name: 'קרוב', startDate: '2026-05-05' },                      // due 2026-11-05 → soon
    { name: 'רחוק', startDate: '2026-09-01' },                      // due 2027-03-01 → ok
    { name: 'בלי תאריך' },                                          // unknown
    { name: 'עזב', startDate: '2025-01-01', active: false },
    { name: 'עזב2', startDate: '2025-01-01', active: 'false' },
    { name: 'קרוב', startDate: '2020-01-01' },                      // duplicate name → visible, ambiguous
    { name: 'משוב', startDate: '2025-01-01' }                       // feedback 2026-08-01 → due 2027-02-01 → ok
  ];
  const r = F.houseFeedback(roster, [{ employee: 'משוב', doneAt: '2026-08-01' }], TODAY);
  assert.deepEqual(r.items.map((x) => [x.name, x.status]), [['קרוב', 'overdue'], ['בתאריך', 'overdue'], ['קרוב', 'soon'], ['משוב', 'ok'], ['רחוק', 'ok'], ['בלי תאריך', 'unknown']]);
  assert.deepEqual([r.overdue, r.soon, r.unknown, r.today], [2, 1, 1, TODAY]);
  assert.ok(r.items.filter(x => x.name === 'קרוב').every(x => x.identityAmbiguous));
});

test('distinct stable employee IDs retain same-name people and never share legacy feedback', () => {
  const roster = [{ id: 'w1', name: 'Same', startDate: '2026-01-01' }, { id: 'w2', name: 'Same', startDate: '2026-02-01' }];
  const r = F.houseFeedback(roster, [{ employee: 'Same', doneAt: '2026-10-01' }, { employeeId: 'w1', employee: 'Old name', doneAt: '2026-09-01' }], TODAY);
  assert.equal(r.items.length, 2);
  assert.equal(r.items.find(x => x.employeeId === 'w1').lastFeedback, '2026-09-01');
  assert.equal(r.items.find(x => x.employeeId === 'w2').lastFeedback, '');
});
test('duplicate rows for one stable ID collapse; a feedback row ID is not an employee ID', () => {
  const r = F.houseFeedback([{ workerId: 'w1', name: 'Only' }, { workerId: 'w1', name: 'Only' }],
    [{ id: 'log-1', employee: 'Only', doneAt: '2026-09-01' }], TODAY);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].lastFeedback, '', 'a stable identity cannot inherit an unverified name-only record');
  const legacy = F.houseFeedback([{ name: 'Only' }], [{ id: 'log-1', employee: 'Only', doneAt: '2026-09-01' }], TODAY);
  assert.equal(legacy.items[0].lastFeedback, '2026-09-01', 'unique legacy names retain their existing behavior');
});

test('validDoneAt: a real date, not in the future, not before 2000', () => {
  assert.equal(F.validDoneAt('2026-10-20', TODAY), true);
  assert.equal(F.validDoneAt('2026-10-21', TODAY), false);
  assert.equal(F.validDoneAt('1999-12-31', TODAY), false);
  assert.equal(F.validDoneAt('2026-02-30', TODAY), false);
  assert.equal(F.validDoneAt('', TODAY), false);
});
