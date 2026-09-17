'use strict';
/* The permanent «תפוסה חודשית (סופי)» view in public/app.js.
 *
 * public/app.js is loaded in a vm sandbox with a tiny fake DOM, so the ACTUAL
 * render path is asserted on: the table model (settled months newest first,
 * one column per house, `arfoni` → `efroni`, an explicit "אין נתונים" for a
 * missing cell and never a 0), the explicit error state with its retry
 * button, the CSV export, and the two isolation rules — feed values reach the
 * DOM through textContent only, and no field outside the documented snapshot
 * columns reaches the DOM or the file. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const lib = (f) => fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8');

/* ── minimal fake DOM (a real tree: children, textContent, attributes) ── */
function makeEl(tag) {
  const el = {
    tagName: tag, children: [], attrs: {}, style: {}, hidden: false,
    parentNode: null, _cls: new Set(), _html: '', _text: '', _sub: new Map(), _listeners: {}
  };
  Object.defineProperty(el, 'className', {
    get() { return [...el._cls].join(' '); },
    set(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); el.children = []; el._sub.clear(); }
  });
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = String(v); }
  });
  Object.defineProperty(el, 'firstChild', { get() { return el.children[0] || null; } });
  el.classList = {
    add: (...c) => c.forEach((x) => el._cls.add(x)),
    remove: (...c) => c.forEach((x) => el._cls.delete(x)),
    toggle: (c, f) => { const on = f === undefined ? !el._cls.has(c) : !!f; on ? el._cls.add(c) : el._cls.delete(c); return on; },
    contains: (c) => el._cls.has(c)
  };
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  el.appendChild = (c) => { c.parentNode = el; el.children.push(c); return c; };
  el.addEventListener = (t, f) => { (el._listeners[t] = el._listeners[t] || []).push(f); };
  el.matches = (sel) => {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m) return false;
    if (!(m[1] in el.attrs)) return false;
    return m[2] === undefined || el.attrs[m[1]] === m[2];
  };
  el.querySelector = (sel) => {
    const find = (root) => {
      for (const c of root.children) {
        if (c.matches(sel)) return c;
        const d = find(c);
        if (d) return d;
      }
      return null;
    };
    const found = find(el);
    if (found) return found;
    if (!el._sub.has(sel)) { const s = makeEl('div'); s.parentNode = el; el._sub.set(sel, s); }
    return el._sub.get(sel);
  };
  el.querySelectorAll = () => [];
  return el;
}

/* Every node of the tree, in document order. */
function walk(node, out = []) {
  out.push(node);
  node.children.forEach((c) => walk(c, out));
  return out;
}
/* All the text the tree renders (textContent only — nothing here is HTML). */
function textOf(node) {
  return walk(node).map((n) => n._text).filter(Boolean).join(' | ');
}
const withAttr = (node, attr, value) =>
  walk(node).filter((n) => attr in n.attrs && (value === undefined || n.attrs[attr] === value));
const one = (node, attr, value) => {
  const hits = withAttr(node, attr, value);
  assert.equal(hits.length, 1, `expected exactly one [${attr}${value === undefined ? '' : `="${value}"`}]`);
  return hits[0];
};

function makeSandbox(fetchImpl) {
  const byId = new Map();
  const document = {
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, makeEl('div')); return byId.get(id); },
    createElement: (tag) => makeEl(tag),
    addEventListener: () => {},
    querySelectorAll: () => []
  };
  const sandbox = {
    document, console, localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} },
    location: { hash: '' }, history: { replaceState: () => {} },
    setInterval: () => 0, setTimeout: () => 0,
    fetch: fetchImpl || (() => Promise.reject(new Error('no network in tests')))
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(lib('bonus-eligibility.js'), ctx, { filename: 'bonus-eligibility.js' });
  vm.runInContext(pub('bonus-view.js'), ctx, { filename: 'bonus-view.js' });
  vm.runInContext(pub('occupancy-export.js'), ctx, { filename: 'occupancy-export.js' });
  vm.runInContext(pub('app.js'), ctx, { filename: 'app.js' });
  return { ctx, byId };
}

