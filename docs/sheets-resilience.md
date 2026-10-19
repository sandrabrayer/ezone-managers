# Read failures: classified errors, last-good cache, Hebrew retry (19 Oct 2026)

## Why

From about 15:00 on 19 Oct 2026 the app showed «שגיאה: upstream_error», and every card
stayed on «טוען…». `GET /api/sheets` (the `managersOverview` / `managersHouse` /
`occupancySnapshots` reads) answered a bare `502 upstream_error` for both a non-JSON reply
and a fetch failure or timeout, so the cause could not be seen. The browser then printed the
raw code.

## Server (`server.js`, `GET /api/sheets`)

Reads use the same classification as `/api/work`, from the shared helpers `workFailure` and
`nonJsonFailure`:

| Case | Status | `error` |
|---|---|---|
| fetch timeout / abort (15 s, unchanged) | 504 | `upstream_timeout` |
| fetch failure (DNS, TLS, reset) | 502 | `upstream_unreachable` |
| HTML page that asks for authorization / consent | 502 | `upstream_auth` |
| any other non-JSON reply | 502 | `upstream_bad_response` |
| JSON `ok:false` / `error`, or a non-2xx status | 502 | `upstream_app_error` |
| JSON `error: "unauthorized"` (secret mismatch) | 503 | `upstream_unavailable` |

The body holds only `{ error }`, with no message, upstream body or endpoint. Each failed read
writes one log line:

```
[sheets] action=managersOverview class=upstream_timeout status=504 ms=15003 served=cache
```

The line never holds a body, a name, the endpoint or the secret. `served` is `cache` (the last
good copy was returned) or `error`.

### Last good copy

- A successful read (2xx, JSON, not `ok:false`, no `error`) is kept in memory.
- **Key**: action + house + month + role + person ID. A copy is only ever served back to the
  same person for the same request. A manager's copy is scoped to their house again when it is
  served, as a live reply is.
- **Bounds**: at most 100 entries, the oldest dropped first. A copy older than 72 hours is not
  served. Copies are lost on a redeploy or restart.
- **On a failed read with a copy**: `200` with the copy, `X-Data-Source: cache` and
  `X-Data-Cached-At: <ISO time>`. A live reply has `X-Data-Source: live`. All replies stay
  `Cache-Control: no-store`.
- A failed reply never overwrites a good copy.
- **No new endpoint, env var, secret or dependency.** `APPS_SCRIPT_URL` and the Apps Script
  deployment are unchanged.

## Browser (`public/app.js`, `index.html`, `styles.css`)

- `fetchJson` maps every code to Hebrew (`SHEETS_ERRORS`). Raw codes, HTTP numbers and upstream
  text never reach the screen. A browser network error → «אין חיבור לאינטרנט — בדקו את החיבור.»
- **Overview, no copy**: «שגיאה בטעינת הנתונים: <reason>» with a «נסו שוב» button (role=alert,
  RTL, 16px, 44px target). It replaces the old `innerHTML` with `err.message`, which was also an
  XSS sink.
- **House tab, no copy**: «שגיאה בטעינת נתוני הבית: <reason>» + «נסו שוב».
- **Saved data**: `#staleNotice` (role=status) shows «מוצגים נתונים שמורים מ־<d/m HH:MM> — שרת
  הנתונים לא זמין כרגע.» with «נסו שוב». The time is the oldest copy on screen, Israel time.
  - It appears when the server answers from its cache.
  - It also appears when a 60-second refresh fails and the page keeps its last good overview or
    house payload, instead of wiping the cards.
  - It hides by itself once the reads are live again.
- Text-only DOM (`el_`, `textContent`). SW cache v31 → v32.

## Tests

- `test/sheets-proxy.test.js`: every class, with and without a copy; the log line format and
  that nothing leaks; the 15 s timeout; per-request / per-person isolation; manager scoping of
  a copy; the 72-hour age limit; the 100-entry bound; a failed reply not overwriting a copy.
- `test/app-render.test.js`: Hebrew for every code with no raw code; the overview and house
  error boxes with a working «נסו שוב»; the saved-data notice on a cached reply and on a failed
  refresh, hidden once live.

## Backend review (E-Zone-Dashboard #251–#256, read-only)

The six PRs merged 14:52–15:12 on 19 Oct. None of them changed `managersOverview_` /
`managersHouse_`, the feed gate or the response shape. `handle_` still catches exceptions into
JSON.

#255 (`personId`) appends a 14th Patients column. The read path `readPatientsForBonus_` goes
through `getOrCreateSheet_`, which writes the new header once on the first read after the
deploy. It would throw on every read only if the sheet is exactly 13 columns wide; that shows
as `upstream_app_error`, not HTML.

Four Apps Script deploys ran back to back around 15:00. A failed deploy or lost authorization
would show as `upstream_auth` / `upstream_bad_response`. A slow cold start would show as
`upstream_timeout`. The new log line tells which one it is.
