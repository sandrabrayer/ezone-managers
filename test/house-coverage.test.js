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

test('pardes bonus parameters are copied from efroni exactly', () => {
  assert.deepEqual(HOUSE_BONUS.pardes, HOUSE_BONUS.efroni);
});

test("managers: raanana is שחר, pardes is חן", () => {
  const labels = appJs.match(/const HOUSE_LABELS = \{([\s\S]*?)\n\};/)[1];
  const managerOf = (key) => {
    const row = labels.match(new RegExp(`${key}:\\s*\\{[^}]*manager:\\s*'([^']+)'`));
    assert.ok(row, `HOUSE_LABELS.${key} must declare a manager`);
    return row[1];
  };
  assert.equal(managerOf('raanana'), 'שחר');
  assert.equal(managerOf('pardes'), 'חן');
  assert.doesNotMatch(labels, /עידו/, 'the outgoing raanana manager must be gone');
});
