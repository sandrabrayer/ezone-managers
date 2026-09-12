# ezone-managers

Read-only, mobile-first PWA dashboard for house managers in the **איזון (E-Zone)** psychiatric residential network.

It reads data via the existing E-Zone Apps Script endpoints — it never writes anything.

## Endpoints consumed

- `GET /api/sheets?action=managersOverview` — all houses (currently 5) + bonus calculations
- `GET /api/sheets?action=managersHouse&key=<houseKey>` — full detail for one house

Both are proxied through `server.js` to the E-Zone Apps Script `/exec` endpoint.

The endpoint URL is configured via the `APPS_SCRIPT_URL` env var. It is **required** — there is no hardcoded fallback, and the server refuses to start if it is not set.

## Access — open app, private full view

**There is no password and no login screen.** Anyone who opens the app gets
it. What differs is whether the payload carries patient names:

- **Anonymous (everyone).** Every bonus figure, KPI, chart and entry/exit
  **count and date**. Patient names are stripped **server-side**
  (`lib/redact.js`) before the response leaves the process; each activity row
  arrives flagged `nameHidden` and renders as the Hebrew label `מוסתר`.
- **Full view.** Opening `https://<host>/?key=<FULL_VIEW_KEY>` once sets an
  httpOnly cookie (an HMAC token keyed by `FULL_VIEW_KEY`) and redirects to
  the same page without `?key=`, so the secret does not stay in the URL.
  Patient names are then included. A wrong or missing key is a bare `404` —
  nothing hints that a key exists. Rotating `FULL_VIEW_KEY` invalidates every
  cookie already handed out.

Rate limits, per IP: `/api/sheets` 300 / 15 min, key check 10 / 15 min. Every
response carries `X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a CSP
(HSTS in production); `robots.txt` disallows everything.

Required env vars (fail-closed — the server refuses to start without them):

| Var | Notes |
|---|---|
| `APPS_SCRIPT_URL` | Dashboard Apps Script `/exec` URL. Server-to-server only — never sent to a browser, never echoed in an error |
| `FULL_VIEW_KEY` | Unlocks the full view, **minimum 32 chars** (e.g. `openssl rand -hex 32`). Also signs the cookie, so rotating it revokes outstanding links |
| `SESSION_DAYS` | Optional, cookie lifetime in days (default 7) |

`APP_PIN` and `SESSION_SECRET` are no longer used and can be deleted.

Server-only `lib/auth.js` and `lib/redact.js` are never served over HTTP; only
`/lib/bonus-eligibility.js` is exposed to the browser. The bonus VIEW module
(`public/bonus-view.js` — month labelling, wording, days-so-far) lives in
`public/` and is served by the static mount; see `docs/bonus-month-labelling.md`.
Full write-up of the access model: `docs/open-access-and-full-view-key.md`.

## Bonus history

A **"חודש בונוס"** picker on the overview and on every house tab lists the
running month (default) and every finished month back to May 2026, the
quarterly anchor. A finished month renders the whole page settled
(`יולי 2026 — סופי`: tier reached, amount, gate result, quarterly window),
using only the existing `managersOverview&month=YYYY-MM` endpoint, cached
per month in memory. `חזרה לחודש נוכחי` restores the live view. See
`docs/bonus-month-labelling.md` → "Bonus history month picker".

## Local

```bash
npm install
npm start
```

Open http://localhost:3000

## Tests & CI

```bash
npm ci
npm test   # node --test, no env vars or network needed
```

The suite covers the HMAC cookie-token and key-compare unit logic
(`test/auth.test.js`), patient-name redaction incl. nested/cyclic payloads and
the non-JSON fail-closed path (`test/redact.test.js`), access integration —
the app works with no login, the anonymous body carries no patient name, the
`?key=` handshake, wrong key → bare 404, forged/stale cookies, both rate
limits, security headers, `robots.txt`, no secret in any response, and
`lib/auth.js` / `lib/redact.js` never served (`test/access.test.js`) — the
`/api/sheets` proxy against a mocked upstream (`test/sheets-proxy.test.js`),
the canonical bonus rules — tiers, fixed threshold×30 gate, secured floor,
quarterly 5,000 ₪ (`test/bonus-eligibility.test.js`) — the bonus VIEW rules
(month labelling, settled vs running wording, projection vs actual, tier
badge, single days-so-far: `test/bonus-view.test.js`), the real `app.js`
render paths in a `vm` sandbox with a minimal fake DOM (`test/app-render.test.js`
— no backend bonus figure reaches the DOM, KPI = hero = bar = card, the
occupancy-history month picker leaves every bonus figure unchanged, see
`docs/occupancy-history-view.md`, and the bonus-history month picker renders
a finished month settled-only while the running month stays byte-for-byte
unchanged), and static UI guards (`test/ui-guards.test.js`).

**Tests never call the live Apps Script backend**: all upstream HTTP is mocked
in-process and all secrets are dummy values set inside the test files.

CI: `.github/workflows/test.yml` runs the suite on every pull request and
every push to `main` (Node 18/20/22).

## Deploy

Procfile + `railway.json` included — push to Railway and it runs `node server.js` on port `$PORT`.
