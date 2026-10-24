# Fast reads — saved copies, one shared call, quiet refresh (24 Oct 2026)

## Why

Both apps felt slow. Measured read-only on 24 Oct 2026: every request, even the empty `/api/version`, took
about 240 ms (Railway region far from Israel — fixed by Sandra in Railway). On top of that, the managers
server called the Dashboard Apps Script **live on every read** (`/api/sheets`: overview, house, occupancy;
`/api/work`: `houseData`, `houseCost`, `meetingSummaries`). A saved copy was used only after a failure
(docs/sheets-resilience.md). Each house open therefore waited on a cold Apps Script run (1–3 s, sometimes
much more), and several people opening the same screen made several runs. The coordinators app got this fix on
16 Sep (PR #142/#205); the managers app did not.

## What changed (`lib/read-cache.js`, `server.js`, `public/app.js`, `public/work.js`)

| Case | Server answer | `X-Cache` |
|---|---|---|
| copy ≤ 60 s old | the copy, no Dashboard call | `HIT` |
| copy 60 s … 24 h old | the copy AT ONCE; ONE background refresh starts (concurrent readers share it) | `STALE` |
| `swr=wait` (query on `/api/sheets`, body field on `/api/work`) on a stale copy | joins the refresh, returns the new data | `REFRESHED` |
| same, but the refresh failed | the copy, `X-Cache-Refresh: failed` | `STALE` |
| no usable copy | one shared Dashboard call | `MISS` |

- **Keys** hold role + person + house + op + month. A copy is only ever served back to the same person for the
  same request; a manager's `/api/sheets` reply is still scoped to their own house when served.
- **A write** (`logAdd`, `logUpdate`, `dischargeSet`, `feedbackDone`) always goes live, and on success drops
  that house's copies and the overview's. A read already in flight for that house is disowned, so pre-write
  data is never stored.
- **Errors are never cached.** A failed refresh never overwrites a good copy. A failed first read behaves as before
  (classified error, or the 72 h last-good copy of docs/sheets-resilience.md, `X-Data-Source: cache`).
- `X-Data-Source` stays `live` for HIT / STALE / REFRESHED — the «מוצגים נתונים שמורים — שרת הנתונים לא זמין»
  notice is still only for a real failure.
- **Bounds**: 200 copies, oldest dropped first; in memory only (empty after a restart/redeploy; the first open
  after that is a normal MISS).
- **No new endpoint, env var, secret or dependency.** The Dashboard Apps Script is unchanged.

## Browser

- `/api/sheets` reads: on `X-Cache: STALE` the footer says «מתעדכן…» and the screen reloads quietly after 4 s
  (the copy is fresh by then). At most 3 reloads per minute, so a refresh that keeps failing cannot loop.
- `houseData` (work.js): on a STALE answer ONE follow-up per house joins the refresh (`swr: 'wait'`) and redraws.
  If it fails, the saved copy stays and the footer says «מוצגים נתונים שמורים — העדכון לא הושלם». Never an empty board.

## Logs

`[read-cache] refresh failed class=… status=… ms=…` — never a body, a name, a note or the secret.

## Limits (honest)

- The first read after a deploy/restart, or after more than 24 h, is still a cold Apps Script call.
- A committee the coordinators change can show the previous version for up to a minute (then it refreshes).
- Not changed here: Railway region (Sandra set it), the Dashboard Apps Script's own speed.

Tests: `test/read-cache.test.js` (10), `test/read-cache-server.test.js` (12), `test/stale-repaint.test.js` (5).
