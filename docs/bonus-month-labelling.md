# Bonus month labelling — settled month vs running month

_Shipped September 8, 2026. Frontend only: `public/bonus-view.js`,
`public/app.js`, `public/index.html`, `public/styles.css`, `public/sw.js`.
No Apps Script, server or endpoint changes._

## Why

The UI blurred the **settled previous month** (the bonus that actually pays)
with the **running current month**. On 8 Sep 2026 the Ramot HaShavim page
read "בדרך למדרגה 3 (עדיין לא הושג) · 366/510 ימי טיפול · חסרים 144" with no
month name, while the "ימי טיפול" KPI said 102, and house cards showed a
stray "2500" under the manager name.

Three separate causes:

1. **Two "days so far" sources.** The hero/card used the feed's
   `currentMonth.treatmentDaysSoFar` (366 — inflated by stays dated for the
   whole month up front); the KPI and progress bar summed the daily chart up
   to today (102).
2. **The projection was presented as status.** "בדרך למדרגה 3" was the tier
   the front-dated pace projected to, shown as if it were the house's standing.
3. **A raw feed field was rendered under the manager name.** The card printed
   `h.type` straight from the payload; a backend bonus figure arriving in that
   slot rendered as "2500".

## Rules (enforced by tests)

| # | Rule | Where |
|---|---|---|
| 1 | Every bonus figure names its month. Two blocks: `בונוס <קודם> — סופי (לתשלום)` and `<נוכחי> — חודש נוכחי (בתהליך)` | `settledMonthView`, `currentMonthView` |
| 2 | A settled month is final-state only: `זכאי · מדרגה X · Y ₪` or `לא זכאי · המכסה לא הושלמה (441/510)` (or `לא זכאי · ממוצע … מתחת לסף` when the quota was met). Never `בדרך` / `בתהליך` / `חסרים` | `settledMonthView`, `FORBIDDEN_SETTLED_WORDS` |
| 3 | The running month shows **actual** days-so-far from the 1st (`102/510 ימי טיפול`) and, separately labelled `צפי לסוף החודש`, the projection | `currentMonthView.actualText` vs `.projectionText` |
| 4 | Hero headline = settled previous month (winners, or `<חודש>: אף בית לא עמד בסף`). Running-month progress is a secondary line, always with the month name and `בתהליך` | `winnersBannerView`, `houseHeroView` |
| 5 | A tier is shown as achieved only when settled-and-met or locked in. Otherwise `מדרגה הבאה: N (P מטופלים/יום) · ממוצע נוכחי X` | `tierBadgeView` |
| 6 | Days-so-far is computed **once** (`BonusView.daysSoFar` via `daysSoFarOf_` in app.js) and reused by the KPI, hero, progress bar and house card | `monthlyStatus` |
| 7 | No backend bonus field reaches the DOM. Labels from the feed (manager / name) pass through `safeLabel`; the house type comes from the hardcoded roster only | `safeLabel`, `buildHouseCard` |

## Days-so-far — single source of truth

`BonusView.daysSoFar(input)`:

1. If a `dailyChart` is available (house detail payload), sum its counts up
   to today. Future days are skipped for the running month.
2. Otherwise use the feed's `treatmentDaysSoFar` / `treatmentDays`, **capped
   at elapsed days × capacity** for the running month (a house cannot accrue
   more days than beds × days). Finished months are never capped.

On the overview, a house card uses rule 2 until its detail tab has been
opened; once `state.details[key]` holds the chart, the overview re-renders so
the card shows the same chart-based figure as the detail page.

## Module layout

- `lib/bonus-eligibility.js` — bonus **math** (unchanged).
- `public/bonus-view.js` — **labelling / wording / days-so-far** (new, pure,
  UMD; `require`-able in Node, `window.BonusView` in the browser). Loaded
  after `bonus-eligibility.js` and before `app.js`; part of the SW shell.
- `public/app.js` — DOM rendering only; every bonus string comes from a
  `BonusView` view object. `now_()` (backed by `state.now`) is the only clock
  read, so tests can pin the date.

## Tests

- `test/bonus-view.test.js` (22) — month labels, settled wording (incl. the
  forbidden-word sweep), actual vs projection separation, tier badge rules,
  `daysSoFar` (chart vs capped feed), winners banner, house hero, `safeLabel`.
- `test/app-render.test.js` (12) — loads the real `app.js` in a `vm` sandbox
  with a minimal fake DOM (no jsdom dependency) and asserts on rendered
  output: no backend figure reaches the DOM (fixture carries
  `projectedBonus`/`bep`/`type` = 2577), settled and running blocks are
  labelled and separated, KPI = hero = bar = card = 102 for the fixture
  month, no tier pill mid-month, script order / SW shell / cache v7.

Run: `npm test` (`node --test`, no network, no secrets).

## Security

No new endpoints, no secrets, no server changes. `bonus-view.js` lives in
`public/` and is served by the existing static mount; `lib/auth.js` remains
unreachable over HTTP. Feed strings rendered into the DOM are limited to
roster names and sanitised manager names.