/* ── fixture: the `occupancySnapshots` payload, 17 Sep 2026 ─── */
const TODAY_EXPR = 'new Date(2026, 8, 17, 12, 0, 0)'; // 17 Sep 2026, local
/* Fields the snapshot rows may NOT contribute to the view. `capturedAt` is
 * part of the documented shape but is not rendered; the rest are the bonus
 * fields the frontend ignores everywhere (see docs/bonus-month-labelling.md). */
const SNAP_JUNK = {
  capturedAt: '2026-09-01T03:00:00Z',
  projectedBonus: 2577, lockedIn: true, qualifies: true, tier: 3, amount: 2577,
  quarterlyBonus: 5000, bonusAmount: 2577, paceAvgDaily: 18.3, note: 'סודי'
};
const snap = (month, houseId, o = {}) => ({
  month, houseId,
  treatmentDays: 441, daysInMonth: 31, avgDaily: 14.72, capacity: 20,
  occupancyPct: 73.58, manager: 'אורן',
  ...SNAP_JUNK, ...o
});
/* August + July for every house (Efroni under its BACKEND id `arfoni`),
 * May for Ramot only (so June/July/August have a missing Ramot-free month to
 * assert on), plus the rows that must never be shown. */
const ROWS = [
  snap('2026-08', 'ramot'),
  snap('2026-08', 'raanana', { capacity: 14, avgDaily: 11.2, occupancyPct: 80, treatmentDays: 347, manager: 'שחר' }),
  snap('2026-08', 'arfoni', { capacity: 13, avgDaily: 9.1, occupancyPct: 70, treatmentDays: 282, manager: 'חנן' }),
  snap('2026-08', 'rehab', { capacity: 13, avgDaily: 10.4, occupancyPct: 80, treatmentDays: 322, manager: 'רנטה' }),
  snap('2026-08', 'pardes', { capacity: 13, avgDaily: 8.6, occupancyPct: 66.2, treatmentDays: 267, manager: 'חן' }),
  snap('2026-07', 'ramot', { avgDaily: 19.2, occupancyPct: 96, treatmentDays: 560 }),
  snap('2026-05', 'ramot', { avgDaily: 18.4, occupancyPct: 92, treatmentDays: 540 }),
  // never shown:
  snap('2026-09', 'ramot', { avgDaily: 13, occupancyPct: 65 }),   // the RUNNING month
  snap('2026-10', 'ramot'),                                        // the future
  snap('2026-04', 'ramot'),                                        // before the May 2026 anchor
  snap('2026-08', 'zzz'),                                          // unknown house id
  snap('bad-month', 'ramot')                                       // malformed month
];

function feed({ rows = ROWS, fail = null, body = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url, 'http://x');
    calls.push(u.searchParams.get('action'));
    if (fail) throw new Error(fail);
    const payload = body || { ok: true, rows };
    return { status: 200, ok: true, text: async () => JSON.stringify(payload) };
  };
  return { calls, fetchImpl };
}

function setup(fetchImpl) {
  const s = makeSandbox(fetchImpl);
  vm.runInContext(`state.now = ${TODAY_EXPR}; state.overview = { month: '2026-09', houses: [] };`, s.ctx);
  return s;
}
const call = (ctx, fn, ...args) => vm.runInContext(fn, ctx)(...args);
const loaded = (ctx) => vm.runInContext(`state.occupancy = { status: 'ok', rows: ${JSON.stringify(ROWS)}, error: '' };`, ctx);
const FORBIDDEN = ['בתהליך', 'בדרך', 'חסרים', 'צפי'];

/* ── table model ──────────────────────────────────────────── */
test('table model: settled months only, newest first — the running and future months never appear', () => {
  const { ctx } = setup();
  const model = call(ctx, 'occupancyTable_', ROWS, {});
  assert.deepEqual([...model.months], ['2026-08', '2026-07', '2026-05'], 'newest first, no running/future/pre-anchor month');
  assert.ok(!model.months.includes('2026-09'), 'the running month is never settled');
  assert.ok(!model.months.includes('2026-04'), 'nothing before the May 2026 anchor');
});

