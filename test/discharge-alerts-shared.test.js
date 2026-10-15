'use strict';
/* Discharge alerts — the rule shared with the Dashboard (Task F, 15 Oct 2026).
 * E-Zone-Dashboard copies this module's core into lib/discharge-alerts.js
 * (separate repos cannot require each other). BOTH repos run this identical
 * fixture against their own copy; its sha256 is pinned on both sides, so a
 * change on one side only fails that side's CI. docs/discharge-alerts.md. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DA = require('../public/discharge-alerts.js');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'discharge-alert-cases.json');
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
/* The SAME hash is pinned in E-Zone-Dashboard test/dashboard-expected-discharges.test.js. */
const SHARED_FIXTURE_SHA256 = '8f0325ab4d56f32b9e64a8e744fc6b4430618e6b2dafce0d657c251c18e1b5f5';

test('shared fixture: byte-identical to the one E-Zone-Dashboard pins', () => {
  const h = crypto.createHash('sha256').update(fs.readFileSync(FIXTURE_PATH)).digest('hex');
  assert.equal(h, SHARED_FIXTURE_SHA256);
});

test('shared fixture: constants', () => {
  assert.equal(DA.ALERT_LEAD_DAYS, FIXTURE.ALERT_LEAD_DAYS);
  assert.equal(DA.TIME_ZONE, FIXTURE.TIME_ZONE);
});

test('shared fixture: boundary days (14 in, 15 out, 0, 1, -1, -3, year / leap edges, bad dates)', () => {
  for (const c of FIXTURE.alerts) {
    const data = { expectedDischargeSupported: true, patients: [{ name: 'א', expectedDischarge: { date: c.date } }] };
    const a = DA.houseAlerts(data, 'ramot', c.today).alerts[0];
    assert.deepEqual(a ? { days: a.days, kind: a.kind, whenText: a.whenText } : null, c.expect, c.today + ' → ' + c.date);
  }
});

test('shared fixture: Israel midnight and the no-date line', () => {
  for (const c of FIXTURE.israelToday) assert.equal(DA.israelToday(new Date(c.utc)), c.today, c.utc);
  for (const c of FIXTURE.noDateText) assert.equal(DA.noDateText(c.n), c.text);
});
