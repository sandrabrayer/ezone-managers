'use strict';
/* DOM-level guards for public/app.js — the file is loaded in a vm sandbox
 * with a tiny fake DOM so the ACTUAL render paths (house card, house detail)
 * can be asserted on: no backend bonus figure reaches the DOM, settled and
 * running months are labelled and separated, days-so-far is one number
 * everywhere, and a tier is never shown as achieved mid-month. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const lib = (f) => fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8');

/* ── minimal fake DOM ─────────────────────────────────────── */
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
  el.remove = () => { if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((x) => x !== el); };
  el.addEventListener = (t, f) => { (el._listeners[t] = el._listeners[t] || []).push(f); };
  el.matches = (sel) => {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (!m) return false;
    if (!(m[1] in el.attrs)) return false;
    return m[2] === undefined || el.attrs[m[1]] === m[2];
  };
  const find = (root, sel) => {
    for (const c of root.children) {
      if (c.matches(sel)) return c;
      const d = find(c, sel);
      if (d) return d;
    }
    return null;
  };
  // Elements are created lazily per selector (the detail template is never
  // parsed here); anything appended later with a matching data-attribute is
  // found first.
  el.querySelector = (sel) => {
    const found = find(el, sel);
    if (found) return found;
    if (!el._sub.has(sel)) { const s = makeEl('div'); s.parentNode = el; el._sub.set(sel, s); }
    return el._sub.get(sel);
  };
  el.querySelectorAll = () => [];
  return el;
}

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
  vm.runInContext(pub('app.js'), ctx, { filename: 'app.js' });
  return { ctx, byId };
}

/* ── fixture: Ramot HaShavim, 8 Sep 2026 (the screenshots) ── */
const TODAY_EXPR = 'new Date(2026, 8, 8, 12, 0, 0)'; // 8 Sep 2026, local
const CHART = [
  ...[12, 12, 13, 13, 13, 13, 13, 13].map((count, i) => ({ date: `2026-09-0${i + 1}`, count })),
  // front-dated future days — must be ignored for "so far"
  { date: '2026-09-09', count: 20 }, { date: '2026-09-10', count: 20 }
];
// The backend figure that showed up under the manager name was 2500 — which
// is also tier 2's real price, so the fixture uses a value that can only come
// from the feed (2577) and the card test additionally rules out 2500.
const STRAY = 2577;
const BACKEND_JUNK = {
  projectedBonus: STRAY, lockedIn: true, qualifies: true, bep: STRAY, type: STRAY,
  bonusAmount: STRAY, monthlyBonus: STRAY, quarterlyBonus: 5000, paceAvgDaily: 18.3,
  projectedTier: 3, securedTier: 3
};
const RAMOT_OVERVIEW = {
  key: 'ramot', name: 'רמות השבים', manager: 'אורן', patientsNow: 13, capacity: 20,
  avgDaily: 18.3, treatmentDays: 549,
  currentMonth: { month: '2026-09', treatmentDaysSoFar: 366, daysInMonth: 30, ...BACKEND_JUNK },
  prevMonth: { month: '2026-08', avgDaily: 14.7, treatmentDays: 441, ...BACKEND_JUNK },
  bonus: { treatmentNights: 549, continuity: {}, ...BACKEND_JUNK },
  ...BACKEND_JUNK
};
const RAMOT_DETAIL = { ...RAMOT_OVERVIEW, month: '2026-09', dailyChart: CHART, activity: [] };
const STATE = {
  overview: { month: '2026-09', houses: [RAMOT_OVERVIEW], totals: { activePatients: 13 } },
  monthOverviews: { '2026-08': { ramot: { key: 'ramot', avgDaily: 14.7, treatmentDays: 441, ...BACKEND_JUNK } } },
  prevOverview: { month: '2026-08', byKey: { ramot: { key: 'ramot', avgDaily: 14.7, treatmentDays: 441, ...BACKEND_JUNK } } },
  quarterWindow: ['2026-08', '2026-09', '2026-10']
};

