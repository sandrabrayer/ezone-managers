'use strict';
/* Bonus VIEW rules — month labelling, settled vs running wording, projection
 * vs actual separation, tier badge rules and the single days-so-far figure.
 * Pure unit tests on public/bonus-view.js (no DOM, no network). */
const test = require('node:test');
const assert = require('node:assert/strict');
const BV = require('../public/bonus-view');

const noThreshold = () => 0; // per-house config in HOUSE_BONUS always wins
const FORBIDDEN = BV.FORBIDDEN_SETTLED_WORDS;
const hasForbidden = (s) => FORBIDDEN.some((w) => String(s).includes(w));

/* ── month labelling ─────────────────────────────────────── */
test('monthLabel / prevMonth / daysInMonth for the Sep 2026 case', () => {
  assert.equal(BV.monthLabel('2026-09'), 'ספטמבר 2026');
  assert.equal(BV.monthLabel('2026-08'), 'אוגוסט 2026');
  assert.equal(BV.prevMonth('2026-09'), '2026-08');
  assert.equal(BV.prevMonth('2026-01'), '2025-12');
  assert.equal(BV.daysInMonth('2026-09'), 30);
  assert.equal(BV.daysInMonth('2026-08'), 31);
});

test('dateKey is LOCAL (not UTC-shifted)', () => {
  assert.equal(BV.dateKey(new Date(2026, 8, 8, 0, 30)), '2026-09-08');
});

/* ── settled (previous) month ────────────────────────────── */
test('settled month title names the month and says סופי (לתשלום)', () => {
  const v = BV.settledMonthView({ key: 'ramot', ym: '2026-08', avgDaily: 14.7, treatmentDays: 441 }, noThreshold);
  assert.equal(v.title, 'בונוס אוגוסט 2026 — סופי (לתשלום)');
  assert.equal(v.final, true);
});

test('settled Ramot Aug 2026 (441/510, gate not met) → לא זכאי · המכסה לא הושלמה (441/510), 0 ₪', () => {
  const v = BV.settledMonthView({ key: 'ramot', ym: '2026-08', avgDaily: 14.7, treatmentDays: 441 }, noThreshold);
  assert.equal(v.amount, 0);
  assert.equal(v.tier, 0);
  assert.equal(v.statusText, 'לא זכאי · המכסה לא הושלמה (441/510)');
  assert.equal(v.badge.achieved, false);
});

test('settled month that earned → זכאי · מדרגה X · Y ₪ with the achieved tier badge', () => {
  const v = BV.settledMonthView({ key: 'ramot', ym: '2026-08', avgDaily: 19.2, treatmentDays: 595 }, noThreshold);
  assert.equal(v.amount, 2500);
  assert.equal(v.tier, 2);
  assert.equal(v.statusText, 'זכאי · מדרגה 2 · 2,500 ₪');
  assert.equal(v.badge.achieved, true);
  assert.equal(v.badge.tier, 2);
});

test('settled month: quota met but average below threshold → the average wording', () => {
  // 520 days over 31 days = 16.8 avg — quota (510) met, threshold (17) missed.
  const v = BV.settledMonthView({ key: 'ramot', ym: '2026-08', avgDaily: 16.8, treatmentDays: 520 }, noThreshold);
  assert.equal(v.amount, 0);
  assert.match(v.statusText, /^לא זכאי · ממוצע 16\.8 מטופלים\/יום מתחת לסף \(17\)$/);
});

