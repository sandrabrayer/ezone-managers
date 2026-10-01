# Settled month: the house tab shows that month's own data

_October 1, 2026 — frontend only (`public/app.js`, `public/styles.css`,
`public/sw.js` v13 → v14, `lib/bonus-eligibility.js`). No Apps Script change,
no new endpoint, env var or secret._

> **Referral bonus disabled by decision (1 Oct 2026); switch: CONTINUITY_BONUS_ENABLED in lib/bonus-eligibility.js.** Managers get occupancy bonuses only, in the running month
> and in finished months. See "Referral bonus disabled" at the end.

## Symptom

On 1 Oct 2026 — the first day September 2026 was a finished ("settled") month
— a house tab with tiers 10/12/13, with September picked in the «חודש בונוס»
picker, showed:

- «אין נתוני כניסות לספטמבר 2026», «אין נתוני יציאות לספטמבר 2026»,
  «אין נתוני הפניות לספטמבר 2026»;
- no patient names;
- 0 ₪ on the bonus lines.

Every house had admissions and discharges in September.

## Root cause

| # | Where | What |
|---|---|---|
| 1 | `public/app.js` `renderHouseDetailSettled_` (on `main` before the fix: l. 1591, 1641, 1656–1657, 1702–1703) | The settled house tab was built **only** from the `managersOverview&month=YYYY-MM` row. It set `entries`/`exits` KPIs to `—`, passed `continuityCounts({})` (always zero referrals) and **hardcoded** `אין נתוני כניסות/יציאות ל<חודש>`. No fetch was ever made for that month's house data. |
| 2 | `public/app.js` `renderBreakdown` (on `main`: l. 2485) | For a settled month with zero counts, the referral line printed `אין נתוני הפניות ל<חודש>` at 0 ₪. That was always the case because of #1. |
| 3 | `public/app.js` `selectBonusMonth_` / `loadBonusMonth_` (on `main`: l. 1283, 1254) | They fetched only `managersOverview&month=` (≤ 3 requests). The design doc stated it outright: "no house requests". |
| 4 | E-Zone-Dashboard `apps-script/Code.gs` `managersOverview_` (l. 6481–6557) | Per house it returns `avgDaily`, `treatmentDays`, `entriesMonth`, `exitsMonth`, `patientsNow`, `capacity`, `manager` and `bonus{…continuity counts…}`. There is **no** `activity` (names) and **no** `dailyChart`. |
| 5 | E-Zone-Dashboard `apps-script/Code.gs` `managersHouse_` (l. 6559–6614) + `computeMonthStats_` (l. 6305–6363) | `month` is honoured for any month: `ym = monthParam \|\| defaultMonth_()`. Every figure is recomputed from the live Patients sheet for that month: `activity` (entry/exit rows **with names**), `entriesMonth`, `exitsMonth`, `dailyChart`, `bonus.continuity`. It takes the **frontend** key (`efroni`, `pardes`) and maps `efroni → arfoni` itself (`MANAGER_HOUSE_TO_PATIENTS_HOUSE_ID`, l. 115–121). `arfoni` → `unknown_house`. |

So the data existed behind an open action the app already uses. The frontend
simply never asked for it. **No Dashboard change is needed.**

### The 0 ₪ lines

