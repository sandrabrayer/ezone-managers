'use strict';
/* Month visit counters ignore next-month look-ahead rows (26 Oct 2026).
   The Dashboard marks look-ahead visits (today .. today+14) with inSelectedMonth: false.
   «ביקורים החודש» (tile) and the «ביקורים וקליטות החודש» card count / list only the month;
   «ביקורים השבוע» and «ביקורים קרובים» keep ALL visits. Absent field = behaviour unchanged. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../public/work.js');

const TODAY = '2026-09-29'; // Tuesday → week Sun 27/9 – Sat 3/10 crosses into October
const BASE = [
  { date: '2026-09-05', time: '', name: 'ביקור תחילת חודש', meetingWith: 'אורן' },
  { date: '2026-09-28', time: '09:00', name: 'ביקור השבוע', meetingWith: 'אורן' },
  { date: '2026-09-30', time: '12:00', name: 'ביקור קרוב בחודש', meetingWith: '' }
];
const LOOKAHEAD = { date: '2026-10-02', time: '10:00', name: 'צפי שישי', meetingWith: '' };
const NEXT_MONTH = { date: '2026-10-08', time: '', name: 'צפי חודש הבא', meetingWith: '' };

function data(visits) { return { ok: true, today: TODAY, visits: visits, admissions: [] }; }
function tileCount(h, label) {
  const m = new RegExp('<b>([^<]*)</b><span>' + label + '</span>').exec(h);
  return m ? m[1] : null;
}
function cardCount(h) {
  const card = h.split('ביקורים וקליטות החודש')[1] || '';
  const m = /<b>(\d+)<\/b><span>ביקורים<\/span>/.exec(card);
  return m ? Number(m[1]) : null;
}
function upcomingPart(h) { return (h.split('ביקורים קרובים')[1] || '').split('אירועים חריגים')[0]; }
function patientsVisitList(h) { return h.split('ביקורים וקליטות החודש')[1] || ''; }

test('helper: only the boolean false drops a row; absent, true and any other value keep it', () => {
  const rows = [
    { name: 'absent' },
    { name: 'true', inSelectedMonth: true },
    { name: 'false', inSelectedMonth: false },
    { name: 'str-false', inSelectedMonth: 'false' },
    { name: 'zero', inSelectedMonth: 0 },
    { name: 'null', inSelectedMonth: null },
    { name: 'undef', inSelectedMonth: undefined }
  ];
  assert.deepEqual(W.visitsInSelectedMonth(rows).map((v) => v.name), ['absent', 'true', 'str-false', 'zero', 'null', 'undef']);
});

test('helper: pure — tolerates missing / non-array input and never mutates its argument', () => {
  assert.deepEqual(W.visitsInSelectedMonth(undefined), []);
  assert.deepEqual(W.visitsInSelectedMonth(null), []);
  assert.deepEqual(W.visitsInSelectedMonth('x'), []);
  assert.deepEqual(W.visitsInSelectedMonth({ length: 1, 0: {} }), []);
  const rows = [{ name: 'a' }, { name: 'b', inSelectedMonth: false }, null];
  const copy = JSON.parse(JSON.stringify(rows));
  const out = W.visitsInSelectedMonth(rows);
  assert.deepEqual(rows, copy, 'input untouched');
  assert.notEqual(out, rows, 'a new array');
  assert.deepEqual(out.map((v) => v && v.name), ['a', null], 'a null row is not dropped by this helper (unchanged behaviour)');
});

test('field absent: tile, card, week and upcoming are exactly as before', () => {
  const visits = BASE.concat([LOOKAHEAD, NEXT_MONTH]); // no inSelectedMonth anywhere
  const d = data(visits);
  const h = W.dashboardHtml(d);
  assert.equal(tileCount(h, 'ביקורים החודש'), '5', 'every visit counts, as today');
  assert.equal(tileCount(h, 'ביקורים השבוע'), '3', 'Sun 27/9 – Sat 3/10');
  assert.match(upcomingPart(h), /ביקור קרוב בחודש[\s\S]*צפי שישי[\s\S]*צפי חודש הבא/);
  const p = W.patientsHtml(d);
  assert.equal(cardCount(p), 5);
  assert.match(patientsVisitList(p), /צפי חודש הבא/);
  // byte-identical to the same rows carrying inSelectedMonth: true
  const flagged = visits.map((v) => Object.assign({}, v, { inSelectedMonth: true }));
  assert.equal(W.dashboardHtml(data(flagged)), h);
  assert.equal(W.patientsHtml(data(flagged)), p);
});

test('inSelectedMonth false: excluded from «ביקורים החודש» tile and the «ביקורים וקליטות החודש» card', () => {
  const visits = BASE.concat([
    Object.assign({}, LOOKAHEAD, { inSelectedMonth: false }),
    Object.assign({}, NEXT_MONTH, { inSelectedMonth: false })
  ]);
  const d = data(visits);
  assert.equal(tileCount(W.dashboardHtml(d), 'ביקורים החודש'), '3');
  const p = W.patientsHtml(d);
  assert.equal(cardCount(p), 3);
  const list = patientsVisitList(p);
  assert.ok(!list.includes('צפי חודש הבא'), 'look-ahead row not listed');
  assert.ok(!list.includes('צפי שישי'), 'look-ahead row not listed');
  assert.match(list, /ביקור תחילת חודש[\s\S]*ביקור השבוע|ביקור השבוע[\s\S]*ביקור תחילת חודש/);
});

test('inSelectedMonth false: still counted in «ביקורים השבוע» and listed in «ביקורים קרובים»', () => {
  const visits = BASE.concat([
    Object.assign({}, LOOKAHEAD, { inSelectedMonth: false }),
    Object.assign({}, NEXT_MONTH, { inSelectedMonth: false })
  ]);
  const h = W.dashboardHtml(data(visits));
  assert.equal(tileCount(h, 'ביקורים השבוע'), '3', 'the 2/10 look-ahead row is this week');
  const up = upcomingPart(h);
  assert.match(up, /צפי שישי<\/span><span class="wk-meta">2\/10\/26 10:00/);
  assert.match(up, /צפי חודש הבא<\/span><span class="wk-meta">8\/10\/26/);
});

test('inSelectedMonth true: included everywhere', () => {
  const visits = BASE.map((v) => Object.assign({}, v, { inSelectedMonth: true }));
  const d = data(visits);
  const h = W.dashboardHtml(d);
  assert.equal(tileCount(h, 'ביקורים החודש'), '3');
  assert.equal(tileCount(h, 'ביקורים השבוע'), '2');
  assert.match(upcomingPart(h), /ביקור קרוב בחודש/);
  assert.equal(cardCount(W.patientsHtml(d)), 3);
});

test('look-ahead rows still escaped where they are shown', () => {
  const evil = { date: '2026-10-01', time: '', name: '<img src=x onerror=alert(1)>', meetingWith: '', inSelectedMonth: false };
  const h = W.dashboardHtml(data(BASE.concat([evil])));
  assert.ok(!h.includes('<img'), 'never markup');
  assert.match(upcomingPart(h), /&lt;img src=x/);
});

test('service worker cache bumped past v40 (live on main before this change)', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.ok(Number(/const CACHE = 'ezone-managers-v(\d+)';/.exec(sw)[1]) >= 41);
});
