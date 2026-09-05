'use strict';
/* Ecosystem status doc guard — EZONE-ECOSYSTEM-STATUS.md is copied into every
 * E-Zone project as ground truth, so its Managers house roster must match the
 * code: every HOUSE_KEYS house, its Hebrew name and its current manager name
 * exactly as declared in HOUSE_LABELS (public/app.js). A manager rename or a
 * new house that lands in code but not in the doc fails CI here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const doc = read('EZONE-ECOSYSTEM-STATUS.md');
const appJs = read('public', 'app.js');

function houseLabels() {
  const m = appJs.match(/const HOUSE_LABELS = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'HOUSE_LABELS object must exist in public/app.js');
  const rows = [...m[1].matchAll(
    /^\s*(\w+):\s*\{\s*name:\s*'([^']+)',\s*manager:\s*'([^']+)'/gm
  )];
  assert.ok(rows.length > 0, 'HOUSE_LABELS rows must declare name and manager');
  return rows.map(([, key, name, manager]) => ({ key, name, manager }));
}

const HOUSES = houseLabels();

function rosterTable() {
  const section = doc.match(/## Managers: house roster[\s\S]*?(?=\n## )/);
  assert.ok(section, 'doc must have a "## Managers: house roster" section');
  const rows = [...section[0].matchAll(/^\| (\w+) \| ([^|]+?) \| ([^|]+?) \|/gm)]
    .filter(([, key]) => key !== 'Key')
    .map(([, key, name, manager]) => ({ key, name: name.trim(), manager: manager.trim() }));
  return rows;
}

test('status doc roster lists exactly the HOUSE_KEYS houses (5)', () => {
  const docKeys = rosterTable().map((r) => r.key).sort();
  assert.deepEqual(docKeys, HOUSES.map((h) => h.key).sort());
  assert.equal(docKeys.length, 5);
  assert.match(doc, /house roster \(5 houses/);
});

test('status doc roster names and managers match HOUSE_LABELS exactly', () => {
  const byKey = Object.fromEntries(rosterTable().map((r) => [r.key, r]));
  for (const h of HOUSES) {
    assert.ok(byKey[h.key], `doc roster missing ${h.key}`);
    assert.equal(byKey[h.key].name, h.name, `house name for ${h.key}`);
    assert.equal(byKey[h.key].manager, h.manager, `manager for ${h.key}`);
  }
});

test('status doc carries the current managers by name', () => {
  const expected = {
    raanana: 'שחר', ramot: 'אורן', efroni: 'חנן', rehab: 'רנטה', pardes: 'חן'
  };
  const byKey = Object.fromEntries(rosterTable().map((r) => [r.key, r.manager]));
  assert.deepEqual(byKey, expected);
});

test('status doc bonus model line covers Pardes', () => {
  assert.match(doc, /Efroni, Rehab & Pardes 10\/12\/13/);
});