- **Referral line**: a missing-data artifact. The counts were hardcoded to
  zero (#1).
- **Tier / monthly amount / hero**: a real computation. It comes from the
  September `managersOverview` row's raw `avgDaily` / `treatmentDays`, which
  are produced by the same `computeMonthStats_` over the live Patients sheet.
  With tiers 10/12/13 the house needs an average ≥ 10 **and** ≥ 300 treatment
  days. A 0 ₪ there means the September figures did not reach that. The hero
  names the reason (`המכסה לא הושלמה (n/300)` or `ממוצע … מתחת לסף`). The
  live figures could not be checked from the Code session: the sandbox
  network blocks the Railway host.
- **Quarterly line**: correctly 0 ₪. The Aug–Oct window is not finished on
  1 Oct.
- **Latent artifact, fixed too**: `settledHouseFor_` coerced an absent
  `avgDaily` / `treatmentDays` to `0`, which would render `לא זכאי · 0 ₪` for
  a house with no data.

## Fix

- **`loadSettledHouse_(key, ym)`**: for every opened house tab, a finished
  month also loads `managersHouse&house=<key>&month=YYYY-MM`, once per house ×
  month, cached in a new slice `state.settledDetails` (never `state.details`).
  - It is accepted only when `month` matches, and when it names a house, that
    house (`arfoni` is accepted as `efroni`).
  - Only entry / exit rows dated inside the month, the referral **counts** and
    the daily chart are kept.
  - A key outside `HOUSE_KEYS` or a malformed month is never sent.
  - Tabs opened while the month is selected fetch on first render.
  - A failed house is retried on the next selection; the others are not
    refetched.
- **Explicit states**, never «אין נתונים» for data that was not fetched:
  - **Logs**: `טוען כניסות — …`, `שגיאה בטעינת כניסות ל…: …`, the rows, or
    `לא היו כניסות ב…` only when the payload confirms none.
  - **KPIs**: entries / exits `—` while unknown.
  - **Referral line**: amount `—` with the error, plus a note under the bonus
    KPI: `לא כולל בונוס הפניות — הנתונים לא נטענו`.
  - **Daily chart**: loading / error notes.
- **Referral amount** (settled month) is computed locally:
  `BonusEligibility.continuityAmount` in `lib/bonus-eligibility.js`, counts ×
  100 / 500 / 1,000, paid only when the house was eligible that month. The
  feed's `total` is never read. **Superseded the same day: the referral bonus
  is switched off — see the last section.**
- **Missing figures**: `settledHouseFor_` treats a row without numeric
  `avgDaily` / `treatmentDays` as missing (`הנתונים לא זמינים לבית זה`).
- **`fetchMonthOverview_`** maps a backend `arfoni` row to `efroni`.
- **Untouched**: the running month (every render path unchanged,
  snapshot-tested).

## Allowed Dashboard actions

Only `managersOverview`, `managersHouse` and `occupancySnapshots`. They are
open; every other action requires a key the Managers app does not have. This
fix calls nothing else (asserted in the tests).

## Tests: 178 → 186

`test/app-render.test.js` (+7, scenario: today = 1 Oct 2026):

- Sep 2026 settled view renders admissions, discharges, names, referrals and
  the chart from the `managersHouse&month=2026-09` payload. Efroni at tier 1
  2,000 ₪ + referrals 700 ₪. Pardes at tier 2, with `לא היו יציאות`. No
  «אין נתוני…», no October row, no backend figure, no running-month words.
- A tab opened while September is selected fetches its own payload.
- A fetch failure gives an explicit error state (logs, KPIs `—`, referral
  `—`, KPI note, chart). It is retried on re-select, and only that house is
  retried.
- A wrong-month payload, or one without its activity list, is an error,
  never shown as "none".
- Entries / exits counts are the listed rows, so the KPI and the log always
  agree.
- Keys: `efroni` (never `arfoni`), `pardes`. `arfoni` overview rows and
  payloads map to efroni. Invalid keys and months are never requested.
- An overview row without `treatmentDays` → missing, not `לא זכאי · 0 ₪`.
- Running month on 1 Oct is byte-for-byte unchanged after picking September
  and returning. `state.details` is untouched.

`test/bonus-eligibility.test.js` (+1): `continuityAmount`.

Two existing bonus-picker tests were updated where they pinned the old
behaviour ("no house requests", «אין נתוני הפניות», `—` entries, bonus KPI
without referrals).

## Service worker

`public/sw.js` `ezone-managers-v13` → `v14`. The live `/sw.js` could not be
fetched from the Code session (the sandbox proxy refused the Railway host).
v13 is what `main` ships (Railway deploys `main`; status doc: "SW cache v13"
on Sep 17), so v14 is the next version.

## Referral bonus disabled (decision, 1 Oct 2026)

**Referral bonus disabled by decision (1 Oct 2026); switch: CONTINUITY_BONUS_ENABLED in lib/bonus-eligibility.js.**

Sandra's decision: the referral bonus («בונוס הפניות להמשך טיפול») is **not
paid for now**. Managers get occupancy bonuses only, in the running month and
in finished months.

- **The switch:** `CONTINUITY_BONUS_ENABLED = false` in
  `lib/bonus-eligibility.js`. It lives on the exported object and is read at
  call time. While it is `false`:
  - `continuityAmount` returns `total: 0`;
  - no total includes referrals: house-tab KPI, breakdown total, hero, house
    card, overview KPIs, winners banner, network chart;
  - the quarterly ≥ 2,000 check uses the occupancy tier amount only (it
    always did: `monthlyBonusAmount`).
- **Running month:** it no longer adds the Dashboard's `bonus.continuity.total`.
  Both views now go through one helper, `referralBonus_` in `app.js`, which
  uses the counts and local math only. No backend referral number reaches
  any total or the DOM.
- **UI:**
  - the «בונוס הפניות להמשך טיפול» breakdown line and the running card's
    «הפניות …» extra are not rendered;
  - the «לא כולל בונוס הפניות» note is gone.
- **Kept, so it can be switched back on:** the referral counts are still
  fetched with the month's house payload, and `continuityAmount` is
  unchanged. When re-enabled, a running month pays referrals only once its
  occupancy bonus is secured; a finished month pays them only if the house
  was eligible.
- **Unchanged:** the entries / exits / names fix above.
- **SW:** stays v14.

### Running-month snapshot: the deliberate update

A stored golden snapshot, `test/fixtures/running-month.snapshot.json`, now
pins the whole running-month page: the overview plus the Ramot tab on
8 Sep 2026, with a feed that carries referral counts and a backend referral
total of 1,777. Compared with the same page rendered by the previous commit
(`617a03f`), the **only** differences are:

| Where | Before | After |
|---|---|---|
| House card, running block | `הפניות 1,777 ₪` | (line removed) |
| House tab KPI «מובטח עד כה» | `1,777 ₪` (the backend's total) | `0 ₪` |
| Breakdown total | `1,777 ₪` | `0 ₪` |
| Breakdown | 5 lines, incl. `בונוס הפניות להמשך טיפול … 1,777 ₪` | 4 lines (referral line removed) |

Regenerate it deliberately with `UPDATE_SNAPSHOT=1 npm test`.

### Tests: 186 → 192

- The 4 existing referral tests now switch the flag **on** inside their own
  sandbox and pass unchanged: July settled view; Sep settled view; fetch
  failure plus the note; `continuityAmount`.
- New:
  - the flag is off by default and pays 0;
  - the quarterly check ignores referrals (flag on and off);
  - running month: KPI and breakdown total are the tier only, no referral
    line, and the card has no «הפניות»;
  - settled Sep 2026: totals are occupancy-only, no referral line, no note,
    and entries / exits / names still render;
  - overview KPI, banner, network chart and quarterly marks have no
    referrals (running and settled);
  - the running-month golden snapshot.