test('settled-month wording NEVER contains בדרך / בתהליך / חסרים', () => {
  const cases = [
    { key: 'ramot', ym: '2026-08', avgDaily: 14.7, treatmentDays: 441 },
    { key: 'ramot', ym: '2026-08', avgDaily: 16.8, treatmentDays: 520 },
    { key: 'ramot', ym: '2026-08', avgDaily: 19.2, treatmentDays: 595 },
    { key: 'raanana', ym: '2026-08', avgDaily: 9.5, treatmentDays: 295 },
    { key: 'pardes', ym: '2026-08', avgDaily: 13, treatmentDays: 403 }
  ];
  for (const c of cases) {
    const v = BV.settledMonthView(c, noThreshold);
    for (const s of [v.title, v.statusText, v.badge.text]) {
      assert.ok(!hasForbidden(s), `settled wording "${s}" must not contain ${FORBIDDEN.join('/')}`);
    }
  }
});

/* ── running (current) month ─────────────────────────────── */
const RAMOT_SEP = { key: 'ramot', ym: '2026-09', daysSoFar: 102, elapsedDays: 8, daysInMonth: 30, capacity: 20 };

test('current month title names the month and says חודש נוכחי (בתהליך)', () => {
  const v = BV.currentMonthView(RAMOT_SEP, noThreshold);
  assert.equal(v.title, 'ספטמבר 2026 — חודש נוכחי (בתהליך)');
  assert.equal(v.final, false);
});

test('current month: ACTUAL days-so-far (102/510) and PROJECTION are separate, labelled fields', () => {
  const v = BV.currentMonthView(RAMOT_SEP, noThreshold);
  assert.equal(v.daysSoFar, 102);
  assert.equal(v.actualText, '102/510 ימי טיפול');
  assert.equal(v.projectionLabel, 'צפי לסוף החודש');
  // 102 / 8 = 12.75 avg → 382.5 → 383 projected days, below the 17 threshold
  assert.equal(v.projectedDays, 383);
  assert.equal(v.projectedAmount, 0);
  assert.match(v.projectionText, /^383 ימי טיפול · מתחת לסף \(17 מטופלים\/יום\)$/);
  assert.notEqual(v.actualText, v.projectionText);
  assert.ok(!v.actualText.includes('383'), 'the actual line must not carry the projection');
  assert.ok(!v.projectionText.includes('102/'), 'the projection line must not be presented as actual');
});

test('current month: nothing secured → state projection, 0 ₪ secured, next-tier badge (never a tier as status)', () => {
  const v = BV.currentMonthView(RAMOT_SEP, noThreshold);
  assert.equal(v.state, 'projection');
  assert.equal(v.securedAmount, 0);
  assert.equal(v.securedTier, 0);
  assert.equal(v.badge.achieved, false);
  assert.equal(v.badge.text, 'מדרגה הבאה: 1 (17 מטופלים/יום) · ממוצע נוכחי 12.8');
  assert.doesNotMatch(v.badge.text, /^מדרגה \d/);
});

test('current month: on pace for tier 3 but gate not met → still "מדרגה הבאה", never "מדרגה 3"', () => {
  // 20.5 avg over 8 days = 164 days — far from the 510 gate.
  const v = BV.currentMonthView({ ...RAMOT_SEP, daysSoFar: 164, capacity: 22 }, noThreshold);
  assert.equal(v.projectedTier, 3);
  assert.equal(v.projectedAmount, 3000);
  assert.equal(v.state, 'projection');
  assert.equal(v.securedTier, 0);
  assert.equal(v.badge.achieved, false);
  assert.match(v.badge.text, /^מדרגה הבאה: 3 \(20 מטופלים\/יום\) · ממוצע נוכחי 20\.5$/);
  assert.match(v.projectionText, /מדרגה 3 \(3,000 ₪\)/, 'the projection line may name the projected tier');
});

test('current month: gate met and average supports a tier → locked, tier shown as achieved', () => {
  // Day 27: 27 × 19 = 513 ≥ 510, avg 19 → tier 2 secured.
  const v = BV.currentMonthView({ ...RAMOT_SEP, daysSoFar: 513, elapsedDays: 27 }, noThreshold);
  assert.equal(v.state, 'locked');
  assert.equal(v.securedTier, 2);
  assert.equal(v.securedAmount, 2500);
  assert.equal(v.badge.achieved, true);
  assert.equal(v.badge.text, 'מדרגה 2 · 2,500 ₪');
  assert.equal(v.securedText, 'מובטח · מדרגה 2 · 2,500 ₪');
});