test('table model: columns are the five houses from HOUSE_LABELS, and the backend id `arfoni` maps to `efroni`', () => {
  const { ctx } = setup();
  const model = call(ctx, 'occupancyTable_', ROWS, {});
  assert.deepEqual([...model.keys], ['raanana', 'ramot', 'efroni', 'rehab', 'pardes']);
  const aug = model.byMonth['2026-08'];
  assert.equal(aug.efroni.houseLabel, 'קיסריה עפרוני', 'arfoni → efroni, label from HOUSE_LABELS');
  assert.equal(aug.efroni.manager, 'חנן');
  assert.equal(aug.arfoni, undefined, 'the backend id must not become a column');
  assert.equal(aug.zzz, undefined, 'an unknown house id is dropped, not guessed');
  assert.deepEqual([...Object.keys(aug)].sort(), ['efroni', 'pardes', 'raanana', 'ramot', 'rehab']);
  assert.equal(call(ctx, 'houseKeyOf_', 'arfoni'), 'efroni');
  assert.equal(call(ctx, 'houseKeyOf_', 'zzz'), '');
});

test('table model: a house tab asks for its own column only', () => {
  const { ctx } = setup();
  const model = call(ctx, 'occupancyTable_', ROWS, { keys: ['ramot'] });
  assert.deepEqual([...model.keys], ['ramot']);
  assert.deepEqual([...Object.keys(model.byMonth['2026-08'])], ['ramot']);
});

test('table model: figures come from the snapshot row, capacity falls back to HOUSE_LABELS', () => {
  const { ctx } = setup();
  const row = call(ctx, 'occupancyTable_', ROWS, {}).byMonth['2026-08'].ramot;
  assert.equal(row.treatmentDays, 441);
  assert.equal(row.daysInMonth, 31);
  assert.equal(row.avgDaily, 14.72);
  assert.equal(row.capacity, 20);
  assert.equal(row.occupancyPct, 73.58);
  const noCap = call(ctx, 'occupancyRow_', { month: '2026-08', houseId: 'pardes', avgDaily: 6.5, capacity: 0 });
  assert.equal(noCap.capacity, 13, 'HOUSE_LABELS capacity is the fallback');
  assert.equal(Math.round(noCap.occupancyPct), 50, 'pct derived from avgDaily / capacity when the feed has none');
  assert.equal(call(ctx, 'occupancyRow_', { month: '2026-08', houseId: 'ramot' }), null,
    'a row with no occupancy figure at all is missing data, not 0%');
});

/* ── render ───────────────────────────────────────────────── */
test('overview card: title, one row per settled month labelled (סופי), one column per house', () => {
  const { ctx, byId } = setup();
  loaded(ctx);
  call(ctx, 'renderOccupancyEverywhere_');
  const host = byId.get('occupancyCard');
  const txt = textOf(host);

  assert.ok(txt.includes('תפוסה חודשית (סופי)'), `card title missing: ${txt}`);
  assert.deepEqual(withAttr(host, 'data-occupancy-house').map((n) => n._text),
    ['רעננה אשר', 'רמות השבים', 'קיסריה עפרוני', 'קיסריה ריהאב', 'רעננה הפרדס'],
    'column headers come from HOUSE_LABELS only');
  assert.deepEqual(withAttr(host, 'data-occupancy-row').map((n) => n.attrs['data-occupancy-row']),
    ['2026-08', '2026-07', '2026-05'], 'months newest first');
  assert.ok(txt.includes('אוגוסט 2026 — סופי'), 'each row is labelled סופי');
  assert.ok(txt.includes('מאי 2026 — סופי'));
  for (const w of FORBIDDEN) assert.ok(!txt.includes(w), `a settled view must never say "${w}"`);
  assert.ok(!txt.includes('ספטמבר 2026'), 'the running month is not in the table');

  const cell = one(host, 'data-occupancy-cell', '2026-08:ramot');
  assert.equal(textOf(cell), '73.6% | 14.7/20', 'occupancy % with avgDaily/capacity below');
  assert.equal(textOf(one(host, 'data-occupancy-cell', '2026-08:efroni')), '70% | 9.1/13');
});

