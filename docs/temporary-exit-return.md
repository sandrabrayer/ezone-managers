# Temporary exit and return — the stay is not broken (15 Oct 2026)

**CEO rule:** a patient who leaves temporarily (appointment, meeting, short
leave) and comes back must NOT break the stay. Their days count toward
treatment days and the average daily occupancy, with no double counting and no
day-count reset.

## Where it is implemented

| Layer | What |
|---|---|
| Dashboard Apps Script (raw data) | `computeMonthStats_`, `stayChains_` and `houseData` (E-Zone-Dashboard PR #231). Constants: `READMIT_WINDOW_DAYS = 7`, `STAY_CONTINUITY_FROM_MONTH = '2026-10'`. |
| Managers `lib/bonus-eligibility.js` | **Unchanged.** It still receives `avgDaily` / `treatmentDays` / `dailyChart` as raw data. No frontend math was needed. |

## Rule

- **Temporary exit**: the same patient (same house + same name) re-admitted
  within **7 days** of the exit. A later return is a new stay.
- **No double counting**: a patient counts at most once per day. A same-day
  return used to count that day twice.
- **Gap days** count only if the bed was held. The Patients sheet records no
  bed-held fact, so gap days are **not** counted. This is a documented
  assumption, and the conservative reading.
- **No reset**: «מטופלים בבית» shows the first admission date, and «יום N» runs
  from it. A return is not listed under «נקלטו החודש».
- **Settled months are untouched**: the rule applies from October 2026 (the
  running month). September 2026 and earlier keep their original computation
  byte-for-byte, so no settled bonus changes.
- **Audit**: the Dashboard's editor-run, read-only `auditTemporaryExitsNow()`
  lists every case for the previous and current month, with initials only.
  Any settled-month error it finds is reported, never applied; changing a
  settled month needs Sandra's decision.

## Expected discharge date

The «שחרור משוער» key is house + patient + admission date. Because a return
keeps the stay's first admission date, a date set before a temporary exit is
still shown after the return.
