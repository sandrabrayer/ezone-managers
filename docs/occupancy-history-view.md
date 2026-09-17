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

---

# Monthly occupancy (permanent)

_Shipped September 17, 2026. Frontend only: `public/app.js`,
`public/occupancy-export.js` (new), `public/index.html`, `public/styles.css`,
`public/sw.js` (cache v12 → v13). No server change, no new endpoint, no new
env var. **Merge only after the E-Zone-Dashboard PR that adds the
`occupancySnapshots` action is deployed** — until then the card shows its
error state, which is the intended fail-closed behaviour._

## What it does

A permanent card, **«תפוסה חודשית (סופי)»**, on the overview tab and on every
house tab. It is the settled monthly occupancy record — separate from, and
independent of, the bonus model.

- **Rows = months, newest first**, from last month back to `2026-05`
  (`OCCUPANCY_FLOOR_YM`, the same May 2026 anchor the pickers use). Every row
  is labelled `<חודש> — סופי`.
- **Columns = the five houses** on the overview, in `HOUSE_KEYS` order, named
  from `HOUSE_LABELS` only. A house tab shows that house's column alone.
- **A cell** is the month's occupancy percentage, with the average daily
  occupancy over the capacity (`14.2 / 20`) underneath.
- **A month a house has no snapshot for reads «אין נתונים»** — never `0`, and
  never a figure derived from the other fields.
- **The running month is never shown.** It is dropped on ingest, together with
  future months and anything before the anchor, so nothing can carry the
  `סופי` label while it is still accruing. The card never says
  `בתהליך` / `בדרך` / `חסרים`.

## Data

One backend action, read through the existing proxy exactly like
`managersOverview`:

```
GET /api/sheets?action=occupancySnapshots
→ { ok: true, rows: [ { month:'YYYY-MM', houseId, treatmentDays, daysInMonth,
                        avgDaily, capacity, occupancyPct, manager, capturedAt } ] }
```

- `server.js` already forwards `action` (its allowlist is `action`, `house`,
  `month`), so **no server change and no Railway variable** was needed. The
  Apps Script `/exec` URL stays server-side as always.
- **Fetched once per calendar month.** `loadOverview` kicks the request off
  and caches the result in `state.occupancy` keyed by the month it was
  fetched in; the 60-second refresh is a cache hit, and re-rendering a tab
  never issues a request. The month rolling over re-fetches.
- **`arfoni` → `efroni`** (`OCCUPANCY_HOUSE_IDS`). A house id that is not a
  `HOUSE_KEYS` key after the mapping is dropped.
- **Only the nine documented fields are read** off a row, in
  `normalizeOccupancyRows_`. Everything else the backend sends — bonus fields
  included — is discarded at that boundary, so it can reach neither the DOM
  nor the CSV. The manager string goes through `BonusView.safeLabel`.
- Duplicate `month`+`house` rows: the first wins.

## Failure is explicit (no silent fallback)

A rejected request, a body that is not `{ ok:true, rows:[…] }`, or an unknown
action (what the backend answers until the Dashboard PR deploys) all produce
the same thing: `state.occupancy = { ok:false, error }` and a card showing

```
שגיאה בטעינת תפוסה חודשית: <upstream message>   [ נסה שוב ]
```

There is no table, no cells, no zeroes and nothing computed from the bonus
figures to stand in. **«נסה שוב»** re-fetches (`force`) and re-renders both
mount points.

## CSV export

The **«ייצוא CSV»** button exports the houses currently on screen — all five
from the overview, one from a house tab — and is hidden when there is nothing
to export.

All of the file's rules live in the pure module **`public/occupancy-export.js`**
(no DOM, no network, no state), so they are tested directly:

- a **UTF-8 BOM** first, or Excel renders the Hebrew as mojibake;
- Hebrew headers, fixed order:
  `חודש, בית, מנהל/ת, ימי טיפול, ימים בחודש, ממוצע יומי, קיבולת, תפוסה %`;
- the manager column goes through `BonusView.safeLabel`, falling back to the
  `HOUSE_LABELS` roster name — a numeric string (a backend bonus figure that
  leaked into a text field) never lands in it;
- **CSV-injection escaping**: a value starting with `=`, `+`, `-`, `@`, TAB or
  CR is prefixed with an apostrophe, so a spreadsheet never evaluates feed
  text as a formula;
- **every field is quoted** and inner quotes are doubled, so a comma, a
  newline or a quote in an upstream string cannot shift a column;
- numbers are written ASCII (no `he-IL` thousands separator), averages and
  percentages to one decimal, a missing number as an empty field — never `0`;
- the month is written as `YYYY-MM` (sortable and unambiguous; the Hebrew
  label is a display concern);
- rows are ordered as the table reads them: newest month first, `HOUSE_KEYS`
  order within a month, and only cells that actually carry data.

The download itself is a `Blob` named
`occupancy-<from>_to_<to>.csv` (`from` / `to` = the oldest and newest exported
month, both validated as `YYYY-MM`, so nothing in a payload can steer the file
name; anything else falls back to `occupancy.csv`).

## Isolation from the bonus figures (rule, enforced by tests)

The card is display-only. Its code reads and writes `state.occupancy` and
`state.loadingOccupancy` and nothing else — never `state.overview`,
`state.monthOverviews`, `state.prevOverview`, `state.details`,
`state.chartsByMonth`, `state.quarterWindow`, `state.bonusMonth` or
`state.bonusHistory` — and `renderHouseDetail` renders it **last**. The
existing bonus snapshots in `test/app-render.test.js` are asserted unchanged
across an occupancy load and a refresh. Every value that came from the feed
reaches the DOM through `textContent`; the renderer only ever assigns
`innerHTML = ''` to clear, and a static guard fails CI if that changes.

## Where things are

| Piece | Location |
|---|---|
| Card markup (`data-occupancy-card/-body/-export`) — overview **and** `houseDetailTpl` | `public/index.html` |
| Constants `OCCUPANCY_FLOOR_YM`, `OCCUPANCY_NO_DATA`, `OCCUPANCY_HOUSE_IDS` | `public/app.js` |
| `normalizeOccupancyRows_`, `ensureOccupancySnapshots_`, `occupancyMonths_`, `occupancyCell_`, `occupancyTableModel_`, `occupancyExportRows_`, `renderOccupancyTableInto_`, `renderOccupancyCard_`, `renderOccupancyEverywhere_` | `public/app.js`, "Monthly occupancy (permanent)" section |
| CSV rules (BOM, headers, escaping, file name) | `public/occupancy-export.js` |
| Styles `.occupancy-card`, `.occupancy-table`, `.occupancy-cell` … | `public/styles.css` |
| Tests | `test/occupancy-export.test.js` (9) · `test/app-render.test.js` "occupancy: …" (11) · `test/sheets-proxy.test.js` (2) |

## Not changed

- The Apps Script backend. `occupancySnapshots` is added in the parallel
  E-Zone-Dashboard PR; this frontend only consumes it and fails closed when it
  is absent.
- Bonus KPIs, hero banner, house cards, the bonus-history picker and the
  occupancy-history picker above — all byte-for-byte unchanged.
