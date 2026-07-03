# ezone-managers

Read-only, mobile-first PWA dashboard for house managers in the **איזון (E-Zone)** psychiatric residential network.

It reads data via the existing E-Zone Apps Script endpoints — it never writes anything.

## Endpoints consumed

- `GET /api/sheets?action=managersOverview` — all 4 houses + bonus calculations
- `GET /api/sheets?action=managersHouse&key=<houseKey>` — full detail for one house

Both are proxied through `server.js` to the E-Zone Apps Script `/exec` endpoint.

The endpoint URL is configured via the `APPS_SCRIPT_URL` env var. It is **required** — there is no hardcoded fallback, and the server refuses to start if it is not set.

## Local

```bash
npm install
npm start
```

Open http://localhost:3000

## Deploy

Procfile + `railway.json` included — push to Railway and it runs `node server.js` on port `$PORT`.