test('current month average is capped at capacity (front-dated stays cannot project above the beds)', () => {
  const v = BV.currentMonthView({ ...RAMOT_SEP, daysSoFar: 366 }, noThreshold); // 366/8 = 45.75 > 20 beds
  assert.equal(v.avgSoFar, 20);
  assert.equal(v.projectedDays, 600);
});

/* ── tier badge rules ────────────────────────────────────── */
test('tierBadgeView: achieved only when an achieved tier is passed in', () => {
  assert.equal(BV.tierBadgeView({ key: 'ramot', achievedTier: 1, achievedAmount: 2000 }).text, 'מדרגה 1 · 2,000 ₪');
  const b = BV.tierBadgeView({ key: 'ramot', avgDaily: 12 });
  assert.equal(b.achieved, false);
  assert.equal(b.text, 'מדרגה הבאה: 1 (17 מטופלים/יום) · ממוצע נוכחי 12');
  assert.equal(BV.tierBadgeView({ key: 'ramot', avgDaily: 17 }).text, 'מדרגה הבאה: 2 (19 מטופלים/יום) · ממוצע נוכחי 17');
  assert.equal(BV.tierBadgeView({ key: 'ramot', avgDaily: 19.5 }).text, 'מדרגה הבאה: 3 (20 מטופלים/יום) · ממוצע נוכחי 19.5');
  assert.equal(BV.tierBadgeView({ key: 'raanana', avgDaily: 9 }).text, 'מדרגה הבאה: 1 (10 מטופלים/יום) · ממוצע נוכחי 9');
});

/* ── days so far: ONE computation ────────────────────────── */
test('daysSoFar sums the daily chart up to today only (future days skipped)', () => {
  const chart = [
    { date: '2026-09-01', count: 12 }, { date: '2026-09-02', count: 12 }, { date: '2026-09-03', count: 13 },
    { date: '2026-09-04', count: 13 }, { date: '2026-09-05', count: 13 }, { date: '2026-09-06', count: 13 },
    { date: '2026-09-07', count: 13 }, { date: '2026-09-08', count: 13 },
    { date: '2026-09-09', count: 20 }, { date: '2026-09-10', count: 20 } // future (front-dated)
  ];
  assert.equal(BV.daysSoFar({ dailyChart: chart, todayKey: '2026-09-08', isCurrentMonth: true }), 102);
  assert.equal(BV.daysSoFar({ dailyChart: chart, todayKey: '2026-09-08', isCurrentMonth: false }), 142);
});

test('daysSoFar without a chart caps the feed figure at elapsed × capacity for the running month', () => {
  assert.equal(BV.daysSoFar({ treatmentDaysSoFar: 366, elapsedDays: 8, capacity: 20, isCurrentMonth: true }), 160);
  assert.equal(BV.daysSoFar({ treatmentDaysSoFar: 96, elapsedDays: 8, capacity: 20, isCurrentMonth: true }), 96);
  assert.equal(BV.daysSoFar({ treatmentDays: 441, elapsedDays: 31, capacity: 20, isCurrentMonth: false }), 441);
  assert.equal(BV.daysSoFar({}), 0);
});

test('chart-based days-so-far is what the running-month view reports (KPI = hero = bar = card)', () => {
  const chart = Array.from({ length: 8 }, (_, i) => ({ date: `2026-09-0${i + 1}`, count: i < 2 ? 12 : 13 }));
  const days = BV.daysSoFar({ dailyChart: chart, todayKey: '2026-09-08', isCurrentMonth: true });
  const v = BV.currentMonthView({ ...RAMOT_SEP, daysSoFar: days }, noThreshold);
  assert.equal(days, 102);
  assert.equal(v.daysSoFar, days);
  assert.equal(v.actualText, `${days}/510 ימי טיפול`);
});

