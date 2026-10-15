# Discharge alerts — «שחרור קרוב» (15 Oct 2026, Task E)

**CEO decision:** the alerts are driven ONLY by the expected discharge date the
manager sets by hand on «מטופלים בבית» (`docs/expected-discharge.md`). Nothing is
auto-filled from the Dashboard.

## What the manager sees (house tab → «ראשי»)

| Case | Shows |
|---|---|
| Expected date today … +14 days (`ALERT_LEAD_DAYS = 14`, inclusive) | amber «שחרור קרוב»: name, `שחרור משוער: dd/m/yy` and «היום» / «מחר» / «בעוד N ימים» |
| Date passed, patient still in the house | red «דורש עדכון»: «התאריך עבר אתמול» / «התאריך עבר לפני N ימים» |
| Date more than 14 days away | nothing |
| No date set | ONE quiet line, «N מטופלים ללא תאריך שחרור משוער»; a tap opens «מטופלים» |

- Alerts are sorted by date, so overdue ones come first.
- «שינוי תאריך» opens that patient's date picker on «מטופלים» in one tap.
- The «ראשי» sub-tab shows a red badge with the number of alerts.
- An alert disappears when the date is updated beyond 14 days or the patient
  is discharged. A discharged patient is no longer in `houseData.patients`.

**Admin (Sandra, Ron):** the «דשבורד» overview has a card,
«שחרורים קרובים — כל הבתים». It has a house filter (כל הבתים / each house), and
every alert names its house. A tap opens that house's tab with the patient's
picker.

## How

- Pure module `public/discharge-alerts.js`:
  - `houseAlerts` / `mergeAlerts` build the view model;
  - `renderCard` / `setBadge` render it as **text-only DOM** (`createElement` +
    `textContent`, never `innerHTML` with data).
- Wiring is in `public/work.js`, from the cached `houseData`.
- **No new endpoint, op, secret or env var.**
- **"Today"** = the calendar day in **Asia/Jerusalem** (`Intl.DateTimeFormat`),
  whatever the device timezone, so the day turns at Israel midnight.
- **Scope**: `houseData` is pinned server-side to a manager's own house. The
  all-houses card mounts for admins only, and admins load each house's
  `houseData` (cached 60 s, shared with the house tabs).
- **Privacy**: nothing in the module or its wiring logs; no patient names in logs.
- **Delivery**: in-app only, plus the badge. No email, WhatsApp or push.
- **Bonus**: display-only. No bonus code reads it; the golden bonus snapshots
  are unchanged.
- **UI**: RTL, 16px text, 44px tap targets, wraps at 360px.
- **Fix bundled with it**: a redraw of «מטופלים» (refresh / second load) keeps
  an open date picker open.
