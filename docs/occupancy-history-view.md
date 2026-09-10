# Occupancy history view — month picker on the house-detail tab

_Shipped September 10, 2026. Frontend only: `public/app.js`,
`public/index.html`, `public/styles.css`, `public/sw.js` (cache v8 → v9).
No Apps Script, server or endpoint changes. All bonus math stays in
`lib/bonus-eligibility.js`; the labelling comes from `public/bonus-view.js`._

## What it does

Every house tab now starts with a **"היסטוריית תפוסה"** card holding a month
picker. It defaults to the current month (the card shows only the picker —
the live blocks below already show that month). Picking a past month renders,
inside the same card, that month's:

- title `תפוסה יומית — <חודש> (סופי)`;
- treatment-days figure against the house's fixed gate
  (`ימי טיפול — אוגוסט 2026: 441 / 510`) and the average daily occupancy;
- the settled status line from `BonusView.settledMonthView`
  (`זכאי · מדרגה X · Y ₪` or `לא זכאי · המכסה לא הושלמה (441/510)`);
- the daily occupancy bar chart (same renderer as the running month, with
  the house's bonus-eligibility line), or — when no daily data exists for
  that month — an explicit `אין נתוני תפוסה יומית ל<חודש>` note.

A past month is always rendered in the **settled** convention: it never says
`בתהליך` / `בדרך` / `חסרים`, and there is no projection.

## Month range

Newest first, from the current month back `HISTORY_LOOKBACK_MONTHS` (12)
months, but never earlier than `HISTORY_FLOOR_YM` (`2026-05`) — the bonus
model's quarterly anchor (`BonusEligibility.quarterWindowFor` returns `null`
before it), so there is no bonus-era data to show before May 2026. In
September 2026 that is May–September; from May 2027 the picker offers the
full 12 months. Both constants sit at the top of `public/app.js`.

## Data fetch (fail-closed)

`loadHistoryMonth_(key, ym)` — one in-flight promise per house+month:

1. **Figures**: `managersOverview&month=YYYY-MM` through the shared
   `fetchMonthOverview_` helper (the same helper `loadOverview` now uses for
   the settled quarter-window months — the per-month fetch exists once). A
   month the bonus code has already loaded (`state.monthOverviews`) is reused
   read-only, without a second request.
2. **Daily chart**: taken from that payload when the backend includes a
   `dailyChart` for the house; otherwise ONE
   `managersHouse&house=<key>&month=YYYY-MM` attempt, accepted **only when
   the response's `month` equals the requested month** and only its points
   dated inside that month. A backend that ignores `month` and echoes the
   current payload is therefore rejected, never shown under a past month's
   label. No usable chart → the explicit no-data note.
3. **Errors** are cached as `{ ok:false, error }` and rendered as an explicit
   error state (`שגיאה בטעינת יולי 2026: …`, HTML-escaped). No figures, no
   stale month. Re-selecting a failed month retries it.

All requests go through `fetchJson` (Bearer session token, 401 → login).
Query values are `encodeURIComponent`-ed and the picker value is validated
(`YYYY-MM`) before use — an invalid value falls back to the current month
and fetches nothing.

## Isolation from the bonus figures (rule, enforced by tests)

The picker is display-only. Its code reads and writes only
`state.historyMonth`, `state.historyByMonth` and `state.loadingHistory`. It
never touches `state.overview`, `state.monthOverviews`, `state.prevOverview`,
`state.details`, `state.chartsByMonth` or `state.quarterWindow`, and
`renderHouseDetail` renders it **last**, after the hero, KPIs, month split,
tier track, quarterly track and breakdown have been computed from the live
month. So the KPI/hero banner keeps showing the actual settled and running
months whatever is selected.

`test/app-render.test.js` snapshots every bonus-rendered string of the house
tab (hero, KPI labels and values, month split, chart-card title and bar, next
tier, tier track, breakdown total, the overview card) plus the bonus state
slices, selects a past month, and asserts the snapshot is byte-for-byte
unchanged — after the selection, after a full re-render, and after switching
back. A static guard also fails if the history section of `app.js` ever
assigns to a bonus state slice.

## Where things are

| Piece | Location |
|---|---|
| Template block (`data-history-month`, `data-history-view`) | `public/index.html`, top of `houseDetailTpl` after the status banner |
| Constants `HISTORY_LOOKBACK_MONTHS`, `HISTORY_FLOOR_YM` | `public/app.js` |
| `fetchMonthOverview_` (shared per-month fetch) | `public/app.js`, above `cacheHouseDetail_` |
| `historyMonths_`, `renderHistoryPicker_`, `selectHistoryMonth_`, `loadHistoryMonth_`, `monthChart_`, `renderHistoryView_` | `public/app.js`, "Occupancy history" section |
| `renderDailySparkInto_` (chart renderer with an explicit host) | `public/app.js` — `renderDailySpark` is now a thin wrapper |
| Styles `.history-card`, `.month-picker`, `.history-view` … | `public/styles.css` |
| Tests | `test/app-render.test.js` ("history picker: …", 8 tests) |

House names/thresholds/capacity come from `HOUSE_LABELS` /
`BonusEligibility.HOUSE_BONUS` — nothing house-specific is hardcoded in the
history code.

## Not changed

- The Apps Script backend. Whether `managersOverview&month=` carries a
  per-house `dailyChart`, and whether `managersHouse` honours `month`, is
  decided there; the frontend accepts either and fails closed otherwise.
- Bonus KPIs, hero banner, house cards, quarterly logic, `lib/`.
