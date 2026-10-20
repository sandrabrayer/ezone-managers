# E-ZONE ecosystem status — addendum, October 20, 2026

Add this addendum to the knowledge of all eight E-Zone Projects, next to `EZONE-ECOSYSTEM-STATUS.md`. It covers the
managers / coordinators / Dashboard work of 20 Oct 2026. Every merged PR is listed with its merge commit.

After setting the Script Properties, run `importManagersCommitteesNow(true)` once in the coordinators Apps Script
editor (a dry run), then `importManagersCommitteesNow(false)`. This copies the committee dates the managers already
entered into the coordinators' `Committees` sheet. Deployed
branches are unchanged (table below).

## Deployed branches (unchanged)

| App | Repo | Deploys branch | Apps Script deploy |
|---|---|---|---|
| Outpatient | ezone-outpatient | `claude/youthful-volta-laarnk` | clasp CI |
| Dashboard | E-Zone-Dashboard | `claude/build-ezone-dashboard-QOg5s` | clasp CI, **automatic on merge** |
| Therapists | ezone-therapists | `claude/inspiring-tesla-jipobw` | clasp CI |
| Managers | ezone-managers | `main` | none (it uses the Dashboard Apps Script) |
| Staffing | ezone-staffing | `main` | clasp CI |
| Kitchen | ezone-kitchen | `main` | clasp CI |
| Coordinators | ezone-coordinators | `main` | clasp CI, **manual** «Deploy Apps Script» (`workflow_dispatch`) |
| Logistics | sandrabrayer-ezone-logistics | `main` | clasp CI |

## What shipped (in order)

| # | Feature | Managers | Coordinators | Dashboard |
|---|---|---|---|---|
| 1 | «הבית היום» landing tab + one «בונוס» tab; no settled-month banner on load | #52 `5471805` | — | — |
| 2 | «מדריך» usage guide tab | #53 `dc8207e` | — | — |
| 3 | Committees: the coordinators set them, managers view them read-only | #54 `47b5290` | #302 `a955e04` | #261 `a31dc04` |
| 4 | «סיכומי ישיבות» read-only for the house manager | #55 `2ed7096` | #304 `baedf0a` | #263 `3853fad` |
| 5 | Half-yearly feedback «משוב» reminders | #56 `3771423` | #305 `d80bc3a` | #264 `34e03ab` |

### Managers (ezone-managers)

- **Tabs**:
  - The app opens on **«הבית היום»**. Admins get one card per house: date + weekday, patients, the בוקר / ערב / לילה
    shifts, sessions, open requests and the all-houses alerts.
  - A house manager lands on the house's «הבית היום» sub-tab (was «ראשי»).
  - **Every bonus element lives in «בונוס»**: picker, hero, dial, plan, KPIs, chart, history, winners banner, house cards.
  - There is no settled-previous-month banner in the running month. A finished month shows only when picked, labelled
    «— סופי».
  - `lib/bonus-eligibility.js` is untouched.
- **«מדריך»**: a static RTL guide, open to every role, with a bonus table checked in CI against the rule sets.
- **Committees**: READ-ONLY.
  - A «ועדות» sub-tab, alerts on «הבית היום», and the admin card.
  - `/api/work` `committeeSet` → **410**. The per-patient editor is removed.
- **«סיכומי ישיבות»**: a sub-tab with a month filter, FINAL meetings of the manager's own house, no edit.
- **«משוב» reminders**:
  - Next due = 6 months after the last feedback, else after the start date (`lib/feedback-due.js`).
  - The card on «הבית היום» shows overdue (red) and due ≤ 30 days.
  - «צוות ומשמרות» lists everyone with «בוצע» + a date.

### Coordinators (ezone-coordinators)

- **«ניהול ועדות»** on ראשי (רכז/ת own house, admin any house): date, time, type, participants, patient; edit; soft delete.
  - New append-only sheet `Committees`.
  - After a save, **«שליחה למנהל/ת בוואטסאפ»** opens a prefilled `wa.me` message. The phone comes from the Script
    Property `HOUSE_MANAGER_PHONES`.
- The «ועדות קרובות» alerts read the sheet. The old Dashboard `committeeSync` step is removed.
- **Feeds to Managers** (own fail-closed secret `MANAGERS_READ_SECRET`):
  - `getCommitteesForManagers`;
  - `getMeetingSummariesForManagers` (one house + month, FINAL only).
- One-time `importManagersCommitteesNow(false)` copies the committee dates the managers had already entered.
- The `ManagersStaff` digest gains an appended `startDate` column (guides).

### Dashboard (E-Zone-Dashboard)

- `houseData.committees` ← coordinators feed (caller's house only). `committeeSet` → `committee_read_only`. The
  «ועדות קרובות» card uses the same feed and shows an honest «לא זמין» state.
- `managersWork` op `meetingSummaries` (caller's house, one month).
- `managersWork` op `feedbackDone` → new append-only sheet `ManagersFeedbackLog`. `houseData.feedback`; the team digest
  `startDate` is optional.

## Script Properties to set (never in code)

| Where | Property | Value |
|---|---|---|
| Coordinators Apps Script | `MANAGERS_READ_SECRET` | a new random value, 32+ characters |
| Coordinators Apps Script | `HOUSE_MANAGER_PHONES` | JSON: `{"ramot":"05…","raanana":"05…","efroni":"05…","rehab":"05…","pardes":"05…"}` |
| Dashboard Apps Script | `COORDINATORS_SHEETS_URL` | the coordinators Apps Script `/exec` URL |
| Dashboard Apps Script | `COORDINATORS_MANAGERS_SECRET` | the SAME value as `MANAGERS_READ_SECRET` |

No Railway variable. The Dashboard already has the `script.external_request` scope.

## «Deploy Apps Script» run order (per Code.gs PR)

1. Coordinators #302 → manual «Deploy Apps Script» on `main` (run 129 ✓).
2. Dashboard #261 → automatic on merge (run 119 ✓).
3. Coordinators #304 → manual (run 131 ✓).
4. Dashboard #263 → automatic (run 120 ✓).
5. Coordinators #305 → manual (run 132 ✓).
6. Dashboard #264 → automatic (run 121 ✓).

## Known open item (20 Oct 2026, ~17:00 UTC)

Railway stopped deploying new commits for ezone-managers, E-Zone-Dashboard and ezone-coordinators. `/api/version`
still showed `dc8207e` / `1486d98` / `1b60bfc`. The merged code is on the deployed branches and goes live when Railway
deploys again. Verify each with `/api/version` = the branch head.