test('overview card: a month/house with no snapshot says "אין נתונים" — never 0', () => {
  const { ctx, byId } = setup();
  loaded(ctx);
  call(ctx, 'renderOccupancyEverywhere_');
  const host = byId.get('occupancyCard');
  const missing = one(host, 'data-occupancy-cell', '2026-07:pardes');
  assert.equal(textOf(missing), 'אין נתונים');
  assert.equal(missing.attrs['data-occupancy-missing'], '1');
  assert.doesNotMatch(textOf(missing), /\d/, 'a missing cell must carry no figure at all');
  // Every cell of the table is either a figure or the explicit note.
  withAttr(host, 'data-occupancy-cell').forEach((td) => {
    const t = textOf(td);
    assert.ok(t === 'אין נתונים' || /%/.test(t), `unexpected cell content: ${t}`);
    assert.ok(t !== '0%', 'a missing month must not render as 0%');
  });
});

test('house tab card: that house only', () => {
  const { ctx } = setup();
  loaded(ctx);
  const host = call(ctx, 'document.getElementById', 'panel-ramot'); // a plain host element
  call(ctx, 'renderOccupancyCard_', host, ['ramot']);
  assert.deepEqual(withAttr(host, 'data-occupancy-house').map((n) => n._text), ['רמות השבים']);
  assert.deepEqual(withAttr(host, 'data-occupancy-cell').map((n) => n.attrs['data-occupancy-cell']),
    ['2026-08:ramot', '2026-07:ramot', '2026-05:ramot']);
  assert.ok(textOf(host).includes('תפוסה חודשית (סופי)'));
});

test('no snapshot field outside the documented columns reaches the DOM', () => {
  const { ctx, byId } = setup();
  loaded(ctx);
  call(ctx, 'renderOccupancyEverywhere_');
  const txt = textOf(byId.get('occupancyCard'));
  for (const junk of ['2577', '2,577', '5000', '5,000', 'סודי', '2026-09-01', 'true', '18.3']) {
    assert.ok(!txt.includes(junk), `"${junk}" (a backend field) reached the DOM`);
  }
});

/* ── fetch + error state ──────────────────────────────────── */
test('the snapshots are fetched through the existing proxy path, once per page', async () => {
  const { calls, fetchImpl } = feed();
  const { ctx, byId } = setup(fetchImpl);
  await call(ctx, 'ensureOccupancy_');
  assert.deepEqual(calls, ['occupancySnapshots'], 'one call, via /api/sheets?action=occupancySnapshots');
  assert.equal(vm.runInContext('state.occupancy.status', ctx), 'ok');
  await call(ctx, 'ensureOccupancy_');
  assert.equal(calls.length, 1, 'settled months are fetched once — a re-render never refetches');
  await call(ctx, 'ensureOccupancy_', { force: true });
  assert.equal(calls.length, 2, 'the retry button forces a refetch');
  assert.ok(textOf(byId.get('occupancyCard')).includes('אוגוסט 2026 — סופי'));
});

