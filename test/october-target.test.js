'use strict';
/*
 * «עלות אוקטובר 2026 מול היעד» (15 Nov 2026) — the fixed numbers per house,
 * the same as the staffing app's TARGET_PLAN, and never served to the browser.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OT = require('../lib/october-target');
const access = require('../lib/access');

test('every managers house has the staffing app\'s numbers: table + shared freelancers, target, gap', () => {
  // [table, shared, total, target, gap] — staffing docs/target-budget-dec-2026.md
  const expected = {
    ramot:   [310000, 12537, 322537, 265000, 57537],
    efroni:  [260000, 8727, 268727, 205000, 63727],
    rehab:   [190000, 8727, 198727, 170000, 28727],
    pardes:  [129261, 31970, 161231, 150000, 11231],
    raanana: [163000, 5785, 168785, 80000, 88785]
  };
  assert.deepEqual(Object.keys(OT.PLAN).sort(), access.HOUSE_KEYS.slice().sort(), 'exactly the app\'s houses');
  Object.keys(expected).forEach((h) => {
    const t = OT.forHouse(h);
    const [table, shared, total, target, gap] = expected[h];
    assert.deepEqual([t.table, t.shared, t.total, t.target, t.gap], [table, shared, total, target, gap], h);
    assert.equal(t.baselineMonth, '2026-10');
    assert.equal(t.targetFrom, '2026-11');
  });
  assert.equal(OT.forHouse('efroni').gapPct, 23.7);
  assert.equal(OT.PLAN.raanana.staffingId, 'asher');
  assert.equal(OT.PLAN.efroni.staffingId, 'ofroni');
});

test('unknown or hostile house keys return null', () => {
  ['', 'hq', 'asher', 'ofroni', '__proto__', 'constructor', 'toString', null, undefined, 5, {}, []].forEach((h) =>
    assert.equal(OT.forHouse(h), null, String(h)));
});

test('the numbers are server-only: not under public/, and no file in public/ carries them', () => {
  const pub = path.join(__dirname, '..', 'public');
  assert.ok(!fs.existsSync(path.join(pub, 'october-target.js')));
  const src = fs.readdirSync(pub).filter((f) => /\.(js|html)$/.test(f)).map((f) => fs.readFileSync(path.join(pub, f), 'utf8')).join('\n');
  ['322537', '268727', '198727', '161231', '168785', '129261', '31970', '12537'].forEach((n) =>
    assert.ok(!src.includes(n), 'house figure in a browser file: ' + n));
});
