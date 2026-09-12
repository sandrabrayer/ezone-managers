# Bonus month labelling — settled month vs running month

_Shipped September 8, 2026. Frontend only: `public/bonus-view.js`,
`public/app.js`, `public/index.html`, `public/styles.css`, `public/sw.js`.
No Apps Script, server or endpoint changes. Overview chart prefetch added the
same day as a follow-up (SW v8). Bonus history month picker added
September 10, 2026 (SW v10) — see the last section._

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

### Overview cards read the same chart as the detail tab

`loadOverview` fetches every house's daily chart **once per month** (in
parallel with the finished-month overview fetches) through
`ensureHouseCharts_`, and `cacheHouseDetail_` stores the payload in two
places: `state.details[key]` (what the detail tab renders) and
`state.chartsByMonth[YYYY-MM][key]` (what `daysSoFarOf_` reads for the
cards). Because card and tab read the same payload, they cannot disagree.

- The 60-second overview refresh is a cache hit for every house: it reloads
  the overview feed but makes **no** chart requests.
- The cache is keyed by month; other months are dropped when the running
  month changes, so a stale chart is never summed into a new month.
- A failed chart fetch leaves that house uncached: its card falls back to
  rule 2 (capped feed figure) and the next refresh retries the fetch. The
  other houses are not refetched.
- Opening a house tab still fetches the detail (activity, entries, exits)
  and writes through the same cache, then re-renders the overview.

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
- `test/app-render.test.js` (16) — loads the real `app.js` in a `vm` sandbox
  with a minimal fake DOM (no jsdom dependency) and asserts on rendered
  output: no backend figure reaches the DOM (fixture carries
  `projectedBonus`/`bep`/`type` = 2577), settled and running blocks are
  labelled and separated, KPI = hero = bar = card = 102 for the fixture
  month, no tier pill mid-month, overview card = detail tab from the shared
  per-month chart cache, `loadOverview` makes one chart request per house
  and none on refresh (stubbed feed), failed chart fetches are retried,
  script order / SW shell / cache v8.

Run: `npm test` (`node --test`, no network, no secrets).

## Security

No new endpoints, no secrets, no server changes. `bonus-view.js` lives in
`public/` and is served by the existing static mount; there is no static
mount on `lib/`, so only `bonus-eligibility.js` is reachable over HTTP. Feed
strings rendered into the DOM are limited to roster names and sanitised
manager names. (The app's access model has since changed twice — see
`docs/open-access.md` for the current one.)

## Bonus history month picker (September 10, 2026)

_Frontend only: `public/app.js`, `public/bonus-view.js`, `public/index.html`,
`public/styles.css`, `public/sw.js` (v9 → v10). No Apps Script, server or
endpoint changes._

### What it does

A **"חודש בונוס"** `<select>` sits at the top of the overview
(`#bonusMonthOverview`) and of every house tab (`[data-bonus-month]` in
`houseDetailTpl`). It lists, newest first, the running month — the default,
labelled `ספטמבר 2026 — חודש נוכחי (בתהליך)` — and **every finished month
back to `HISTORY_FLOOR_YM` (May 2026, the quarterly anchor)**, each labelled
`יולי 2026 — סופי`. There is no lookback cap (`BonusView.monthsBetween`).
The selection is one page-wide value (`state.bonusMonth`): picking July on
the overview shows July on every opened house tab and the other way round.
While a finished month is selected a `חזרה לחודש נוכחי` link is shown
(`#bonusMonthBackOverview` / `[data-bonus-month-back]`).

### A finished month is rendered SETTLED — and nothing else

Rule 2 applies to the whole page, not just the settled block. Every string
comes from `BonusView.settledMonthView` (plus two fields added for the
picker: `shortTitle` = `יולי 2026 — סופי`, `gateText` =
`560/510 ימי טיפול · המכסה הושלמה`) and `houseHeroView({ selected: true })`:

| Surface | Running month (unchanged) | Selected finished month |
|---|---|---|
| Header tag | `ספטמבר 2026` | `יולי 2026 — סופי` |
| KPI 1 | `בתים עם בונוס מובטח — … (בתהליך)` | `בתים זכאים לבונוס — יולי 2026 (סופי)` = houses with a settled amount |
| KPI 2 | `מטופלים פעילים` (live count) | `ממוצע מטופלים/יום — יולי 2026 (סופי)` = sum of the houses' month averages |
| KPI 3 | `בונוס אוגוסט 2026 — סופי (לתשלום)` | `בונוס יולי 2026 — סופי (לתשלום)` = sum of settled amounts |
| KPI 4 | `יום בחודש — …` `8 מתוך 30` | `ימים בחודש — יולי 2026 (סופי)` `31 מתוך 31` (days-so-far = full month) |
| Winners banner | settled previous month + running line | selected month; footer `📅 יולי 2026 — סופי · תצוגה היסטורית` |
| Network chart | current occupancy | the month's average per house (`19.2/20`) |
| House card | settled block + running block | ONE settled block (`shortTitle`, amount, `statusText`, average, `gateText`, quarterly if earned), `✓ זכאי · יולי 2026` / `⚠ לא זכאי · יולי 2026`, tier pill only when earned, `ימי טיפול — יולי 2026 (סופי) 560 / 510` |
| House hero | settled previous month + running line | `יולי 2026 — סופי: זכאי · מדרגה 2 · 2,500 ₪`, no secondary line |
| House KPIs | `ימי טיפול עד כה — … (בתהליך)`, `מובטח עד כה — …` | `ימי טיפול — יולי 2026 (סופי)` = settled total, `בונוס יולי 2026 — סופי`; entries / exits `—` |
| Month split | two rows | one settled row |
| Days bar | so-far / target / `צפי לסוף החודש` | `ימי טיפול בחודש` / target / `המכסה: הושלמה` — the legend labels are now `data-stat-label` spans |
| Daily chart | running chart | the month's chart when the payload (or the occupancy-history cache) has one, else `אין נתוני תפוסה יומית ליולי 2026` |
| Next-tier card | shown | **hidden** and blanked (`[hidden]`, CSS `display:none`) |
| Tier track | `מדרגה הבאה … ממוצע נוכחי` | `מדרגה 2 הושגה ✓ · יולי 2026 (סופי) · ממוצע 19.2 מטופלים/יום` or `לא הושגה מדרגה · … (סף 17)` |
| Quarterly | running window | the **selected month's window** as of that month + `[data-quarterly-months]`: `מאי 2026 ✓ · יוני 2026 ✗ · יולי 2026 ✓` (`(לאחר החודש שנבחר)` for later months) |
| Breakdown | `✓ מובטח`, `אין הפניות פעילות החודש` | `✓ הושג`, `אין נתוני הפניות ליולי 2026`, quarterly line for the selected window |
| Logs | entries / exits | `אין נתוני כניסות ליולי 2026` |

