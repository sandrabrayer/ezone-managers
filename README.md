# ezone-managers

Read-only, mobile-first PWA dashboard for house managers in the **איזון (E-Zone)** psychiatric residential network.

It reads data via the existing E-Zone Apps Script endpoints — it never writes anything.

## Endpoints consumed

- `GET /api/sheets?action=managersOverview` — all 4 houses + bonus calculations
- `GET /api/sheets?action=managersHouse&key=<houseKey>` — full detail for one house

Both are proxied through `server.js` to the E-Zone Apps Script `/exec` endpoint.

The endpoint URL is configured via the `APPS_SCRIPT_URL` env var. It is **required** — there is no hardcoded fallback, and the server refuses to start if it is not set.

## Auth (ezone-staffing standard)

All data access requires login. `POST /api/login` with `{ "pin": "..." }`
returns an HMAC session token; the frontend sends it as
`Authorization: Bearer <token>` on `GET /api/sheets`. Login is rate-limited
(8 attempts / 15 min per IP). Tokens expire after `SESSION_DAYS` (default 7).

Required env vars (fail-closed — the server refuses to start without them):

| Var | Notes |
|---|---|
| `APPS_SCRIPT_URL` | Dashboard Apps Script `/exec` URL |
| `APP_PIN` | Login PIN, up to 6 characters (input maxlength is 6) |
| `SESSION_SECRET` | Random string, **minimum 32 chars** (e.g. `openssl rand -hex 32`) |
| `SESSION_DAYS` | Optional, token lifetime in days (default 7) |

Server-only `lib/auth.js` is never served over HTTP; only
`/lib/bonus-eligibility.js` is exposed to the browser.

## Local

```bash
npm install
npm start
```

Open http://localhost:3000

## Deploy

Procfile + `railway.json` included — push to Railway and it runs `node server.js` on port `$PORT`.