function setup(fetchImpl) {
  const s = makeSandbox(fetchImpl);
  vm.runInContext(`state.now = ${TODAY_EXPR}; Object.assign(state, ${JSON.stringify(STATE)}); state.housesById.ramot = state.overview.houses[0];`, s.ctx);
  return s;
}
const call = (ctx, fn, ...args) => vm.runInContext(fn, ctx)(...args);
const FORBIDDEN = ['בדרך', 'בתהליך', 'חסרים'];
const block = (html, name) => {
  const start = html.indexOf(`data-month-block="${name}"`);
  assert.ok(start >= 0, `card must contain the ${name} month block`);
  const rest = html.slice(start);
  const next = rest.slice(1).search(/data-month-block="|<div class="hc-stats">/);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
};

/* ── house card ───────────────────────────────────────────── */
test('house card: no backend bonus figure ("2500") reaches the DOM', () => {
  const { ctx } = setup();
  const card = call(ctx, 'buildHouseCard', RAMOT_OVERVIEW);
  const html = card.innerHTML;
  assert.doesNotMatch(html, /2500|2,500|2 500/, 'stray backend amount rendered on the card');
  assert.doesNotMatch(html, /"hc-type">\s*\d/, 'a number under the manager name');
  assert.match(html, /מנהל\/ת: אורן/);
  assert.match(html, /"hc-type">בית מאזן</, 'type comes from the hardcoded roster');
});

test('house card: settled block is labelled "בונוס אוגוסט 2026 — סופי (לתשלום)" with a final-state result', () => {
  const { ctx } = setup();
  const html = call(ctx, 'buildHouseCard', RAMOT_OVERVIEW).innerHTML;
  const settled = block(html, 'settled');
  assert.match(settled, /בונוס אוגוסט 2026 — סופי \(לתשלום\)/);
  assert.match(settled, /לא זכאי · המכסה לא הושלמה \(441\/510\)/);
  assert.match(settled, /0 ₪/);
  for (const w of FORBIDDEN) assert.ok(!settled.includes(w), `settled block must not say "${w}"`);
});

test('house card: running block is labelled "ספטמבר 2026 — חודש נוכחי (בתהליך)" with actual + projection separated', () => {
  const { ctx } = setup();
  const html = call(ctx, 'buildHouseCard', RAMOT_OVERVIEW).innerHTML;
  const cur = block(html, 'current');
  assert.match(cur, /ספטמבר 2026 — חודש נוכחי \(בתהליך\)/);
  assert.match(cur, /data-current-actual>ימי טיפול עד כה: <b>160\/510 ימי טיפול<\/b>/,
    'without the daily chart the feed figure (366) is capped at 8 days × 20 beds');
  assert.match(cur, /data-current-projection>צפי לסוף החודש: 600 ימי טיפול/);
  assert.doesNotMatch(cur, /data-current-actual>[^<]*600/, 'projection must never be shown as actual');
});

test('house card: tier is never a status badge mid-month — "מדרגה הבאה" line, no tier-pill', () => {
  const { ctx } = setup();
  const html = call(ctx, 'buildHouseCard', RAMOT_OVERVIEW).innerHTML;
  assert.doesNotMatch(html, /tier-pill/, 'no achieved-tier pill while nothing is secured');
  assert.doesNotMatch(html, /מדרגה 3(?![ (]*\d)/, 'no "מדרגה 3" as a status');
  assert.match(html, /data-tier-line>מדרגה הבאה: 3 \(20 מטופלים\/יום\) · ממוצע נוכחי 20</);
  assert.match(html, /progress-badge">⏳ ספטמבר 2026 בתהליך</);
});

test('house card: a SECURED tier shows the pill and the month it is secured for', () => {
  const { ctx } = setup();
  // Day 28: chart-derived 28 × 19 = 532 ≥ 510, avg 19 → tier 2 locked.
  const chart = Array.from({ length: 28 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, count: 19 }));
  vm.runInContext('state.now = new Date(2026, 8, 28, 12)', ctx);
  const html = call(ctx, 'buildHouseCard', { ...RAMOT_OVERVIEW, dailyChart: chart }).innerHTML;
  assert.match(html, /tier-pill t2">מדרגה 2 ✓</);
  assert.match(html, /qualify-badge">✓ מובטח · ספטמבר 2026</);
  assert.match(html, /data-current-actual>ימי טיפול עד כה: <b>532\/510 ימי טיפול<\/b>/);
});

/* ── house detail ─────────────────────────────────────────── */
function renderDetail() {
  const s = setup();
  vm.runInContext(`state.details.ramot = ${JSON.stringify(RAMOT_DETAIL)}`, s.ctx);
  call(s.ctx, 'renderHouseDetail', 'ramot', vm.runInContext('state.details.ramot', s.ctx));
  return { ...s, panel: s.byId.get('panel-ramot') };
}

test('house detail: days-so-far is ONE number across KPI, hero, progress bar and house card (102)', () => {
  const { ctx, panel } = renderDetail();
  const kpi = panel.querySelector('[data-stat="treatmentDays"]').textContent;
  const barSoFar = panel.querySelector('[data-stat="daysSoFar"]').textContent;
  const hero = panel.querySelector('[data-status-banner]').innerHTML;
  const heroDays = /(\d+)\/510 ימי טיפול/.exec(/data-hero-current>([\s\S]*?)<\/div>/.exec(hero)[1])[1];
  const fill = panel.querySelector('[data-bep-fill]').style.width;
  // The overview card re-renders from the same detail (state.details) once loaded.
  const card = call(ctx, 'buildHouseCard', RAMOT_OVERVIEW).innerHTML;
  const cardDays = /data-card-days>(\d+) \/ 510</.exec(card)[1];
  const curBlock = /data-current-actual>ימי טיפול עד כה: <b>(\d+)\/510/.exec(card)[1];

  assert.equal(kpi, '102');
  assert.equal(barSoFar, '102');
  assert.equal(heroDays, '102');
  assert.equal(cardDays, '102');
  assert.equal(curBlock, '102');
  assert.equal(fill, `${Math.min(100, (102 / Math.max(102, 510, 383)) * 100)}%`);
  assert.equal(panel.querySelector('[data-stat="daysProjection"]').textContent, '383');
});

test('house detail: hero headline is the SETTLED month (no month-less "בדרך" wording); running month is secondary', () => {
  const { panel } = renderDetail();
  const hero = panel.querySelector('[data-status-banner]').innerHTML;
  const headline = /data-hero-headline>([^<]*)</.exec(hero)[1];
  assert.equal(headline, 'אוגוסט 2026: לא זכאי · המכסה לא הושלמה (441/510)');
  for (const w of FORBIDDEN) assert.ok(!headline.includes(w), `settled headline must not say "${w}"`);
  const secondary = /data-hero-current>([^<]*)</.exec(hero)[1];
  assert.match(secondary, /ספטמבר 2026 — חודש נוכחי \(בתהליך\) · 102\/510 ימי טיפול · צפי לסוף החודש: 383 ימי טיפול/);
  assert.match(secondary, /מדרגה הבאה: 1 \(17 מטופלים\/יום\) · ממוצע נוכחי 12\.8/);
  assert.doesNotMatch(hero, /בדרך למדרגה/);
  assert.doesNotMatch(hero, /2577|2,577|2500|2,500/);
});

test('house detail: month split shows both labelled blocks; KPI labels name the month', () => {
  const { panel } = renderDetail();
  const split = panel.querySelector('[data-month-split]').innerHTML;
  assert.match(split, /בונוס אוגוסט 2026 — סופי \(לתשלום\)/);
  assert.match(split, /ספטמבר 2026 — חודש נוכחי \(בתהליך\)/);
  assert.match(split, /ימי טיפול עד כה: <b>102\/510 ימי טיפול<\/b>/);
  assert.match(split, /צפי לסוף החודש: 383 ימי טיפול/);
  assert.equal(panel.querySelector('[data-stat-label="treatmentDays"]').textContent, 'ימי טיפול עד כה — ספטמבר 2026 (בתהליך)');
  assert.equal(panel.querySelector('[data-stat-label="bonus"]').textContent, 'מובטח עד כה — ספטמבר 2026 (בתהליך)');
  assert.equal(panel.querySelector('[data-stat="bonus"]').textContent, '0 ₪');
});

test('house detail: tier track / next-tier card never mark a tier reached mid-month', () => {
  const { panel } = renderDetail();
  assert.equal(panel.querySelector('[data-tier-current]').textContent, 'מדרגה הבאה: 1 (17 מטופלים/יום) · ממוצע נוכחי 12.8');
  const status = panel.querySelector('[data-next-tier-status]').textContent;
  assert.match(status, /^⏳ ספטמבר 2026 — חודש נוכחי \(בתהליך\) · 102\/510 ימי טיפול · מדרגה הבאה: 1/);
  assert.doesNotMatch(status, /בדרך למדרגה/);
});

test('house detail: no backend bonus figure reaches any rendered text', () => {
  const { panel, byId } = renderDetail();
  const texts = [];
  const walk = (el) => {
    texts.push(el.innerHTML, el.textContent);
    el.children.forEach(walk);
    el._sub.forEach(walk);
  };
  walk(panel);
  byId.forEach(walk);
  const all = texts.join('\n');
  assert.doesNotMatch(all, /2577|2,577/, 'stray backend amount rendered');
  assert.doesNotMatch(all, /projectedBonus|lockedIn|quarterlyBonus|paceAvgDaily/, 'no raw backend key name rendered');
  assert.doesNotMatch(all, /18[.,]3/, 'backend paceAvgDaily / full-month avgDaily must not drive the running month');
});

/* ── overview card = detail tab (shared per-month chart cache) ── */
test('overview card and detail tab show the SAME days-so-far once the chart is cached (102, not the capped 160)', () => {
  const { ctx, byId } = setup();
  // What loadOverview does per house: cache the detail payload for the month.
  vm.runInContext(`cacheHouseDetail_('ramot', ${JSON.stringify(RAMOT_DETAIL)}, '2026-09')`, ctx);
  const card = call(ctx, 'buildHouseCard', RAMOT_OVERVIEW).innerHTML; // overview payload: NO dailyChart
  const cardDays = /data-card-days>(\d+) \/ 510</.exec(card)[1];
  const cardBlock = /data-current-actual>ימי טיפול עד כה: <b>(\d+)\/510/.exec(card)[1];
  call(ctx, 'renderHouseDetail', 'ramot', vm.runInContext('state.details.ramot', ctx));
  const panel = byId.get('panel-ramot');
  const tabKpi = panel.querySelector('[data-stat="treatmentDays"]').textContent;
  const tabBar = panel.querySelector('[data-stat="daysSoFar"]').textContent;
  assert.equal(cardDays, '102');
  assert.equal(cardBlock, '102');
  assert.equal(tabKpi, cardDays, 'overview card must equal the detail tab KPI');
  assert.equal(tabBar, cardDays, 'overview card must equal the detail tab progress bar');
});

test('cached chart is per MONTH: a chart for another month is never used for the running month', () => {
  const { ctx } = setup();
  vm.runInContext(`cacheHouseDetail_('ramot', ${JSON.stringify({ ...RAMOT_DETAIL, month: '2026-08' })}, '2026-08')`, ctx);
  const card = call(ctx, 'buildHouseCard', RAMOT_OVERVIEW).innerHTML;
  assert.equal(/data-card-days>(\d+) \/ 510</.exec(card)[1], '160', 'falls back to the capped feed figure');
});

function stubFeed() {
  const calls = [];
  const HOUSES = ['raanana', 'ramot', 'efroni', 'rehab', 'pardes'];
  const overviewHouse = (key) => ({ ...RAMOT_OVERVIEW, key, capacity: key === 'ramot' ? 20 : 13 });
  const fetchImpl = async (url) => {
    const u = new URL(url, 'http://x');
    const action = u.searchParams.get('action'), month = u.searchParams.get('month'), house = u.searchParams.get('house');
    calls.push({ action, month, house });
    let body;
    if (action === 'managersOverview' && !month) body = { ok: true, month: '2026-09', houses: HOUSES.map(overviewHouse), totals: { activePatients: 57 } };
    else if (action === 'managersOverview') body = { ok: true, month, houses: HOUSES.map((key) => ({ key, avgDaily: 14.7, treatmentDays: 441 })) };
    else if (action === 'managersHouse') body = { ok: true, ...overviewHouse(house), month: '2026-09', dailyChart: CHART, activity: [] };
    else body = { ok: false, error: 'unknown' };
    return { status: 200, ok: true, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

test('loadOverview fetches every house chart ONCE; the 60-second refresh reuses the per-month cache; cards show the chart figure', async () => {
  const { calls, fetchImpl } = stubFeed();
  const { ctx, byId } = setup(fetchImpl);
  vm.runInContext('state.overview = null; state.prevOverview = null; state.monthOverviews = {}; state.chartsByMonth = {}; state.details = {};', ctx);
  const loadOverview = vm.runInContext('loadOverview', ctx);

  await loadOverview();
  const houseCalls = () => calls.filter((c) => c.action === 'managersHouse').map((c) => c.house).sort();
  assert.deepEqual(houseCalls(), ['efroni', 'pardes', 'raanana', 'ramot', 'rehab'], 'one chart request per house on first load');
  const cards = byId.get('houseGrid').children;
  assert.equal(cards.length, 5);
  const ramotCard = cards.find((c) => c.getAttribute('data-house-card') === 'ramot');
  assert.equal(/data-card-days>(\d+) \/ 510</.exec(ramotCard.innerHTML)[1], '102',
    'card uses the chart-based days-so-far without any tab having been opened');
  for (const c of cards) assert.match(c.innerHTML, /data-card-days>102 \/ (510|300)</, 'every card is chart-based');

  const before = calls.length;
  await loadOverview(); // the 60-second refresh
  const after = calls.slice(before);
  assert.equal(after.filter((c) => c.action === 'managersHouse').length, 0, 'refresh must not refetch cached charts');
  assert.ok(after.some((c) => c.action === 'managersOverview' && !c.month), 'refresh still reloads the overview');
  const cards2 = byId.get('houseGrid').children;
  assert.equal(/data-card-days>(\d+) \/ 510</.exec(cards2.find((c) => c.getAttribute('data-house-card') === 'ramot').innerHTML)[1], '102');

  // Detail tab after the refresh reads the very same cached payload.
  const renderHouseDetail = vm.runInContext('renderHouseDetail', ctx);
  renderHouseDetail('ramot', vm.runInContext('state.details.ramot', ctx));
  assert.equal(byId.get('panel-ramot').querySelector('[data-stat="treatmentDays"]').textContent, '102');
});

test('a failed chart fetch leaves the house uncached so the next refresh retries it', async () => {
  const { calls, fetchImpl } = stubFeed();
  let failRamot = true;
  const flaky = async (url) => {
    if (failRamot && /managersHouse/.test(url) && /house=ramot/.test(url)) { calls.push({ action: 'managersHouse', house: 'ramot', failed: true }); throw new Error('boom'); }
    return fetchImpl(url);
  };
  const { ctx } = setup(flaky);
  vm.runInContext('state.overview = null; state.prevOverview = null; state.monthOverviews = {}; state.chartsByMonth = {}; state.details = {};', ctx);
  const loadOverview = vm.runInContext('loadOverview', ctx);
  await loadOverview();
  assert.equal(vm.runInContext("Object.keys(state.chartsByMonth['2026-09']).sort().join(',')", ctx), 'efroni,pardes,raanana,rehab');
  failRamot = false;
  await loadOverview();
  assert.equal(calls.filter((c) => c.action === 'managersHouse' && c.house === 'ramot').length, 2, 'ramot retried exactly once');
  assert.equal(calls.filter((c) => c.action === 'managersHouse' && c.house !== 'ramot').length, 4, 'the other houses were not refetched');
  assert.ok(vm.runInContext("Array.isArray(state.chartsByMonth['2026-09'].ramot)", ctx));
});

/* ── static guards ────────────────────────────────────────── */
test('index.html loads bonus-view.js after bonus-eligibility.js and before app.js; SW caches it; SW cache is v7+', () => {
  const html = pub('index.html');
  const order = ['/lib/bonus-eligibility.js', '/bonus-view.js', '/app.js'].map((s) => html.indexOf(`<script src="${s}">`));
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `script order wrong: ${order}`);
  const sw = pub('sw.js');
  assert.match(sw, /'\/bonus-view\.js'/, 'SW shell must include /bonus-view.js');
  const m = sw.match(/const CACHE = 'ezone-managers-v(\d+)'/);
  assert.ok(m && Number(m[1]) >= 9, 'SW cache must be bumped to v9+ (occupancy-history picker shell)');
});

test('app.js never renders the feed\'s `type` field and takes labels through safeLabel', () => {
  const js = pub('app.js');
  assert.doesNotMatch(js, /\bh\.type\b/, 'h.type must not be read — the roster type is the only source');
  assert.doesNotMatch(js, /\$\{h\.manager\}/, 'manager must go through BonusView.safeLabel');
  assert.match(js, /BV\.safeLabel\(h\.manager\)/);
});

/* ── occupancy history picker (house detail) ─────────────── */
/* Everything the bonus code renders for the house, captured as strings so a
 * before/after comparison proves the picker changes none of it. */
function bonusSnapshot(ctx, panel) {
  const q = (sel) => panel.querySelector(sel);
  return {
    hero: q('[data-status-banner]').innerHTML,
    kpiDaysLabel: q('[data-stat-label="treatmentDays"]').textContent,
    kpiDays: q('[data-stat="treatmentDays"]').textContent,
    kpiBonusLabel: q('[data-stat-label="bonus"]').textContent,
    kpiBonus: q('[data-stat="bonus"]').textContent,
    monthSplit: q('[data-month-split]').innerHTML,
    chartTitle: q('[data-chart-title]').textContent,
    barSoFar: q('[data-stat="daysSoFar"]').textContent,
    barProjection: q('[data-stat="daysProjection"]').textContent,
    currentSpark: q('[data-daily-spark]').innerHTML,
    nextTier: q('[data-next-tier-status]').textContent,
    tierCurrent: q('[data-tier-current]').textContent,
    breakdownTotal: q('[data-stat="bonusTotal"]').textContent,
    card: call(ctx, 'buildHouseCard', RAMOT_OVERVIEW).innerHTML,
    state: vm.runInContext('JSON.stringify({ o: state.overview, m: state.monthOverviews, p: state.prevOverview, c: state.chartsByMonth, d: state.details, q: state.quarterWindow })', ctx)
  };
}
// 31-day chart for a finished month (July / August 2026 both have 31 days).
const chartFor = (ym) => Array.from({ length: 31 }, (_, i) => ({ date: `${ym}-${String(i + 1).padStart(2, '0')}`, count: 14 + (i % 2) }));

/* Stub feed for the picker. `houseMonth`: what managersHouse&month=… answers
 * with — 'requested' echoes the asked month, otherwise a backend that ignores
 * `month` and returns the CURRENT (September) payload. */
function historyFeed({ chartInOverview = false, houseMonth = '2026-09', failMonth = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url, 'http://x');
    const action = u.searchParams.get('action'), month = u.searchParams.get('month'), house = u.searchParams.get('house');
    calls.push({ action, month, house });
    if (failMonth && month === failMonth) throw new Error('upstream down');
    let body;
    if (action === 'managersOverview' && month) {
      body = { ok: true, month, houses: [{ key: 'ramot', avgDaily: 14.7, treatmentDays: 441, ...BACKEND_JUNK, ...(chartInOverview ? { dailyChart: chartFor(month) } : {}) }] };
    } else if (action === 'managersHouse') {
      const m = houseMonth === 'requested' ? month : houseMonth;
      body = { ok: true, ...RAMOT_DETAIL, month: m, dailyChart: m === '2026-09' ? CHART : chartFor(m) };
    } else body = { ok: false, error: 'unexpected call' };
    return { status: 200, ok: true, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

function renderDetailWith(fetchImpl) {
  const s = setup(fetchImpl);
  vm.runInContext(`state.details.ramot = ${JSON.stringify(RAMOT_DETAIL)}`, s.ctx);
  call(s.ctx, 'renderHouseDetail', 'ramot', vm.runInContext('state.details.ramot', s.ctx));
  return { ...s, panel: s.byId.get('panel-ramot') };
}

test('history picker: defaults to the current month, lists back to the May 2026 anchor, wired once', () => {
  const { ctx, panel } = renderDetail();
  const sel = panel.querySelector('[data-history-month]');
  const values = [...sel.innerHTML.matchAll(/<option value="(\d{4}-\d{2})">([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(values.map((v) => v[0]), ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05'], 'current month back to the quarterly anchor, newest first');
  assert.equal(sel.value, '2026-09', 'defaults to the current month');
  assert.equal(values[0][1], 'ספטמבר 2026 — חודש נוכחי (בתהליך)');
  assert.equal(values[1][1], 'אוגוסט 2026 — סופי');
  assert.equal(panel.querySelector('[data-history-view]').hidden, true, 'no history block while the current month is selected');
  assert.equal(sel._listeners.change.length, 1);
  // A re-render (tab re-open / refresh) neither re-wires nor rebuilds the options.
  const before = sel.innerHTML;
  call(ctx, 'renderHouseDetail', 'ramot', vm.runInContext('state.details.ramot', ctx));
  assert.equal(sel._listeners.change.length, 1, 'change handler wired exactly once');
  assert.equal(sel.innerHTML, before);
  // The lookback is 12 months once the anchor is far enough back.
  vm.runInContext('state.now = new Date(2027, 8, 8, 12); state.overview.month = "2027-09";', ctx);
  assert.equal(call(ctx, 'historyMonths_').length, 12);
  assert.equal(call(ctx, 'historyMonths_')[11], '2026-10');
});

test('history picker: selecting a past month fetches managersOverview&month and renders it SETTLED, leaving every bonus figure untouched', async () => {
  const { calls, fetchImpl } = historyFeed({ chartInOverview: true });
  const { ctx, panel } = renderDetailWith(fetchImpl);
  const before = bonusSnapshot(ctx, panel);

  await call(ctx, 'selectHistoryMonth_', 'ramot', '2026-07');

  assert.deepEqual(calls, [{ action: 'managersOverview', month: '2026-07', house: null }], 'one month-overview request, no house request when the chart is in the payload');
  const view = panel.querySelector('[data-history-view]');
  assert.equal(view.hidden, false);
  assert.match(view.innerHTML, /data-history-title>תפוסה יומית — יולי 2026 \(סופי\)</);
  assert.match(view.innerHTML, /ימי טיפול — יולי 2026: <b data-history-days>441 \/ 510</);
  assert.match(view.innerHTML, /ממוצע יומי: <b>14\.7 מטופלים\/יום</);
  assert.match(view.innerHTML, /data-history-status>לא זכאי · המכסה לא הושלמה \(441\/510\)</, 'settled wording from BonusView');
  for (const w of FORBIDDEN) assert.ok(!view.innerHTML.includes(w), `a past month must never say "${w}"`);
  assert.doesNotMatch(view.innerHTML, /2577|2,577|2500|2,500/, 'no backend bonus field rendered');
  const spark = view.querySelector('[data-history-spark]').innerHTML;
  assert.equal((spark.match(/class="ds-col /g) || []).length, 31, 'one bar per July day');
  assert.doesNotMatch(spark, /ds-col future/, 'no "future" day on a finished month');
  assert.match(spark, /זכאות 17/, 'threshold line from HOUSE_BONUS/HOUSE_LABELS, not hardcoded');
  assert.equal(view.querySelector('[data-history-legend-line]').textContent, 'הקו הכתום = זכאות לבונוס (17 מטופלים)');
  assert.equal(panel.querySelector('[data-history-month]').value, '2026-07');

  // The running-month chart card, KPIs, hero, month split, tiers, breakdown,
  // overview card and the bonus state slices are byte-for-byte unchanged.
  assert.deepEqual(bonusSnapshot(ctx, panel), before, 'picker must not affect any bonus figure');
  assert.match(before.kpiDaysLabel, /ספטמבר 2026 \(בתהליך\)/);
  assert.equal(before.kpiDays, '102');

  // A later full re-render (tab re-open / refresh) keeps the selection and
  // still changes nothing on the bonus side.
  call(ctx, 'renderHouseDetail', 'ramot', vm.runInContext('state.details.ramot', ctx));
  assert.deepEqual(bonusSnapshot(ctx, panel), before);
  assert.equal(panel.querySelector('[data-history-month]').value, '2026-07');
  assert.match(panel.querySelector('[data-history-view]').innerHTML, /יולי 2026 \(סופי\)/);
  assert.equal(calls.length, 1, 'cached — no refetch on re-render');

  // Back to the current month: the block hides and nothing was fetched.
  await call(ctx, 'selectHistoryMonth_', 'ramot', '2026-09');
  assert.equal(panel.querySelector('[data-history-view]').hidden, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(bonusSnapshot(ctx, panel), before);
});

test('history picker: a house payload for the WRONG month is rejected — figures shown, chart replaced by an explicit no-data note', async () => {
  const { calls, fetchImpl } = historyFeed({ chartInOverview: false, houseMonth: '2026-09' });
  const { ctx, panel } = renderDetailWith(fetchImpl);
  const before = bonusSnapshot(ctx, panel);
  await call(ctx, 'selectHistoryMonth_', 'ramot', '2026-07');
  assert.deepEqual(calls.map((c) => [c.action, c.month, c.house]), [['managersOverview', '2026-07', null], ['managersHouse', '2026-07', 'ramot']]);
  const html = panel.querySelector('[data-history-view]').innerHTML;
  assert.match(html, /data-history-days>441 \/ 510</);
  assert.match(html, /data-history-state="no-chart">אין נתוני תפוסה יומית ליולי 2026/);
  assert.doesNotMatch(html, /2026-09-0/, 'September bars must never render under the July label');
  assert.deepEqual(bonusSnapshot(ctx, panel), before);
});

test('history picker: a month the bonus code already loaded (last month) is reused read-only — no second overview request', async () => {
  const { calls, fetchImpl } = historyFeed({ houseMonth: '2026-09' });
  const { ctx, panel } = renderDetailWith(fetchImpl);
  const before = bonusSnapshot(ctx, panel);
  await call(ctx, 'selectHistoryMonth_', 'ramot', '2026-08'); // in state.monthOverviews already
  assert.deepEqual(calls.map((c) => [c.action, c.month]), [['managersHouse', '2026-08']], 'only the chart attempt goes out');
  assert.match(panel.querySelector('[data-history-view]').innerHTML, /אוגוסט 2026 \(סופי\)[\s\S]*data-history-days>441 \/ 510</);
  assert.deepEqual(bonusSnapshot(ctx, panel), before);
});

test('history picker: a house payload for the RIGHT month supplies the chart when the overview lacks one', async () => {
  const { fetchImpl } = historyFeed({ chartInOverview: false, houseMonth: 'requested' });
  const { ctx, panel } = renderDetailWith(fetchImpl);
  await call(ctx, 'selectHistoryMonth_', 'ramot', '2026-07');
  const spark = panel.querySelector('[data-history-view]').querySelector('[data-history-spark]').innerHTML;
  assert.equal((spark.match(/class="ds-col /g) || []).length, 31);
});

test('history picker: a failed fetch shows an explicit error state — no stale or blank figures, bonus untouched, retried on re-select', async () => {
  const { calls, fetchImpl } = historyFeed({ failMonth: '2026-07' });
  const { ctx, panel } = renderDetailWith(fetchImpl);
  const before = bonusSnapshot(ctx, panel);
  await call(ctx, 'selectHistoryMonth_', 'ramot', '2026-07');
  const view = panel.querySelector('[data-history-view]');
  assert.equal(view.hidden, false);
  assert.match(view.innerHTML, /data-history-state="error">שגיאה בטעינת יולי 2026: upstream down</);
  assert.doesNotMatch(view.innerHTML, /441|ds-col|data-history-days/, 'no figures rendered on error');
  assert.deepEqual(bonusSnapshot(ctx, panel), before);
  const n = calls.length;
  await call(ctx, 'selectHistoryMonth_', 'ramot', '2026-07');
  assert.ok(calls.length > n, 'a failed month is retried when selected again');
});

test('history picker: an invalid or out-of-range value falls back to the current month and never fetches', async () => {
  const { calls, fetchImpl } = historyFeed();
  const { ctx, panel } = renderDetailWith(fetchImpl);
  for (const bad of ['2026-13', 'javascript:alert(1)', '', null]) {
    await call(ctx, 'selectHistoryMonth_', 'ramot', bad);
    assert.equal(panel.querySelector('[data-history-view]').hidden, true, `"${bad}" must select the current month`);
  }
  assert.equal(calls.length, 0);
});

test('index.html: the house-detail template carries the month picker and history view; app.js never writes bonus state from the history code', () => {
  const html = pub('index.html');
  const tpl = /<template id="houseDetailTpl">[\s\S]*?<\/template>/.exec(html)[0];
  assert.match(tpl, /<select data-history-month/);
  assert.match(tpl, /data-history-view hidden/);
  assert.ok(tpl.indexOf('data-history-month') < tpl.indexOf('data-next-tier-card'), 'picker sits near the top of the detail view');
  const js = pub('app.js');
  const hist = js.slice(js.lastIndexOf('Occupancy history (house-detail month picker)'));
  assert.doesNotMatch(hist, /state\.(overview|monthOverviews|prevOverview|details|chartsByMonth|quarterWindow)\s*(=|\[[^\]]*\]\s*=)/, 'history code must not assign bonus state');
  assert.match(js, /historyByMonth/);
});