The forbidden list for a picked month is the settled list **plus** `צפי`,
`ממוצע נוכחי` and `מובטח`; `test/app-render.test.js` sweeps every rendered
string of the overview and the house tab (the pickers' own option lists
excepted, as they legitimately name the running month).

### Data and cache

`loadBonusMonth_(ym)` fetches, through the existing `fetchMonthOverview_`
(`managersOverview&month=YYYY-MM`), the selected month **plus the finished
months of its quarter window up to it** (≤ 3 requests). Results live in
`state.bonusHistory[ym] = { ok:true, byKey } | { ok:false, error }` for the
life of the page; a month already in `state.monthOverviews` (last month,
the running window) is pinned into the history cache without a request.
So re-selecting a month, selecting another month of the same window, and
selecting last month all cost nothing, and the cache survives the
60-second refresh (which resets `state.monthOverviews`). A failed month is
cached as an error, rendered as an explicit error state on the overview
(`houseGrid`, banner, KPIs `—`) and on the tab (hero + every figure blanked
via `blankDetailFigures_`), and refetched on the next selection.

`settledHouseFor_(key, ym)` builds the house object for a month from
whitelisted raw fields only (`avgDaily`, `treatmentDays`, sanitised
`name` / `manager`, live capacity) with `month = ym`, so `monthlyStatus`
treats it as finished; backend bonus fields are never copied
(`BACKEND_JUNK` fixture in the tests).

### Running month stays exactly as it was

`state.bonusMonth === null` → `renderOverview`, `buildHouseCard` and
`renderHouseDetail` take their previous code paths (the only additions are
rendering the picker, restoring the legend labels / KPI-2 label / chart
subtitle text to their static values, and un-hiding the next-tier card).
The picker never writes `state.overview`, `state.monthOverviews`,
`state.prevOverview`, `state.details`, `state.chartsByMonth` or
`state.quarterWindow`. `test/app-render.test.js` snapshots the whole
overview and the Ramot tab, picks July, returns, and asserts the snapshot
is byte-for-byte identical — also after a refresh in history mode.

### Relation to the occupancy-history picker

The "היסטוריית תפוסה" card on the house tab (`docs/occupancy-history-view.md`)
is unchanged and independent: it shows a past month's daily chart inside its
own card without touching the bonus figures, while the bonus picker switches
the whole page. The bonus picker reuses a daily chart the occupancy picker
already loaded (`state.historyByMonth`) but never requests one itself.

### Where things are

| Piece | Location |
|---|---|
| Picker markup (overview `#bonusMonthBar`, template `.bonus-month-bar`) | `public/index.html` |
| `monthsBetween`, `shortTitle` / `gateText`, `houseHeroView({ selected })` | `public/bonus-view.js` |
| State `bonusMonth` / `bonusHistory` / `loadingBonusHistory` | `public/app.js` |
| "Bonus history" section: `historyYMOf_`, `monthByKey_`, `bonusMonthEntry_`, `bonusMonths_`, `settledHouseFor_`, `settledViewFor_`, `loadBonusMonth_`, `selectBonusMonth_`, `rerenderAll_`, `renderBonusMonthPicker_`, `renderOverviewSettled_`, `renderWinnersBannerSettled_`, `renderNetworkSparkSettled_`, `buildSettledHouseCard_`, `blankDetailFigures_`, `renderHouseDetailSettled_` | `public/app.js`, above the occupancy-history section |
| Settled branches: `renderMonthSplit_(…, settledOverride)`, `renderTierTrack` (`ctx.settled`), `renderQuarterlyTrack` (`asOf`, `quarterMonthsText_`), `renderBreakdown` (`ctx.settled`), `quarterlyLocal_(key, asOfYM)` | `public/app.js` |
| Styles `.bonus-month-bar`, `.link-btn`, `.quarterly-months`, `.log-empty`, `[hidden]` guards | `public/styles.css` |
| Tests | `test/bonus-view.test.js` (3), `test/app-render.test.js` ("bonus picker: …", 8) |

### Security

No new endpoints (the only request is the existing
`managersOverview&month=`), no secrets, no server changes. The picker value
is validated against the offered list before use; error messages are
HTML-escaped; only sanitised name / manager strings from the month rows
reach the DOM.
