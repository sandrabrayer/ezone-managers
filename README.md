# ezone-managers

Read-only, mobile-first PWA dashboard for house managers in the **איזון (E-Zone)** psychiatric residential network.

It reads data via the existing E-Zone Apps Script endpoints — it never writes anything.

## Endpoints consumed

- `GET /api/sheets?action=managersOverview` — all houses (currently 5) + bonus calculations
- `GET /api/sheets?action=managersHouse&key=<houseKey>` — full detail for one house

Both are proxied through `server.js` to the E-Zone Apps Script `/exec` endpoint.

The endpoint URL is configured via the `APPS_SCRIPT_URL` env var. It is **required** — there is no hardcoded fallback, and the server refuses to start if it is not set.

## Access — the app is open

**No password, no access key, no cookie, no login screen — in any
circumstance.** Anyone who opens the URL gets the whole app, **including the
patient names in each house's entry/exit log**. That exposure is a deliberate
decision by the app owner (September 12, 2026), not an oversight: treat the
deployment URL as the only thing between the feed and the public, and don't
add a gate back without asking. Background: `docs/open-access.md`.

What is still enforced:

- **Per-IP rate limit** on `/api/sheets`, 300 / 15 min — nothing gates the
  proxy any more, so without it one client could drain the shared dashboard
  Apps Script's quota and take Dashboard, Managers and Therapists down with it.
- **`X-Robots-Tag: noindex, nofollow`** on every response and `robots.txt`
  with `Disallow: /`, so the open URL is at least not indexed.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, a CSP, and HSTS in production.
- The Apps Script URL stays **server-side**: never sent to a browser and never
  echoed in an error body (a `fetch` URL-parse failure would otherwise return
  it verbatim).
- Patient names are **HTML-escaped** before reaching `innerHTML` — the
  Patients sheet is hand-edited, so this is an XSS fix, not cosmetics.

Env vars:

| Var | Notes |
|---|---|
| `APPS_SCRIPT_URL` | **Required** (fail-closed). Dashboard Apps Script `/exec` URL — the only secret this app holds |

`APP_PIN`, `SESSION_SECRET`, `SESSION_DAYS` and `FULL_VIEW_KEY` are all unused
and can be deleted.

There is no static mount on `lib/`; only `/lib/bonus-eligibility.js` is
exposed to the browser. The bonus VIEW module (`public/bonus-view.js` — month
labelling, wording, days-so-far) lives in `public/` and is served by the
static mount; see `docs/bonus-month-labelling.md`.

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

The suite covers open access — every route works with no key and no cookie,
patient names come through, nothing sets a cookie, `?key=` is an ordinary
ignored param, the rate limit, security headers, `robots.txt`, and no Apps
Script URL in any response or 502 body (`test/access.test.js`) — the
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
