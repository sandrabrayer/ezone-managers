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

function makeSandbox() {
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
    setInterval: () => 0, setTimeout: () => 0, fetch: () => Promise.reject(new Error('no network in tests'))
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

function setup() {
  const s = makeSandbox();
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

/* ── static guards ────────────────────────────────────────── */
test('index.html loads bonus-view.js after bonus-eligibility.js and before app.js; SW caches it; SW cache is v7+', () => {
  const html = pub('index.html');
  const order = ['/lib/bonus-eligibility.js', '/bonus-view.js', '/app.js'].map((s) => html.indexOf(`<script src="${s}">`));
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `script order wrong: ${order}`);
  const sw = pub('sw.js');
  assert.match(sw, /'\/bonus-view\.js'/, 'SW shell must include /bonus-view.js');
  const m = sw.match(/const CACHE = 'ezone-managers-v(\d+)'/);
  assert.ok(m && Number(m[1]) >= 7, 'SW cache must be bumped to v7+ for the relabelled shell');
});

test('app.js never renders the feed\'s `type` field and takes labels through safeLabel', () => {
  const js = pub('app.js');
  assert.doesNotMatch(js, /\bh\.type\b/, 'h.type must not be read — the roster type is the only source');
  assert.doesNotMatch(js, /\$\{h\.manager\}/, 'manager must go through BonusView.safeLabel');
  assert.match(js, /BV\.safeLabel\(h\.manager\)/);
});
