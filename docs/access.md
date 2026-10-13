# Access — a personal code per person (13 Oct 2026)

**Replaces the open-app model of 12 Sep 2026.** The Managers app became a work
tool holding family-call notes, private staff conversations, unusual events
and (stage 3) manpower costs, so Sandra decided: every person logs in with
their own code.

| Who | Sees |
|---|---|
| A house manager | **Only their own house**: its bonus page and its work tabs. The network overview and the other houses' tabs are hidden, and the server refuses or filters them. |
| Admin (Sandra, Ron) | Every house and the network overview. |
| Staff talks («שיחות עם עובדים») | Only the manager who wrote them, and the admins. |

## How it works

- **Codes** live in the Railway variable `MANAGER_ACCESS` (JSON):
  `[{"code":"…","name":"אורן","house":"ramot"}, {"code":"…","name":"סנדרה","role":"admin"}, …]`.
  6–12 digits, unique. Validated at start-up; anything odd stops the process
  (Railway keeps the previous deployment serving).
- **Session**: after a correct code the server sets `mgr_session` — HttpOnly,
  SameSite=Strict, Secure in production, 30 days. It is signed (HMAC-SHA256)
  with a key derived from `MANAGERS_WORK_SECRET`. It never contains the code
  itself, only a fingerprint; changing or removing someone's code in
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
  adding `MANAGERS_WORK_SECRET` and the house / role / name it decided. The
  browser never sees the secret or the Apps Script URL.
- Kept from before: the per-IP rate limit on proxied calls, `X-Robots-Tag:
  noindex, nofollow`, `robots.txt`, CSP `script-src 'self'`, no secret in any
  response or error body.

## Setting it up / changing codes

1. Railway → ezone-managers → Variables:
   - `MANAGERS_WORK_SECRET` — a long random value (24+ characters).
   - `MANAGER_ACCESS` — the JSON above.
2. Dashboard Apps Script → Project Settings → Script Properties:
   `MANAGERS_WORK_SECRET` — **the same value**.
3. To give someone a new code or remove one, edit `MANAGER_ACCESS` in
   Railway; the app redeploys on its own.
