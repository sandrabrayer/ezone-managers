'use strict';
/* public/occupancy-export.js — the CSV of the permanent «תפוסה חודשית (סופי)»
 * view. Pure module: no DOM, no network, so it is tested directly.
 *
 * What is guarded here: the UTF-8 BOM, the Hebrew header row and its order,
 * CSV-injection neutralisation (= + - @ tab CR), quote escaping, the manager
 * name going through BonusView.safeLabel, the file name, and — the important
 * one — that NO field outside the eight documented columns can reach the
 * file. */
const test = require('node:test');
const assert = require('node:assert/strict');

const X = require('../public/occupancy-export');

const ROW = {
  month: '2026-08',
  key: 'ramot',
  houseLabel: 'רמות השבים',
  manager: 'אורן',
  treatmentDays: 441,
  daysInMonth: 31,
  avgDaily: 14.72,
  capacity: 20,
  occupancyPct: 73.58
};
const lines = (csv) => csv.replace(/^﻿/, '').trim().split('\r\n');

test('the file starts with a UTF-8 BOM (Excel opens the Hebrew correctly)', () => {
  const csv = X.buildCsv([ROW]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.startsWith('﻿'), 'the BOM must be the first character');
  assert.ok(csv.endsWith('\r\n'), 'CRLF line endings, terminated');
});

test('header row is the eight Hebrew columns, in order', () => {
  assert.deepEqual(X.HEADERS, ['חודש', 'בית', 'מנהל/ת', 'ימי טיפול', 'ימים בחודש', 'ממוצע יומי', 'קיבולת', 'תפוסה %']);
  assert.equal(lines(X.buildCsv([]))[0], 'חודש,בית,מנהל/ת,ימי טיפול,ימים בחודש,ממוצע יומי,קיבולת,תפוסה %');
  assert.equal(lines(X.buildCsv([])).length, 1, 'no rows → header only');
});

test('a row is written as locale-independent numbers (one decimal for averages and %)', () => {
  assert.equal(lines(X.buildCsv([ROW]))[1], '2026-08,רמות השבים,אורן,441,31,14.7,20,73.6');
});

test('missing figures are written empty, never as 0', () => {
  const row = { ...ROW, treatmentDays: null, avgDaily: undefined, occupancyPct: 73.58 };
  assert.equal(lines(X.buildCsv([row]))[1], '2026-08,רמות השבים,אורן,,31,,20,73.6');
});

test('CSV injection: a cell starting with = + - @ tab or CR is prefixed with an apostrophe', () => {
  for (const evil of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '\t=cmd', '\r=cmd', '=HYPERLINK("http://x","x")']) {
    const cell = X.csvCell(evil);
    assert.match(cell, /^"?'/, `"${evil}" must be neutralised: got ${cell}`);
    assert.ok(!/^"?[=+\-@\t\r]/.test(cell), `"${evil}" still opens as a formula: ${cell}`);
  }
  // …through the real row path too (a hand-edited sheet cell in `manager`).
  const csv = X.buildCsv([{ ...ROW, manager: '=cmd|\' /C calc\'!A0' }]);
  assert.match(lines(csv)[1], /,"'=cmd\|' \/C calc'!A0",/);
  assert.ok(!lines(csv)[1].includes(',=cmd'), 'a formula must never start a field');
});

test('quotes, commas and newlines are RFC-4180 quoted', () => {
  assert.equal(X.csvCell('בית "אשר"'), '"בית ""אשר"""');
  assert.equal(X.csvCell('a,b'), '"a,b"');
  assert.equal(X.csvCell('a\nb'), '"a\nb"');
  assert.equal(X.csvCell('plain'), 'plain');
  assert.equal(X.csvCell(null), '');
  assert.equal(X.csvCell(undefined), '');
  // A quoted cell keeps the column count: 8 fields whatever the content.
  const csv = X.buildCsv([{ ...ROW, manager: 'a,b"c' }]);
  assert.equal((lines(csv)[1].match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) || []).length, 7);
});

test('the manager goes through BonusView.safeLabel — a numeric feed value never reaches the file', () => {
  for (const junk of [2577, '2577', '2,500 ₪', '  ', '']) {
    const csv = X.buildCsv([{ ...ROW, manager: junk }]);
    assert.equal(lines(csv)[1], '2026-08,רמות השבים,אורן,441,31,14.7,20,73.6'.replace('אורן', ''),
      `numeric/blank manager must be dropped: ${junk}`);
    assert.ok(!lines(csv)[1].includes('2577'), 'a stray backend figure reached the CSV');
  }
});

test('ONLY the eight documented columns are written — every other field is dropped', () => {
  const csv = X.buildCsv([{
    ...ROW,
    capturedAt: '2026-09-01T03:00:00Z',
    houseId: 'arfoni',
    projectedBonus: 2577, lockedIn: true, qualifies: true, tier: 3, amount: 2577,
    quarterlyBonus: 5000, bonusAmount: 2577, note: 'secret'
  }]);
  for (const junk of ['capturedAt', '2026-09-01', 'arfoni', '2577', '5000', 'secret', 'true']) {
    assert.ok(!csv.includes(junk), `"${junk}" must not reach the CSV`);
  }
  assert.equal(lines(csv)[1].split(',').length, 8);
});

test('a malformed month is written empty rather than guessed', () => {
  assert.equal(lines(X.buildCsv([{ ...ROW, month: '2026-13' }]))[1].split(',')[0], '');
  assert.equal(lines(X.buildCsv([{ ...ROW, month: 'javascript:alert(1)' }]))[1].split(',')[0], '');
});

test('file name is occupancy-<from>_to_<to>.csv, with a safe fallback', () => {
  assert.equal(X.fileName('2026-05', '2026-08'), 'occupancy-2026-05_to_2026-08.csv');
  assert.equal(X.fileName('2026-05', '2026-05'), 'occupancy-2026-05_to_2026-05.csv');
  for (const bad of [null, '', '2026-13', '../../etc/passwd', '2026-8']) {
    assert.equal(X.fileName(bad, '2026-08'), 'occupancy.csv', `${bad} must not build a name`);
    assert.equal(X.fileName('2026-05', bad), 'occupancy.csv');
  }
});

test('the module is pure — no DOM, no network, no globals', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'occupancy-export.js'), 'utf8');
  for (const needle of ['document', 'window.', 'fetch(', 'Blob', 'innerHTML', 'localStorage']) {
    assert.ok(!src.includes(needle), `occupancy-export.js must not touch ${needle}`);
  }
});
