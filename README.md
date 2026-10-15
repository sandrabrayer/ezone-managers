# ezone-managers

Mobile-first PWA work tool for house managers in the **איזון (E-Zone)** psychiatric residential network.

It reads house data and saves manager notes through the shared E-Zone Apps Script backend. Each person has a personal code and a stable identity; house and private-note permissions are enforced on both servers.

## Endpoints consumed

- `GET /api/sheets?action=managersOverview` — all houses (currently 5) + bonus calculations
- `GET /api/sheets?action=managersHouse&house=<houseKey>[&month=YYYY-MM]` — full
  detail for one house (entries/exits with patient names, referrals, daily
  chart); with `month=` for a FINISHED month picked in the bonus-history
  picker. `houseKey` is the frontend key (`efroni`, `pardes`, …) — the
  dashboard maps `efroni` to its Patients-sheet id `arfoni` itself.
- `GET /api/sheets?action=managersOverview&month=YYYY-MM` — one finished
  month's raw figures per house (settled bonus, quarterly window)
- `GET /api/sheets?action=occupancySnapshots` — settled monthly occupancy per
  house, for the permanent «תפוסה חודשית (סופי)» table (see below)

All of them are proxied through `server.js` to the E-Zone Apps Script `/exec`
endpoint with authenticated JSON POST requests. The work tabs additionally use
`POST /api/work` → `managersWork` for house data, adding notes and updating follow-ups.
The server supplies the secret, role, house and stable actor ID from the session.

The endpoint URL is configured via the `APPS_SCRIPT_URL` env var. It is **required** — there is no hardcoded fallback, and the server refuses to start if it is not set.

## Access — a personal code per person (13 Oct 2026)

The app is **no longer open**. Every person logs in with their own code
(Railway variable `MANAGER_ACCESS`); a house manager sees only their own
house, Sandra and Ron see all houses, and staff talks are private to their
author and the admins. Everything is enforced in `server.js` — see
`docs/access.md` for the model and configuration. **Protocol 2 requires a staged rollout:**
see [the deployment order](docs/managers-hardening-rollout.md) before merging either repository. (From 12 Sep to 13 Oct
2026 the app was open by decision; that model is retired.)

What is still enforced:

- **Per-IP rate limit** on `/api/sheets` and `/api/work`, 300 / 15 min (writes
  additionally 60 / 15 min), and on
  `/api/login`, 10 / 15 min — so no client can drain the shared dashboard
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

## Access and work tabs (13 Oct 2026)

Username + personal code per person (`docs/access.md`): a house manager sees only their
house; Sandra and Ron see all. Each house has sub-tabs — בונוסים, מטופלים
(patients, outpatients, visits and admissions this month), שיחות משפחה,
שיחות עם עובדים (private), אירועים חריגים — with follow-up reminders.

Dashboard (14 Oct 2026):
- Each house opens on «ראשי», which shows:
  - a bonus dial (`BonusView.bonusGaugeView`) with a «מה אם?» calculator
    (`BonusView.bonusCalcView`);
  - expected admissions this week and over the next 14 days;
  - the house manpower cost (stage 3, op `houseCost` → Dashboard → staffing feed, house totals
    only);
  - today in the house (on shift, therapy sessions, reminders);
  - visits and admissions this week and month;
  - the latest unusual events.
- «שיחות משפחה» was removed.

Expected discharge date (15 Oct 2026): each patient on «מטופלים בבית» shows
«שחרור משוער: dd/m/yy» (or «הגדרת תאריך שחרור») with a native date picker.
Op `dischargeSet` → Dashboard, append-only and audited, house-scoped. Saving shows a spinner and
«שומר...», ignores double taps, and reports a specific Hebrew reason on failure (no raw
`upstream_error`). The date can also be cleared («ניקוי תאריך») or marked «אין צפי לשחרור».
Both append an audit row, and «אין צפי» is left out of the alerts and the no-date count.
Details: `docs/expected-discharge.md`.

Discharge alerts (15 Oct 2026): «ראשי» shows «שחרור קרוב» for expected dates in the next 14 days
and a red «דורש עדכון» for passed dates, plus a badge; admins get an all-houses card with a house
filter on the overview. From the manager's own dates only, in-app only. Details:
`docs/discharge-alerts.md`.

Temporary exit and return (15 Oct 2026): a return within 7 days keeps the stay (first
admission date, «יום N» not reset, no double-counted day) — Dashboard raw data, from Oct
2026. Details: `docs/temporary-exit-return.md`.

Stage 2 (14 Oct 2026) adds two more house sub-tabs:
- **צוות ומשמרות:** on shift today, the next 14 days, and the staff with tap-to-call phones.
- **מטפלים:** workdays and the weekly visits.

The data comes from the coordinators app through the Dashboard (`team` in `houseData`). Until
`MANAGERS_DIGEST_SHEET_ID` is set on both Apps Scripts, the tabs say «עוד לא מחוברים».

## Bonus history