test('a failed fetch → explicit error state + retry button, no computed fallback', async () => {
  const { calls, fetchImpl } = feed({ fail: 'upstream down' });
  const { ctx, byId } = setup(fetchImpl);
  await call(ctx, 'ensureOccupancy_');
  const host = byId.get('occupancyCard');
  const err = one(host, 'data-occupancy-state', 'error');
  assert.match(err._text, /שגיאה בטעינת תפוסה חודשית: upstream down/);
  assert.equal(withAttr(host, 'data-occupancy-table').length, 0, 'no table on error');
  assert.equal(withAttr(host, 'data-occupancy-export').length, 0, 'nothing to export on error');
  const txt = textOf(host);
  assert.doesNotMatch(txt, /%/, 'no percentage may be shown on error');
  assert.ok(!txt.includes('אין נתונים'), 'an error is not "no data"');

  // The retry button re-runs the fetch and renders the table.
  const retry = one(host, 'data-occupancy-retry');
  vm.runInContext('state.occupancy.rows = [];', ctx);
  retry._listeners.click[0]({ preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2, 'retry refetches');
});

test('an unknown action / a payload without rows → the same explicit error state', async () => {
  for (const body of [{ ok: false, error: 'unknown action' }, { ok: true }, { ok: true, rows: 'nope' }, { rows: null }]) {
    const { fetchImpl } = feed({ body });
    const { ctx, byId } = setup(fetchImpl);
    await call(ctx, 'ensureOccupancy_');
    assert.equal(vm.runInContext('state.occupancy.status', ctx), 'error', `body ${JSON.stringify(body)}`);
    const host = byId.get('occupancyCard');
    assert.equal(withAttr(host, 'data-occupancy-state', 'error').length, 1);
    assert.equal(withAttr(host, 'data-occupancy-table').length, 0);
  }
});

test('the loading state is explicit, and an empty (but valid) payload says "אין נתונים"', async () => {
  const { fetchImpl } = feed({ rows: [] });
  const { ctx, byId } = setup(fetchImpl);
  call(ctx, 'renderOccupancyEverywhere_');
  const host = byId.get('occupancyCard');
  assert.equal(withAttr(host, 'data-occupancy-state', 'loading').length, 1, 'idle renders the loading note, never a table');
  await call(ctx, 'ensureOccupancy_');
  assert.equal(vm.runInContext('state.occupancy.status', ctx), 'ok');
  assert.equal(withAttr(host, 'data-occupancy-state', 'empty')[0]._text, 'אין נתונים');
  assert.equal(withAttr(host, 'data-occupancy-export').length, 0, 'no export button with nothing to export');
});

test('the occupancy code never touches the bonus state slices', async () => {
  const { fetchImpl } = feed();
  const { ctx } = setup(fetchImpl);
  const slices = 'JSON.stringify({ o: state.overview, m: state.monthOverviews, p: state.prevOverview, c: state.chartsByMonth, d: state.details, q: state.quarterWindow, b: state.bonusMonth, h: state.bonusHistory, hm: state.historyMonth })';
  const before = vm.runInContext(slices, ctx);
  await call(ctx, 'ensureOccupancy_');
  call(ctx, 'renderOccupancyEverywhere_');
  call(ctx, 'exportOccupancyCsv_', vm.runInContext('HOUSE_KEYS', ctx));
  assert.equal(vm.runInContext(slices, ctx), before, 'the occupancy view must not write any bonus state');
});

/* ── CSV export ───────────────────────────────────────────── */
test('CSV export: BOM, Hebrew headers, one line per rendered cell, named occupancy-<from>_to_<to>.csv', () => {
  const { ctx } = setup();
  loaded(ctx);
  const out = call(ctx, 'exportOccupancyCsv_', vm.runInContext('HOUSE_KEYS', ctx));
  assert.equal(out.name, 'occupancy-2026-05_to_2026-08.csv', 'oldest → newest month in the file name');
  assert.equal(out.csv.charCodeAt(0), 0xfeff, 'UTF-8 BOM');
  const lines = out.csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'חודש,בית,מנהל/ת,ימי טיפול,ימים בחודש,ממוצע יומי,קיבולת,תפוסה %');
  assert.equal(lines.length, 1 + 7, 'header + the seven months×houses that have data');
  assert.equal(lines[1], '2026-08,רעננה אשר,שחר,347,31,11.2,14,80', 'column order follows the table');
  assert.ok(lines.some((l) => l.startsWith('2026-08,קיסריה עפרוני,חנן,')), 'arfoni exported as עפרוני');
  assert.ok(!out.csv.includes('arfoni'), 'the backend id never reaches the file');
  assert.ok(!lines.some((l) => l.startsWith('2026-09')), 'the running month is not exported');
  assert.ok(!lines.some((l) => l.startsWith('2026-04')), 'nothing before the anchor is exported');
  for (const junk of ['2577', '5000', 'סודי', '2026-09-01', 'capturedAt', 'true']) {
    assert.ok(!out.csv.includes(junk), `"${junk}" reached the CSV`);
  }
});

