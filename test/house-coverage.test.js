'use strict';
/* House-enumeration guard — every place that lists houses must cover the SAME
 * set as HOUSE_KEYS in public/app.js. Adding a house to one enumeration but
 * not the others (frontend labels, bonus config, tabs, panels) silently drops
 * it from part of the UI; this test makes that a CI failure instead. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const appJs = read('public', 'app.js');
const indexHtml = read('public', 'index.html');
const { HOUSE_BONUS } = require('../lib/bonus-eligibility');

function houseKeys() {
  const m = appJs.match(/const HOUSE_KEYS = \[([^\]]+)\]/);
  assert.ok(m, 'HOUSE_KEYS array must exist in public/app.js');
  return m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
}

function houseLabelKeys() {
  const m = appJs.match(/const HOUSE_LABELS = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'HOUSE_LABELS object must exist in public/app.js');
  return [...m[1].matchAll(/^\s*(\w+):\s*\{/gm)].map((x) => x[1]);
}

const KEYS = houseKeys();

test('HOUSE_KEYS includes the new pardes house (5 houses total)', () => {
  assert.ok(KEYS.includes('pardes'));
  assert.equal(KEYS.length, 5);
});

test('HOUSE_LABELS covers exactly HOUSE_KEYS', () => {
  assert.deepEqual(houseLabelKeys().sort(), [...KEYS].sort());
});

test('lib/bonus-eligibility HOUSE_BONUS covers exactly HOUSE_KEYS', () => {
  assert.deepEqual(Object.keys(HOUSE_BONUS).sort(), [...KEYS].sort());
});

test('index.html has a tab and a panel for every house key', () => {
  for (const key of KEYS) {
    assert.match(indexHtml, new RegExp(`data-tab="${key}"`),
      `missing tab button for ${key}`);
    assert.match(indexHtml, new RegExp(`data-house-key="${key}"`),
      `missing detail panel for ${key}`);
  }
});

test('every rule set covers exactly HOUSE_KEYS', () => {
  const { RULE_SETS } = require('../lib/bonus-eligibility');
  for (const set of RULE_SETS) {
    assert.deepEqual(Object.keys(set.houses).sort(), [...KEYS].sort(), `rule set from ${set.from}`);
  }
});

test('current rules (from Oct 2026): first bonus ramot 14, raanana 10, efroni 9, rehab 9, pardes 7; full occupancy = capacity', () => {
  const first = Object.fromEntries(Object.entries(HOUSE_BONUS).map(([k, v]) => [k, v.threshold]));
  assert.deepEqual(first, { ramot: 14, raanana: 10, efroni: 9, rehab: 9, pardes: 7 });
  const steps = (k) => HOUSE_BONUS[k].tiers.map((t) => [t.patients, t.amount]);
  assert.deepEqual(steps('ramot'), [[20, 3000], [14, 2000]]);
  assert.deepEqual(steps('raanana'), [[14, 3000], [10, 2000]]);
  for (const k of ['efroni', 'rehab']) assert.deepEqual(steps(k), [[13, 3000], [9, 2000]], k);
  assert.deepEqual(steps('pardes'), [[13, 3000], [7, 2000]]);
  // Full occupancy = the house capacity in HOUSE_LABELS.
  const labels = appJs.match(/const HOUSE_LABELS = \{([\s\S]*?)\n\};/)[1];
  for (const key of KEYS) {
    const cap = Number(labels.match(new RegExp(`${key}:\\s*\\{[^}]*capacity:\\s*(\\d+)`))[1]);
    assert.equal(HOUSE_BONUS[key].tiers[0].patients, cap, `${key}: full occupancy = capacity`);
  }
});

test('HOUSE_LABELS threshold fallbacks match the current first tiers', () => {
  const labels = appJs.match(/const HOUSE_LABELS = \{([\s\S]*?)\n\};/)[1];
  for (const key of KEYS) {
    const row = labels.match(new RegExp(`${key}:\\s*\\{[^}]*threshold:\\s*(\\d+)`));
    assert.ok(row, `HOUSE_LABELS.${key} must declare a threshold`);
    assert.equal(Number(row[1]), HOUSE_BONUS[key].threshold, key);
  }
});

test("managers: raanana is שחר, ramot is אורן, pardes is חן", () => {
  const labels = appJs.match(/const HOUSE_LABELS = \{([\s\S]*?)\n\};/)[1];
  const managerOf = (key) => {
    const row = labels.match(new RegExp(`${key}:\\s*\\{[^}]*manager:\\s*'([^']+)'`));
    assert.ok(row, `HOUSE_LABELS.${key} must declare a manager`);
    return row[1];
  };
  assert.equal(managerOf('raanana'), 'שחר');
  assert.equal(managerOf('ramot'), 'אורן');
  assert.equal(managerOf('pardes'), 'חן');
  assert.doesNotMatch(labels, /עידו/, 'the outgoing raanana manager must be gone');
});