A **"חודש בונוס"** picker on the overview and on every house tab lists the
running month (default) and every finished month back to May 2026, the
quarterly anchor. A finished month renders the whole page settled
(`יולי 2026 — סופי`: tier reached, amount, gate result, quarterly window),
from the existing `managersOverview&month=YYYY-MM` (figures, settled bonus)
and, for every opened house tab, `managersHouse&house=<key>&month=YYYY-MM`
(that month's entries, exits, patient names, referrals and daily chart) —
both cached per month in memory. A fetch that is running or failed renders an
explicit loading / error state, never «אין נתונים». `חזרה לחודש נוכחי`
restores the live view. See `docs/bonus-month-labelling.md` → "Bonus history
month picker" and "Settled month — the house's own data".

## Bonus rules (month-aware)

The rules live in `RULE_SETS` in `lib/bonus-eligibility.js`. A month is
judged by the latest rule set that started on or before it, so a rule change
never rewrites a settled month.

| House | Up to Sep 2026 (first / gate; tiers 2,000 / 2,500 / 3,000) | From Oct 2026: first bonus 2,000 ₪ · full occupancy 3,000 ₪ total |
|---|---|---|
| רמות השבים | 17 / 510 (19, 20) | **14** · full **20** |
| רעננה אשר | 10 / 300 (12, 14) | 10 · full 14 |
| קיסריה עפרוני | 10 / 300 (12, 13) | **9** · full **13** |
| קיסריה ריהאב | 10 / 300 (12, 13) | **9** · full **13** |
| רעננה הפרדס | 10 / 300 (12, 13) | **7** · full **13** |

A step pays when the month's average reaches its patient count and the
treatment-days gate (first step × 30) is met; it counts as **secured**
mid-month once the days already counted reach `max(gate, patients ×
days-in-month)`. Quarterly 5,000 ₪ (each month's occupancy bonus ≥ 2,000 ₪):
May–Jul 2026 only — none from the Aug–Oct 2026 window on.

The house page shows each bonus as a block: what it pays, the condition in
words, and the figures now; full occupancy appears only while reachable.

**Continued-treatment bonus («בונוס המשך טיפול»), from Oct 2026:**
300 ₪ ONCE per patient from the house, in the month the patient starts a day
package (two days a week or daily) — not monthly; maintenance pays 0
(Dashboard feed `referralStarts`). Paid whether or not the occupancy bonus
was earned; not part of the quarterly check. None before Oct 2026. Counts come
from the dashboard's "Outpatients" sheet (any overlap with the month counts as
a full month). Kill switch: `REFERRAL_BONUS_KILL_SWITCH` in
`lib/bonus-eligibility.js`.

**Intake-meeting bonus («בונוס פגישות קליטה»), from Oct 2026:** 250 ₪ per
intake meeting the manager held that closed into an admission of 30+ days,
the patient being the house's 7th or later. Counted in the month of
admission; meetings still under 30 days are shown as pending and paid once
they confirm. Not part of the quarterly check. Facts come from the
Dashboard feed's `intakeMeetings` (Leads.meetingWith + Patients.fromLead).
Kill switch: `INTAKE_BONUS_KILL_SWITCH`.

## Monthly occupancy (סופי) + CSV export

A permanent **«תפוסה חודשית (סופי)»** card — on the overview a table of every
**settled** month (newest first, from May 2026) × the five houses, each cell
the month's occupancy percentage with `ממוצע יומי/קיבולת` beneath it; on a
house tab the same card for that house alone. The running month is never a
row and every row is labelled `סופי`. A missing month/house cell says
`אין נתונים` — never `0%`. **«ייצוא CSV»** downloads the same figures as
`occupancy-<from>_to_<to>.csv` (UTF-8 BOM, Hebrew headers, CSV-injection-safe;
format in the pure module `public/occupancy-export.js`).

Data: one `occupancySnapshots` request per page through the existing proxy —
no new endpoint, env var or Railway variable. A failure, an unknown action or
a malformed payload shows an explicit error state with a `נסו שוב` button and
never a computed fallback. Details: `docs/occupancy-history-view.md` →
"Monthly occupancy (permanent)".

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
unchanged; a finished month's house tab shows that month's entries, exits,
names and referrals from `managersHouse&month=`, with explicit error states and
the `efroni` / `pardes` keys), the permanent monthly-occupancy view (`test/occupancy-view.test.js`
— table model, `arfoni` → `efroni`, missing cell, newest-first, no running
month, error state and retry, CSV export, no bonus state written) and its CSV
format (`test/occupancy-export.test.js` — BOM, Hebrew headers, injection and
quote escaping, only the documented columns), and static UI guards
(`test/ui-guards.test.js`).

**Tests never call the live Apps Script backend**: all upstream HTTP is mocked
in-process and all secrets are dummy values set inside the test files.

CI: `.github/workflows/test.yml` runs the suite on every pull request and
every push to `main` (Node 18/20/22).

## Deploy

Procfile + `railway.json` included — push to Railway and it runs `node server.js` on port `$PORT`.

`GET /api/version` returns `{commit, builtAt}` (`no-store`): `commit` is
Railway's `RAILWAY_GIT_COMMIT_SHA` (`"unknown"` when unset), so a deploy can be
confirmed by comparing it with the merge SHA. `GET /healthz` is the Railway
health check.
