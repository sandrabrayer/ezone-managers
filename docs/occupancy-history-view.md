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

_Shipped September 17, 2026. Frontend only: `public/occupancy-export.js` (new),
`public/app.js`, `public/index.html`, `public/styles.css`, `public/sw.js`
(cache v12 → v13). No server change — the new backend action goes through the
existing `/api/sheets` proxy. No Apps Script change in this repo: the
`occupancySnapshots` action itself ships in the parallel **E-Zone-Dashboard**
PR and this PR must be merged only AFTER that one is deployed._

## What it does

A permanent **«תפוסה חודשית (סופי)»** card:

- **Overview tab** — a table: one row per **settled** month (newest first,
  from the May 2026 anchor), one column per house (five columns, labels from
  `HOUSE_LABELS` only). Each cell shows the month's occupancy percentage with
  `ממוצע יומי/קיבולת` beneath it.
- **Every house tab** — the same card, that house's column only.
- A **«ייצוא CSV»** button on both, next to the title.

It is always the settled view: every row is labelled `<חודש> — סופי`, the
words `בתהליך` / `בדרך` / `חסרים` / `צפי` never appear, and **the running
month is never a row** — a month enters the table only once it has finished.

Unlike the "היסטוריית תפוסה" picker above it, this card needs no selection:
the whole settled history is on screen at once, which is what it is for
(month-over-month comparison across houses).

## Data

One request per page: `GET /api/sheets?action=occupancySnapshots`, through the
same `fetchJson` → `server.js` proxy → `APPS_SCRIPT_URL` path as
`managersOverview` (the proxy's query allowlist already passes `action`; no new
endpoint, env var or Railway variable). Response shape:

```json
{ "ok": true, "rows": [ { "month": "2026-08", "houseId": "ramot",
  "treatmentDays": 441, "daysInMonth": 31, "avgDaily": 14.7, "capacity": 20,
  "occupancyPct": 73.6, "manager": "אורן", "capturedAt": "…" } ] }
```

Settled months do not change under us, so the rows are fetched **once per
page** (boot, not the 60-second overview refresh) and re-rendered from
`state.occupancy` afterwards. The retry button is the only refetch.

Row handling, all fail-closed:

- `houseId` is mapped through `BACKEND_HOUSE_IDS` — **`arfoni` → `efroni`** —
  and any id that does not resolve to a `HOUSE_KEYS` house is **dropped**,
  never guessed into a column.
- A malformed `month`, a month before `OCCUPANCY_FLOOR_YM` (`2026-05`) and the
  running or a future month are dropped.
- `occupancyPct` is used when the feed gives a sane number (0–200), otherwise
  derived from `avgDaily / capacity`; `capacity` falls back to `HOUSE_LABELS`.
  A row with **no** occupancy figure at all is treated as missing data.
- A missing month/house cell renders the explicit note **`אין נתונים`** — never
  `0%`, never blank.
- **Failure, an unknown action, a non-JSON body or a payload without `rows`**
  → an explicit error state (`שגיאה בטעינת תפוסה חודשית: …`) plus a
  **`נסו שוב`** retry button. There is no silent fallback computation: while
  the Dashboard PR is not deployed yet, this card shows that error and nothing
  else — the rest of the app is unaffected.

## CSV export

`public/occupancy-export.js` is a **pure** module (no DOM, no network — a
guard test asserts that), so the file format is unit-tested directly:

- UTF-8 **BOM** first, CRLF lines.
- Hebrew headers, fixed order: `חודש, בית, מנהל/ת, ימי טיפול, ימים בחודש,
  ממוצע יומי, קיבולת, תפוסה %`.
- The manager goes through `BonusView.safeLabel` (a numeric string that leaked
  into the feed's `manager` never reaches the file); house labels come from
  `HOUSE_LABELS`.
- **CSV injection** is neutralised: a cell starting with `=`, `+`, `-`, `@`, a
  tab or a CR is prefixed with an apostrophe; quotes / commas / newlines are
  RFC-4180 quoted (`"` doubled).
- Numbers are locale-independent (`14.7`, not `14.7 ₪` or `14,7`); a missing
  figure is written **empty**, never `0`.
- **Only the eight columns above** are written — every other field of a
  snapshot row (`capturedAt`, `houseId`, and anything the backend adds later)
  is dropped.
- Rows follow the table: month newest first, houses in column order; a cell
  with no data has no line (an empty line would export as zeros).
- `app.js` turns the text into a download (`Blob` + `<a download>`), named
  `occupancy-<oldest>_to_<newest>.csv`, e.g.
  `occupancy-2026-05_to_2026-08.csv`. A house tab exports that house only.

## Isolation from the bonus figures (rule, enforced by tests)

The card is display-only and lives in its own state slice
(`state.occupancy`, `state.loadingOccupancy`). It never reads or writes
`state.overview`, `state.monthOverviews`, `state.prevOverview`,
`state.details`, `state.chartsByMonth`, `state.quarterWindow`,
`state.bonusMonth` or `state.bonusHistory`, and it is rendered **last** on the
house tab, after the hero, KPIs, month split, tier track, quarterly track and
breakdown. Every existing bonus snapshot test stays byte-for-byte green.

Feed values reach the DOM through **`textContent` only** (`createElement` +
`el_()`); the single `innerHTML` write in the section clears the host, and a
static guard fails CI if another one appears.

## Where things are

| Piece | Location |
|---|---|
| CSV format (pure) | `public/occupancy-export.js` |
| Constants `OCCUPANCY_FLOOR_YM`, `BACKEND_HOUSE_IDS` | `public/app.js` |
| `houseKeyOf_`, `occupancyPct_`, `occupancyRow_`, `occupancyTable_` | `public/app.js`, "Monthly occupancy" section |
| `ensureOccupancy_`, `exportOccupancyCsv_`, `downloadCsv_` | same section |
| `renderOccupancyCard_`, `occupancyTableEl_`, `renderOccupancyEverywhere_`, `el_` | same section |
| Hosts `#occupancyCard` / `[data-occupancy-card]` | `public/index.html` |
| Styles `.occupancy-card`, `.occupancy-table`, `.occ-pct` … | `public/styles.css` |
| Tests | `test/occupancy-view.test.js` (18), `test/occupancy-export.test.js` (11), `test/sheets-proxy.test.js` (proxy path) |

## Not changed

- The Apps Script backend (this repo never touches it) — `occupancySnapshots`
  is the Dashboard PR's. Until it is live the card shows its error state.
- Bonus KPIs, hero, house cards, both existing month pickers, `lib/`.
