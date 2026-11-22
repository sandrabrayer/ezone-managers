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

## Optional view-only capability (MGR-SEC-02, branch draft 21 Nov 2026)

A configured account may have `"readOnly": true` in its existing `MANAGER_ACCESS`
entry. This is an **optional, strict boolean**; omitted or false preserves
current write permissions. No production account or Railway variable is changed
by this patch.

- House visibility remains role-scoped: an ordinary manager sees their assigned
  house only; an admin can see the authorized network.
- The server checks the current access entry on **every** request. It rejects
  any `/api/work` operation not explicitly listed as a read with HTTP 403
  `read_only`, before contacting the Dashboard. Explicit reads: `houseData`,
  `houseCost`, `houseStaffCost`, `meetingSummaries`, `meetings`,
  `shiftUpdates`. Business writes including `meetingReport`, `logAdd`,
  `logUpdate`, `dischargeSet`, `feedbackDone` are always denied.
- UI hides report buttons, expected-discharge editing, employee/family talk
  forms and follow-up completion for view-only users. The server guard is the
  security boundary; hiding controls is only a usability convenience.
- **Individual employee cost privacy:** a `readOnly: true` account sees
  aggregated house cost/budget but, by default, `houseStaffCost.staff.workers`
  and named `ending.people` are redacted **in the server JSON**, not merely
  hidden in the HTML. Such an account cannot run worker-level salary
  simulations. If independently authorized, a strictly boolean
  `"staffCostDetails": true` may be specified in that same existing
  account's configuration by an administrator only after explicit approval.
  Current writable managers keep their pre-existing budget/simulation workflow.
  This does not by itself audit which currently configured managers should
  have individual payroll visibility; that decision remains a release gate.

Synthetic automated tests are in `test/read-only-workflows.test.js`.
Browser/production UAT, live house assignments, and sensitive salary access
remain separate release gates. No merge, deploy, real account change, or data
migration is included.

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
