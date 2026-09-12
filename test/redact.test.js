'use strict';
/* Patient-name redaction (lib/redact.js) — the guard that lets the app be
 * open to anyone. Every assertion here is about the ANONYMOUS view. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactPatientNames, redactJsonText } = require('../lib/redact');

/* Shape of the real managersHouse payload (dashboard Apps Script →
 * managersHouse_ / computeMonthStats_). PATIENT is the value that must never
 * survive; the house name and the manager name must. */
const PATIENT = 'ישראל ישראלי';
function payload() {
  return {
    ok: true,
    month: '2026-09',
    key: 'ramot',
    name: 'רמות השבים',
    manager: 'אורן',
    patientsNow: 18,
    entriesMonth: 2,
    exitsMonth: 1,
    dailyChart: [{ date: '2026-09-01', count: 17 }],
    activity: [
      { date: '2026-09-03', kind: 'entry', name: PATIENT },
      { date: '2026-09-11', kind: 'exit', name: 'דנה כהן' }
    ],
    bonus: { treatmentNights: 549, total: 2500 }
  };
}

test('every activity name is stripped and flagged nameHidden', () => {
  const out = redactPatientNames(payload());
  for (const row of out.activity) {
    assert.equal('name' in row, false);
    assert.equal(row.nameHidden, true);
  }
});

test('dates, kinds and counts survive redaction untouched', () => {
  const out = redactPatientNames(payload());
  assert.deepEqual(out.activity.map((a) => a.date), ['2026-09-03', '2026-09-11']);
  assert.deepEqual(out.activity.map((a) => a.kind), ['entry', 'exit']);
  assert.equal(out.entriesMonth, 2);
  assert.equal(out.exitsMonth, 1);
  assert.deepEqual(out.dailyChart, [{ date: '2026-09-01', count: 17 }]);
});

test('house name and manager name are NOT patient data and survive', () => {
  const out = redactPatientNames(payload());
  assert.equal(out.name, 'רמות השבים');
  assert.equal(out.manager, 'אורן');
});

test('no patient name survives anywhere in the serialised payload', () => {
  const json = redactJsonText(JSON.stringify(payload()));
  assert.ok(!json.includes(PATIENT));
  assert.ok(!json.includes('דנה כהן'));
});

test('activity rows are caught wherever they are nested (shape-based rule)', () => {
  const nested = {
    houses: [
      { key: 'ramot', log: [{ date: '2026-09-03', kind: 'entry', name: PATIENT }] },
      { key: 'rehab', deep: { deeper: { kind: 'exit', name: PATIENT, date: '2026-09-04' } } }
    ]
  };
  const json = JSON.stringify(redactPatientNames(nested));
  assert.ok(!json.includes(PATIENT), 'a renamed or moved activity array must still be redacted');
});

test('an activity array is redacted even if its rows carry no kind', () => {
  const odd = { activity: [{ date: '2026-09-03', name: PATIENT }] };
  const json = JSON.stringify(redactPatientNames(odd));
  assert.ok(!json.includes(PATIENT));
});

test('a payload with no activity is passed through unchanged', () => {
  const overview = { ok: true, houses: [{ key: 'ramot', name: 'רמות השבים', patientsNow: 18 }] };
  assert.deepEqual(redactPatientNames(JSON.parse(JSON.stringify(overview))), overview);
});

test('circular payloads terminate instead of hanging', () => {
  const cyclic = { activity: [{ date: '2026-09-03', kind: 'entry', name: PATIENT }] };
  cyclic.self = cyclic;
  const out = redactPatientNames(cyclic);
  assert.equal(out.activity[0].nameHidden, true);
});

test('non-JSON upstream bodies return null so the caller can fail closed', () => {
  assert.equal(redactJsonText('<!DOCTYPE html><html>Apps Script error</html>'), null);
  assert.equal(redactJsonText(''), null);
});