test('CSV export: a house tab exports its own house only; nothing to export → null', () => {
  const { ctx } = setup();
  loaded(ctx);
  const out = call(ctx, 'exportOccupancyCsv_', ['ramot']);
  assert.equal(out.name, 'occupancy-2026-05_to_2026-08.csv');
  const lines = out.csv.replace(/^﻿/, '').trim().split('\r\n').slice(1);
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.includes('רמות השבים')));
  vm.runInContext("state.occupancy = { status: 'ok', rows: [], error: '' };", ctx);
  assert.equal(call(ctx, 'exportOccupancyCsv_', vm.runInContext('HOUSE_KEYS', ctx)), null);
});

test('CSV export: a spreadsheet formula in a feed string is neutralised end to end', () => {
  const { ctx } = setup();
  vm.runInContext(`state.occupancy = { status: 'ok', rows: ${JSON.stringify([
    snap('2026-08', 'ramot', { manager: '=cmd|calc!A1' }),
    snap('2026-07', 'ramot', { manager: '@SUM(1,1)' })
  ])}, error: '' };`, ctx);
  const csv = call(ctx, 'exportOccupancyCsv_', ['ramot']).csv;
  for (const line of csv.replace(/^﻿/, '').trim().split('\r\n').slice(1)) {
    for (const field of line.split(',')) {
      assert.ok(!/^"?[=+@\t\r]/.test(field), `a field still opens as a formula: ${field}`);
    }
  }
  assert.ok(csv.includes("\"'=cmd|calc!A1\"") || csv.includes("'=cmd|calc!A1"), 'the formula is kept as text');
});

/* ── static guards ────────────────────────────────────────── */
test('the occupancy view renders feed data with textContent only', () => {
  const js = pub('app.js');
  const start = js.indexOf('Monthly occupancy — permanent');
  const end = js.indexOf('function renderNextTierCard');
  assert.ok(start > 0 && end > start, 'the occupancy section must exist');
  const section = js.slice(start, end);
  const writes = [...section.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(writes, ["''"], 'the only innerHTML write may be clearing the host');
  assert.ok(!section.includes('insertAdjacentHTML'), 'no HTML injection path');
  assert.match(section, /node\.textContent = String\(text\)/, 'values go in as textContent');
});

test('index.html and the service worker ship occupancy-export.js', () => {
  const html = pub('index.html');
  const order = ['/lib/bonus-eligibility.js', '/bonus-view.js', '/occupancy-export.js', '/app.js']
    .map((s) => html.indexOf(`<script src="${s}">`));
  assert.ok(order.every((i) => i >= 0), `a script tag is missing: ${order}`);
  assert.ok(order[1] < order[2] && order[2] < order[3], 'occupancy-export.js loads after bonus-view.js, before app.js');
  assert.match(html, /<div class="card occupancy-card" id="occupancyCard"><\/div>/, 'overview host');
  const tpl = /<template id="houseDetailTpl">[\s\S]*?<\/template>/.exec(html)[0];
  assert.match(tpl, /data-occupancy-card/, 'house-tab host');
  const sw = pub('sw.js');
  assert.match(sw, /'\/occupancy-export\.js'/, 'the SW shell must include the new module');
  const m = sw.match(/const CACHE = 'ezone-managers-v(\d+)'/);
  assert.ok(m && Number(m[1]) >= 13, 'SW cache must be bumped to v13+ (monthly-occupancy view)');
});
