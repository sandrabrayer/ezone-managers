'use strict';
/* CSV export rules for the «תפוסה חודשית (סופי)» card — the pure module
 * public/occupancy-export.js. No DOM, no network: everything that decides
 * what lands in the file is asserted here.
 *
 * What the tests pin down:
 *   - the UTF-8 BOM and the eight Hebrew headers, in order;
 *   - CSV-injection escaping (= + - @ TAB CR) and quote doubling;
 *   - the manager column goes through BonusView.safeLabel;
 *   - ONLY the documented fields are written — no backend bonus field can
 *     ride along on a row object;
 *   - the occupancy-<from>_to_<to>.csv file name, with both months validated.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const OE = require('../public/occupancy-export');

const ROW = {
  month: '2026-08',
  houseName: 'רמות השבים',
  manager: 'אורן',
  managerFallback: 'אורן',
  treatmentDays: 441,
  daysInMonth: 31,
  avgDaily: 14.23,
  capacity: 20,
  occupancyPct: 71.15
};

/* Data lines without the header (and without the BOM). */
const bodyLines = (csv) => csv.replace(OE.BOM, '').trim().split(OE.EOL).slice(1);
const fields = (line) => line.split('","').map((s) => s.replace(/^"|"$/g, ''));

test('the file starts with a UTF-8 BOM and the eight Hebrew headers in order', () => {
  const csv = OE.buildCsv([ROW]);
  assert.ok(csv.startsWith('﻿'), 'without the BOM Excel renders the Hebrew as mojibake');
  assert.equal(OE.BOM, '﻿');
  const header = csv.replace(OE.BOM, '').split(OE.EOL)[0];
  assert.equal(header, '"חודש","בית","מנהל/ת","ימי טיפול","ימים בחודש","ממוצע יומי","קיבולת","תפוסה %"');
  assert.deepEqual(OE.HEADERS, ['חודש', 'בית', 'מנהל/ת', 'ימי טיפול', 'ימים בחודש', 'ממוצע יומי', 'קיבולת', 'תפוסה %']);
  assert.ok(csv.endsWith(OE.EOL), 'lines are CRLF-terminated');
});

test('a data row writes the documented fields, ASCII numbers, one decimal on the averages', () => {
  const line = bodyLines(OE.buildCsv([ROW]))[0];
  assert.equal(line, '"2026-08","רמות השבים","אורן","441","31","14.2","20","71.2"');
  assert.deepEqual(fields(line)[0], '2026-08');
  // No he-IL thousands separator — a "1,234" would shift a column downstream.
  const big = bodyLines(OE.buildCsv([{ ...ROW, treatmentDays: 1234 }]))[0];
  assert.match(big, /"1234"/);
  assert.doesNotMatch(big, /1,234/);
});

test('a missing number is written empty — never 0 standing in for "no data"', () => {
  const line = bodyLines(OE.buildCsv([{
    ...ROW, treatmentDays: null, daysInMonth: undefined, avgDaily: '', capacity: NaN, occupancyPct: 'x'
  }]))[0];
  assert.equal(line, '"2026-08","רמות השבים","אורן","","","","",""');
});

test('CSV injection: a value starting with = + - @ TAB or CR is prefixed with an apostrophe', () => {
  assert.deepEqual(OE.INJECTION_CHARS, ['=', '+', '-', '@', '\t', '\r']);
  for (const ch of OE.INJECTION_CHARS) {
    const payload = `${ch}HYPERLINK("http://evil","x")`;
    assert.equal(OE.escapeCell(payload), `"'${payload.replace(/"/g, '""')}"`,
      `a leading ${JSON.stringify(ch)} must not be left as a formula trigger`);
  }
  // …and through a real row: a manager name typed as a formula in the sheet.
  const line = bodyLines(OE.buildCsv([{ ...ROW, manager: '=cmd|calc', houseName: '@bad' }]))[0];
  assert.match(line, /"'@bad","'=cmd\|calc"/);
  assert.doesNotMatch(line, /"=cmd/, 'an un-prefixed formula reached the file');
});

test('quotes, commas and newlines in an upstream string cannot break out of a field', () => {
  assert.equal(OE.escapeCell('a"b'), '"a""b"');
  assert.equal(OE.escapeCell('a,b'), '"a,b"');
  assert.equal(OE.escapeCell('a\nb'), '"a\nb"');
  const csv = OE.buildCsv([{ ...ROW, houseName: 'בית "א",X' }]);
  const line = csv.replace(OE.BOM, '').split(OE.EOL)[1];
  assert.match(line, /"בית ""א"",X"/);
  // Every field is quoted, so the comma inside the name adds no column.
  assert.equal((line.match(/","/g) || []).length, OE.HEADERS.length - 1);
});

test('the manager column goes through BonusView.safeLabel — a numeric string is dropped, the roster name used', () => {
  // A backend bonus figure that leaked into the manager text field.
  assert.equal(fields(bodyLines(OE.buildCsv([{ ...ROW, manager: '2,500 ₪' }]))[0])[2], 'אורן',
    'a numeric manager value must fall back to the roster name');
  assert.equal(fields(bodyLines(OE.buildCsv([{ ...ROW, manager: 2500 }]))[0])[2], 'אורן');
  assert.equal(fields(bodyLines(OE.buildCsv([{ ...ROW, manager: '', managerFallback: '' }]))[0])[2], '');
  assert.equal(fields(bodyLines(OE.buildCsv([{ ...ROW, manager: 'חנן' }]))[0])[2], 'חנן');
});

test('nothing outside the documented fields reaches the file', () => {
  const junk = {
    qualifies: true, lockedIn: true, projectedBonus: 7777, quarterlyBonus: 5000,
    tier: 3, amount: 7777, bep: 7777, capturedAt: '2026-09-01T00:00:00Z', houseId: 'arfoni'
  };
  const csv = OE.buildCsv([{ ...ROW, ...junk }]);
  for (const v of ['7777', '5000', 'arfoni', 'capturedAt', '2026-09-01', 'true']) {
    assert.ok(!csv.includes(v), `backend field value "${v}" reached the CSV`);
  }
  assert.equal(bodyLines(csv)[0], '"2026-08","רמות השבים","אורן","441","31","14.2","20","71.2"');
});

test('a non-YYYY-MM month is written empty and rows that are not objects are skipped', () => {
  assert.equal(fields(bodyLines(OE.buildCsv([{ ...ROW, month: '2026-13' }]))[0])[0], '');
  assert.equal(bodyLines(OE.buildCsv([null, 'x', 5, ROW])).length, 1);
  assert.equal(bodyLines(OE.buildCsv([])).length, 0, 'header-only file when there is nothing to export');
  assert.equal(bodyLines(OE.buildCsv(undefined)).length, 0);
});

test('file name is occupancy-<from>_to_<to>.csv with both months validated', () => {
  assert.equal(OE.fileName('2026-05', '2026-08'), 'occupancy-2026-05_to_2026-08.csv');
  for (const bad of ['2026-13', '../../etc/passwd', '', null, undefined, '2026-8']) {
    assert.equal(OE.fileName(bad, '2026-08'), 'occupancy.csv', `"${bad}" must not steer the download name`);
    assert.equal(OE.fileName('2026-05', bad), 'occupancy.csv');
  }
});