/* ── overview hero (winners banner) ──────────────────────── */
test('winners banner: no winner → "<month>: אף בית לא עמד בסף"; running month on a secondary line marked בתהליך', () => {
  const v = BV.winnersBannerView('2026-08', [
    { name: 'רמות השבים', manager: 'אורן', amount: 0, tier: 0, quarterly: 0 }
  ], { ym: '2026-09', dayOfMonth: 8, daysInMonth: 30 });
  assert.equal(v.title, 'בונוסים לתשלום — אוגוסט 2026 (סופי)');
  assert.equal(v.winners.length, 0);
  assert.equal(v.noneText, 'אוגוסט 2026: אף בית לא עמד בסף');
  assert.equal(v.currentLine, 'ספטמבר 2026 — חודש נוכחי (בתהליך) · יום 8 מתוך 30');
  assert.ok(!hasForbidden(v.title) && !hasForbidden(v.noneText));
});

test('winners banner: a winner row reads זכאי · מדרגה X · Y ₪ (+ quarterly when earned)', () => {
  const v = BV.winnersBannerView('2026-08', [
    { name: 'רעננה אשר', manager: 'שחר', amount: 2500, tier: 2, quarterly: 5000 },
    { name: 'רמות השבים', manager: 'אורן', amount: 0, tier: 0, quarterly: 0 }
  ]);
  assert.equal(v.winners.length, 1);
  assert.equal(v.winners[0].total, 7500);
  assert.equal(v.winners[0].text, 'זכאי · מדרגה 2 · 2,500 ₪ · כולל בונוס רבעוני 5,000 ₪');
});

/* ── house hero ──────────────────────────────────────────── */
test('house hero: headline is the SETTLED month; running month is the secondary line', () => {
  const settled = BV.settledMonthView({ key: 'ramot', ym: '2026-08', avgDaily: 14.7, treatmentDays: 441 }, noThreshold);
  const current = BV.currentMonthView(RAMOT_SEP, noThreshold);
  const h = BV.houseHeroView({ name: 'רמות השבים', manager: 'אורן', settled, current });
  assert.equal(h.headline, 'אוגוסט 2026: לא זכאי · המכסה לא הושלמה (441/510)');
  assert.ok(!hasForbidden(h.headline));
  assert.match(h.secondary, /^ספטמבר 2026 — חודש נוכחי \(בתהליך\) · 102\/510 ימי טיפול · צפי לסוף החודש: /);
  assert.match(h.secondary, /מדרגה הבאה: 1 \(17 מטופלים\/יום\) · ממוצע נוכחי 12\.8$/);
  assert.equal(h.tone, 'below');
});

test('house hero: winner headline carries the month and the final result', () => {
  const settled = BV.settledMonthView({ key: 'raanana', ym: '2026-08', avgDaily: 12.5, treatmentDays: 388 }, noThreshold);
  const h = BV.houseHeroView({ name: 'רעננה אשר', manager: 'שחר', settled, current: null });
  assert.equal(h.headline, 'בונוס אוגוסט 2026 — סופי (לתשלום): זכאי · מדרגה 2 · 2,500 ₪');
  assert.equal(h.tone, 'above');
  assert.equal(h.secondary, '');
});

/* ── payload sanitising ──────────────────────────────────── */
test('safeLabel drops numeric / amount-like feed values (the stray "2500")', () => {
  assert.equal(BV.safeLabel(2500), '');
  assert.equal(BV.safeLabel('2500'), '');
  assert.equal(BV.safeLabel('2,500 ₪'), '');
  assert.equal(BV.safeLabel(' '), '');
  assert.equal(BV.safeLabel(null), '');
  assert.equal(BV.safeLabel('אורן'), 'אורן');
  assert.equal(BV.safeLabel('בית מאזן'), 'בית מאזן');
});
