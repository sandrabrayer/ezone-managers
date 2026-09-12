# Open access — no password, no key

**Current as of September 12, 2026.** This supersedes two earlier models: the
shared-PIN login (July 5, 2026) and the short-lived `?key=` full-view link
(merged and then removed the same day, PR #25 → PR #26).

## The model, in one line

**The app is open. Anyone who knows the URL sees everything in it, including
patient names.** There is no password, no access key, no cookie and no login
screen — and there is no circumstance in which one appears.

## What a visitor sees

Everything the Apps Script returns, rendered:

- Network KPIs: houses with a secured bonus, active patients, the previous
  month's settled bonus, day of month.
- Per house: manager name, type, patients now vs capacity, treatment days,
  tier reached, bonus amounts, the quarterly window, the full bonus breakdown,
  and the daily occupancy chart.
- **Each house's entry/exit log: the date and the patient's name.** `name`
  comes from the Patients sheet via the dashboard Apps Script
  (`readPatientsForBonus_` → `computeMonthStats_`), so an entry row states
  that a named person was admitted to a named house on a given date, and an
  exit row states when they left.

The overview prefetches all five houses' details on every load, so the whole
network's activity log reaches the browser on first paint.

`GET /api/sheets?action=…` is the same data, unauthenticated, as JSON.

### This was a deliberate decision

The patient names in the feed were identified, documented and deliberately
left exposed by the app owner on September 12, 2026, after a version that
redacted them had already been built and merged. Anyone changing this file
should know they are looking at a choice, not an oversight. Two things follow:

- **Treat the deployment URL as the only thing standing between the feed and
  the public.** It is not secret in any meaningful sense — it is a Railway
  hostname, it sits in browser history on every manager's phone, and
  `robots.txt` plus `noindex` only stop well-behaved crawlers.
- **Do not "fix" this by adding a login.** If the exposure is ever
  reconsidered, that is a decision for the app owner, and the git history
  holds a working redaction implementation to restore (PR #25:
  `lib/redact.js`, server-side, plus a `מוסתר` label in the UI).

## What protects what

| Concern | Status |
|---|---|
| Who may read the data | **Nothing.** Open to anyone with the URL |
| Patient names | **Shown** to everyone |
| Search-engine indexing | `X-Robots-Tag: noindex, nofollow` on every response + `robots.txt` `Disallow: /` |
| Apps Script quota abuse | Per-IP rate limit on `/api/sheets`, 300 per 15 min |
| The Apps Script `/exec` URL | Server-side only — never sent to a browser, never echoed in an error body |
| Clickjacking / sniffing / referrer leaks | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, CSP, HSTS in production |
| Markup injected via a patient name | `escapeHtml_` before `innerHTML` |

### The escape is not cosmetic

`public/app.js` → `activityRowHtml` escapes `item.name` before it reaches
`innerHTML`. The Patients sheet is hand-edited, so without the escape a name
typed into a spreadsheet cell becomes markup executing in every manager's
browser. This is an XSS fix and is independent of who may see the name —
`test/ui-guards.test.js` and `test/app-render.test.js` both guard it.

### Why the rate limit still matters

Nothing gates `/api/sheets` any more, so without a limit a single client could
loop it and exhaust the shared dashboard Apps Script's quota — taking down
Dashboard, Managers and Therapists together, since all three read the same
script. 300 requests per 15 minutes per IP is far above normal use (the app
polls the overview every 60s and fetches up to six house payloads on first
paint).

### Why `noindex` still matters

An open URL that a search engine indexes is an open URL that people find
without being told it exists. The header covers every response including the
API; `robots.txt` covers crawlers that read it before fetching.

## Environment variables

| Var | Status | Notes |
|---|---|---|
| `APPS_SCRIPT_URL` | **required** | Dashboard Apps Script `/exec` URL. The only secret this app holds; server-to-server only |
| `FULL_VIEW_KEY` | **unused** | The key model is gone. Delete it |
| `APP_PIN` | **unused** | The login is gone. Delete it |
| `SESSION_SECRET` | **unused** | No sessions exist. Delete it |
| `SESSION_DAYS` | **unused** | No cookie to expire. Delete it |

The server refuses to start in production without `APPS_SCRIPT_URL`
(fail-closed). Nothing else is required.

## Apps Script

**Unchanged throughout.** The managers endpoints never authenticated a caller
— the proxy forwards only `action`, `house` and `month`, no secret and no
token. The unguessable `/exec` URL remains the only thing gating the backend
feed directly, and it stays server-side.

## Tests

`test/access.test.js` — every route works with no key and no cookie, patient
names come through, nothing sets a cookie, a `?key=` param is an ordinary
ignored query param, the rate limit, the security headers, `robots.txt`, and
no Apps Script URL in any response or 502 body. `test/ui-guards.test.js` —
no login UI, no redaction machinery, and the name escape is still in place.
`test/app-render.test.js` — names render newest-first with their dates, an
upstream name is escaped, a nameless row falls back to the dash.
