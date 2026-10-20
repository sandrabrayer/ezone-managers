'use strict';
/* «מדריך» tab (20 Oct 2026, docs/guide.md): a static Hebrew RTL usage guide,
 * open to every role, with no feed data and no inline script. The bonus table
 * is cross-checked against the LATEST rule set in lib/bonus-eligibility.js so
 * the guide can never drift from the math. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BE = require('../lib/bonus-eligibility.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('public/index.html');
const guide = /<section class="panel" id="panel-guide"[\s\S]*?<\/section>\s*<\/div>\s*<\/section>/.exec(html)[0];

const SECTIONS = ['g-tabs', 'g-today', 'g-bonus', 'g-patients', 'g-team', 'g-logs', 'g-committees', 'g-summaries', 'g-feedback', 'g-access'];

test('guide: a «מדריך» top tab after the houses; the page is RTL Hebrew', () => {
  const nav = /<nav class="tabs"[\s\S]*?<\/nav>/.exec(html)[0];
  const tabs = [...nav.matchAll(/data-tab="(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tabs[tabs.length - 1], ['guide', 'מדריך']);
  assert.match(html, /<html lang="he" dir="rtl">/);
});

test('guide: every section exists once, in order, and the table of contents links to each', () => {
  let at = -1;
  for (const id of SECTIONS) {
    const i = guide.indexOf(`id="${id}"`);
    assert.ok(i > at, `${id} in order`);
    assert.equal(guide.split(`id="${id}"`).length, 2, `${id} once`);
    assert.match(guide, new RegExp(`<a href="#${id}">`), `TOC → ${id}`);
    at = i;
  }
  for (const t of ['הבית היום', 'בונוס', 'ועדות', 'סיכומי ישיבות', 'משוב']) assert.ok(guide.includes(t), t);
});

test('guide: static and safe — no script, no inline handler, no javascript: link, no data hooks', () => {
  assert.doesNotMatch(guide, /<script|\son\w+=|javascript:/i);
  assert.doesNotMatch(guide, /data-(stat|log|sub|dash|bonus)/, 'no element the data code fills');
  const hrefs = [...guide.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.every((h) => /^#g-[a-z]+$/.test(h)), 'only in-page anchors');
});

test('guide: the bonus table matches the latest rule set (threshold, gate = threshold × 30, full occupancy) and the amounts', () => {
  const set = BE.RULE_SETS[BE.RULE_SETS.length - 1];
  assert.equal(set.from, '2026-10', 'the guide describes the October 2026 rules');
  const NAMES = { ramot: 'רמות השבים', raanana: 'רעננה אשר', efroni: 'קיסריה עפרוני', rehab: 'קיסריה ריהאב', pardes: 'רעננה הפרדס' };
  for (const [key, name] of Object.entries(NAMES)) {
    const r = set.houses[key];
    const full = Math.max(...r.tiers.map((t) => t.patients));
    assert.match(guide, new RegExp(`<tr><td>${name}</td><td>${r.threshold}</td><td>${r.threshold * 30}</td><td>${full}</td></tr>`), name);
  }
  const amounts = set.houses.ramot.tiers.map((t) => t.amount.toLocaleString('en-US'));
  for (const a of amounts) assert.ok(guide.includes(`${a} ₪`), a);
  assert.ok(guide.includes(`${set.intakeMeeting.amount} ₪`));
  assert.ok(guide.includes(`${set.referral.amount} ₪ פעם אחת`));
});

test('guide: open to every role — a manager keeps the tab and may open it; other network tabs still map to their house', () => {
  const app = read('public/app.js');
  assert.match(app, /btn\.hidden = btn\.dataset\.tab !== u\.house && btn\.dataset\.tab !== 'guide';/);
  assert.match(app, /return key === 'guide' \? 'guide' : u\.house;/);
  assert.match(app, /const TOP_TABS_ = \[[^\]]*'guide'\]/);
  assert.match(app, /getElementById\('guidePrint'\)[\s\S]*?window\.print\(\)/, 'print wired from app.js (CSP: no inline script)');
});

test('guide: SW cache bumped to v34 (monotonic from live v33)', () => {
  assert.ok(Number(/const CACHE = 'ezone-managers-v(\d+)'/.exec(read('public/sw.js'))[1]) >= 34);
});

test('guide: every section is shipped (committees, summaries, feedback — 20 Oct 2026): no «בקרוב» left', () => {
  assert.doesNotMatch(guide, /guide-soon/);
  assert.match(guide, /<section class="card guide-sec" id="g-committees">\s*<h2>7\. ועדות<\/h2>/);
  assert.match(guide, /<section class="card guide-sec" id="g-feedback">\s*<h2>9\. תזכורות משוב חצי־שנתי<\/h2>/);
});
