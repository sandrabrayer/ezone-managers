# Open access + the private full-view key

**Shipped September 12, 2026.** Replaces the shared-PIN login (July 5, 2026).

## What changed and why

Staff had to type a shared PIN to open a **read-only** bonus dashboard. The
PIN protected nothing that a password is good at protecting: it was one code
for everybody, the token it minted carried no identity (`managers:<expiry>`),
and every holder saw all five houses. It was friction, not access control.

It could not simply be deleted, though, because the feed carries patient
names. `GET /api/sheets?action=managersHouse` returns

```json
"activity": [{ "date": "2026-09-03", "kind": "entry", "name": "<patient name>" }]
```

and `name` there is a patient's name straight from the Patients sheet
(dashboard Apps Script → `readPatientsForBonus_` → `computeMonthStats_`),
paired with their admission date, discharge date and house. The overview
prefetches all five houses' details on every load, so those names reached the
browser even without opening a house tab.

So the app is now **open with the patient names removed**, and the names live
behind a private link.

## The two views

| | Anonymous (everyone) | Full view (`?key=`) |
|---|---|---|
| How you get it | just open the app | open `https://<host>/?key=<FULL_VIEW_KEY>` once |
| Login screen | none, ever | none, ever |
| Bonus figures, KPIs, charts, tier tracks | yes | yes |
| Entry/exit **counts, dates, kinds** | yes | yes |
| Entry/exit **patient names** | **no** — each row reads `מוסתר` | yes |

Nothing else differs. There is no "log in" affordance in either mode, and the
anonymous view is the app as staff know it minus two columns of names.

### Why `מוסתר` and not a hidden card

The redacted rows keep their dates, so the card still answers "how many came
in, and when". A removed card would lose that. A bare `—` was rejected because
that is what the app already renders when the *sheet* has no name — the label
must say *withheld*, not *missing*. `public/app.js` → `activityRowHtml`
renders `<span class="log-name is-redacted">מוסתר</span>` (muted italic).

## How the key works

1. A manager opens `https://<host>/?key=<FULL_VIEW_KEY>`.
2. The server rate-limits the check (10 per 15 min per IP), compares the key
   in constant time, and on a match sets an **httpOnly** cookie `ezm_full`
   holding an HMAC token **keyed by `FULL_VIEW_KEY`** (`lib/auth.js`).
3. It then **302s to the same path without `?key=`**, so the secret does not
   linger in history, bookmarks or a screenshot.
4. Later requests carry the cookie; `/api/sheets` skips redaction for them.

Consequences worth knowing:

- **Rotating `FULL_VIEW_KEY` in Railway invalidates every cookie already
  issued** — the token is signed with the key itself. That is the revocation
  mechanism: change the variable, redeploy, hand out the new link.
- The raw key is **never** the cookie value, is **never** forwarded to the
  Apps Script (it is consumed before the proxy runs), and is **never** in any
  response body.
- A wrong key, a rate-limited check and an unknown path are all the **same
  bare `404 Not Found`**. Nothing reveals that a key exists.
- The cookie expires after `SESSION_DAYS` (default 7), after which the manager
  re-opens the link. A stale or forged cookie silently degrades to the
  anonymous view — never an error screen.

## Redaction is server-side and fails closed

`lib/redact.js` strips names from the upstream body **before it leaves the
server**. Two independent rules run over the whole payload, so a backend that
renames or moves the array still gets redacted:

1. any object shaped like an activity row (`kind` of `entry`/`exit`);
2. every item of any array under an `activity` key, whatever its shape.

If the upstream body **cannot be parsed as JSON** (an Apps Script HTML error
page, say), the anonymous view returns `502 upstream_error` rather than
passing bytes through that cannot be proven name-free. The full view still
passes such bodies through unchanged.

A house's `name` and its `manager` are staff labels, not patient data, and are
deliberately left alone.

## Other hardening in the same change

- **Security headers on every response** (there were none): `X-Robots-Tag:
  noindex, nofollow`, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` (which also stops a `?key=` link leaking via
  `Referer`), a CSP, and HSTS in production. The CSP is `script-src 'self'`,
  so the service-worker registration moved out of `index.html` into
  `public/sw-register.js`. `style-src` still allows inline attributes — the
  chart render paths generate `style="height:…%"`.
- **`public/robots.txt`** with `Disallow: /`.
- **Per-IP rate limits** on `/api/sheets` (300 / 15 min — the app polls every
  60s and fetches up to six house payloads on first paint) and on the key
  check (10 / 15 min). The old limiter only covered `/api/login`, which no
  longer exists; without this the open proxy could be used to drain the Apps
  Script quota.
- **`err.message` is no longer echoed on 502.** A URL-parse failure inside
  `fetch` produces `Failed to parse URL from <APPS_SCRIPT_URL>`, which would
  have handed the Apps Script URL to any caller. The detail is logged
  server-side; the client gets `{"error":"upstream_error"}`.
- `public/app.js` **escapes** the patient name before it reaches `innerHTML`
  (it was interpolated raw — a name typed into the sheet could inject markup).

## Environment variables

| Var | Status | Notes |
|---|---|---|
| `APPS_SCRIPT_URL` | **required** | Dashboard Apps Script `/exec` URL. Server-to-server only; never sent to a browser |
| `FULL_VIEW_KEY` | **required, new** | ≥32 chars. Unlocks the full view; also signs the cookie, so rotating it revokes every outstanding link |
| `SESSION_DAYS` | optional | Cookie lifetime in days (default 7) |
| `APP_PIN` | **unused** | The login is gone. Delete it |
| `SESSION_SECRET` | **unused** | The cookie is keyed by `FULL_VIEW_KEY`. Delete it |

The server refuses to start without `APPS_SCRIPT_URL` or a `FULL_VIEW_KEY` of
at least 32 characters (fail-closed, production only).

## Apps Script

**Unchanged.** The managers endpoints never authenticated a caller — the proxy
sends only `action`, `house` and `month`, no secret and no token. The
unguessable `/exec` URL remains the only thing gating the backend feed, and it
stays server-side. There was therefore no session token to mint silently, as
logistics PR #110 had to do.

## Tests

`test/redact.test.js` (redaction rules, incl. nested and cyclic payloads and
the non-JSON fail-closed path), `test/access.test.js` (open app, anonymous
body carries no patient name, the key handshake, wrong key → bare 404, forged
and stale cookies, both rate limits, headers, robots.txt, no secret in any
response), plus login-removal guards in `test/ui-guards.test.js` and
`מוסתר` / escaping render tests in `test/app-render.test.js`.
