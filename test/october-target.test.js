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

test('every managers house has the table\'s monthly target — and no October cost: that comes from the staffing feed', () => {
  const expected = { ramot: 265000, efroni: 205000, rehab: 170000, pardes: 150000, raanana: 80000 };
  assert.deepEqual(Object.keys(OT.PLAN).sort(), access.HOUSE_KEYS.slice().sort(), 'exactly the app\'s houses');
  Object.keys(expected).forEach((h) => {
    assert.deepEqual(OT.forHouse(h), { baselineMonth: '2026-10', targetFrom: '2026-11', target: expected[h] }, h);
    assert.deepEqual(Object.keys(OT.PLAN[h]).sort(), ['staffingId', 'target'], 'no stored October figure');
  });
  assert.equal(OT.PLAN.raanana.staffingId, 'asher');
  assert.equal(OT.PLAN.efroni.staffingId, 'ofroni');
});

test('unknown or hostile house keys return null', () => {
  ['', 'hq', 'asher', 'ofroni', '__proto__', 'constructor', 'toString', null, undefined, 5, {}, []].forEach((h) =>
    assert.equal(OT.forHouse(h), null, String(h)));
});

test('the targets are server-only, and the page always asks the feed for October 2026', () => {
  const pub = path.join(__dirname, '..', 'public');
  assert.ok(!fs.existsSync(path.join(pub, 'october-target.js')));
  const work = fs.readFileSync(path.join(pub, 'work.js'), 'utf8');
  assert.match(work, /var OCT = '2026-10';\s*\n\s*if \(months\.indexOf\(OCT\) < 0\) months\.push\(OCT\);/);
  assert.match(work, /st\.octoberCost = \(octGot && octGot\.cost\) \|\| null;/);
  const src = fs.readdirSync(pub).filter((f) => /\.(js|html)$/.test(f)).map((f) => fs.readFileSync(path.join(pub, f), 'utf8')).join('\n');
  ['322537', '268727', '198727', '161231', '168785', '129261', '31970', '12537'].forEach((n) =>
    assert.ok(!src.includes(n), 'an old table figure in a browser file: ' + n));
});
