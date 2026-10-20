# Access — a personal code per person (13 Oct 2026)

**Replaces the open-app model of 12 Sep 2026.** The Managers app became a work
tool holding private staff conversations, unusual events
and (stage 3) manpower costs, so Sandra decided: every person logs in with
their own code.

| Who | Sees |
|---|---|
| A house manager | **Only their own house**: its «הבית היום» and «בונוס» sub-tabs and its work tabs. The network tabs («הבית היום» of all houses, «בונוס» overview) and the other houses' tabs are hidden, and the server refuses or filters them. |
| Admin (Sandra, Ron) | Every house and the network overview. |
| Staff talks («שיחות עם עובדים») | Only the manager who wrote them, and the admins. |

## How it works

- **Login = username + personal code (14 Oct 2026).** Both must belong to the same person.
  - The username is the person's `name` in `MANAGER_ACCESS` (for example «אורן»). An optional
    Latin `user` (3–20 characters of a-z 0-9 . _ -) also works.
  - Case and surrounding spaces are ignored, and usernames must be unique.
  - A wrong pair always gets the same answer («שם משתמש או קוד שגויים»), so a failed login
    never tells which part was wrong.

- **Codes** live in the Railway variable `MANAGER_ACCESS` (JSON):
  `[{"id":"person-oran","code":"…","name":"אורן","house":"ramot"}, {"id":"person-sandra","code":"…","name":"סנדרה","user":"sandra","role":"admin"}, …]`.
  (`user` is optional).
  Codes: 6–12 digits, unique. Every person also needs a unique immutable `id`
  (3–64 ASCII letters/digits, `_` or `-`, starting with a letter/digit).
  Keep the ID when changing a name or code; never reassign it to another person. Validated at start-up; anything odd stops the process
  (Railway keeps the previous deployment serving).
- **Session**: after a correct code the server sets `mgr_session` — HttpOnly,
  SameSite=Strict, Secure in production, 30 days. It is signed (HMAC-SHA256)
  with a key derived from `MANAGERS_WORK_SECRET`. It never contains the code
  itself, only a fingerprint and the stable ID; changing or removing someone's code in
  `MANAGER_ACCESS` logs them out everywhere.
- **Login** is rate-limited: 10 attempts per 15 minutes per IP.
- **Every data route needs the session** (`/api/me`, `/api/sheets`,
  `/api/work` → 401 without it). The shell (HTML/CSS/JS) is public — it holds
  no data.
- **House scoping is server-side**: for a house manager, `managersOverview`
  and `occupancySnapshots` are filtered to their house and network totals are
  dropped; `managersHouse` for another house → 403; `/api/work` always uses
  the manager's own house whatever the browser sends.
- **Work tool** (`/api/work`, JSON only — a cross-site form cannot send it):
  the server calls the Dashboard Apps Script action `managersWork` by POST,
  adding `MANAGERS_WORK_SECRET` and the house / role / name / actor ID it decided. The
  browser never sees the secret or the Apps Script URL.
- **Writes** (`logAdd`, `logUpdate`, `dischargeSet`) have an extra per-IP
  bucket, 60 / 15 min. `dischargeSet` (expected discharge date, 15 Oct 2026)
  is shape-checked by the server and re-validated by the Dashboard. See
  `docs/expected-discharge.md`.
- Kept from before: the per-IP rate limit on proxied calls, `X-Robots-Tag:
  noindex, nofollow`, `robots.txt`, CSP `script-src 'self'`, no secret in any
  response or error body.

## Setting it up / changing codes

1. Railway → ezone-managers → Variables:
   - `MANAGERS_WORK_SECRET` — a long random value (24+ characters).
   - `MANAGER_ACCESS` — the JSON above; Sandra and Ron each need a separate
     `role: "admin"` entry. Each manager needs exactly their authorized house.
   - `NODE_ENV=production` — enables Secure cookies and HSTS.
   - `APPS_SCRIPT_URL` — the compatible protocol-2 deployment.
2. Dashboard Apps Script → Project Settings → Script Properties:
   `MANAGERS_WORK_SECRET` — **the same value**.
3. To give someone a new code or remove one, edit `MANAGER_ACCESS` in
   Railway; the app redeploys on its own.

## Protocol 2 privacy and readiness (14 Oct 2026)

The three read actions also require the shared secret in a JSON POST body.
GET, a query-string secret, a missing secret and a wrong secret are refused in
Apps Script before any sheet read/write, independently of `PROXY_SECRET_MODE`.
Both servers scope manager data. Cross-house intake bonuses retain their counts,
but another house's patient details are excluded from the manager's response.

New log rows append `authorId` after all existing columns. Author names are
for display only. A same-named account cannot read private notes or modify
someone else's records. The backend returns `canEdit`; the UI follows it.
**Historical rows without `authorId` remain available to admins:** private staff
talks are admin-only, and only admins may modify any legacy row. There is no
automatic name-based reassignment. Any migration needs separately verified
record-to-person ownership. Existing rows and cells are not rewritten.

`GET /healthz` returns 200 only after an authenticated, data-free
`managersWork / capabilities` probe confirms protocol 2 and all required
capabilities. Missing configuration, a different secret, an old backend, an
upstream error or an 8-second timeout returns 503. Results are cached for ten
seconds and concurrent probes share a request. Railway checks this endpoint
with a 120-second activation timeout. A failed candidate must not be promoted.
This confirms the protocol and secret; it does **not** prove that production
user-to-house assignments are correct or that Sheets writes have succeeded.

See [the coordinated rollout](managers-hardening-rollout.md). Old sessions
lack an ID and require a fresh login after activation. Keep all codes and
secrets in their existing secure configuration; never paste them into a PR.
