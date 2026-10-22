# Coordinators feed — direct, read-only, per house (October 22, 2026)

The Managers server reads three things straight from the **Coordinators app**, server to server:

| Kind | Where it shows | Before |
|---|---|---|
| `committees` | «הבית היום» card «ועדות קרובות» + the «ועדות» sub-tab | via the Dashboard Apps Script (still the fallback) |
| `summaries` | «סיכומי ישיבות» sub-tab | via the Dashboard Apps Script (still the fallback) |
| `shiftUpdates` | «עדכון משמרת» sub-tab | not available |

Why direct: the Dashboard hop drops the new committee fields (`status`, `notes`) and has no shift
updates. The coordinators app already owns the data, its house scoping and its encryption at rest.

## Flow

```
browser ──/api/work (session)──▶ managers server ──POST /api/managers-feed (Bearer secret)──▶ coordinators server ──▶ Apps Script / read model
```

- The **browser never calls the feed** and never sees its URL or secret.
- The house is always the one the managers server decided from the session (a manager: their own
  house; an admin: the house they opened). A forged `house` in the browser body is ignored.
- Answers are re-checked here (`lib/coord-feed.js`): the echoed house must match, only known keys
  are kept, every string is bounded. Anything else → `bad_response`.

## Configuration (Railway → ezone-managers → Variables)

| Variable | Value |
|---|---|
| `COORDINATORS_FEED_URL` | `https://ezone-coordinators.up.railway.app` (https only) |
| `COORDINATORS_FEED_SECRET` | the SAME random value (32+ characters) as the coordinators' `MANAGERS_FEED_SECRET` |

**Fail-closed.** Either variable missing, a non-https URL, credentials in the URL, or a secret shorter
than 32 characters → the feed is **off**: no request is ever made. Committees and summaries keep
coming from the Dashboard; «עדכון משמרת» shows «עוד לא מחובר». The app still starts (the feed is
optional).

## `/api/work` behaviour

- `op: 'houseData'` — the Dashboard read and the committees feed run in parallel. A feed answer
  replaces `committees` (`source: 'coordinators'`). A failed feed keeps the Dashboard copy; with no
  copy at all → `{ available: false, reason: 'feed_down' }` (an honest message, never an empty list).
- `op: 'meetingSummaries'` — the feed first; on any failure the Dashboard path as before.
- `op: 'shiftUpdates'` `{ upTo? }` — feed only; `{ ok, house, from, upTo, updates }` or
  `{ ok: false, error }`. A bad `upTo` → 400 `bad_date`.
- Same session, rate limit and no-store as every `/api/work` call. All three are reads.

## Logs

`[feed] kind=… house=… outcome=ok|<code> count=… ms=…` — never a name, a note or the secret.

## Tests

`test/coord-feed.test.js` (config, request, guards, merge for every house incl. pardes, house pinning,
fallbacks, alert window).
