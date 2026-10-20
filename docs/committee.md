# Committee date per patient — «ועדה» (15 Oct 2026)

House managers record a committee («ועדה») date for each patient: one current date per stay,
with an optional short label (≤ 60 characters, e.g. the type of committee).

**Assumption** (conservative): "committee" covers any committee the manager records for a
patient. Its kind goes in the free-text label. There is no fixed list.

## Where

House tab → «מטופלים» → «מטופלים בבית». Every patient row gets a second line:

| State | Shows |
|---|---|
| Date set | `ועדה: dd/m/yy · <label>` with «שינוי» and «ניקוי» |
| Not set | «הגדרת תאריך ועדה» |

- The form has a native date picker, an optional «סוג הוועדה» text field (max 60), «שמירה»
  and «ביטול».
- It uses the same spinner (on the tapped button), disabled row, one request per tap and
  specific Hebrew error reasons as the expected-discharge save.
- Layout: RTL, 16px text, 44px targets, wraps at 360px.

## Rules

- **Today or later.** "Today" is the calendar day in Asia/Jerusalem.
- **Past dates**:
  - a NEW committee date in the past is refused: «לא ניתן לקבוע ועדה בתאריך שעבר»;
  - an EXISTING date may be corrected to a past date, but only after a warning: the first
    «שמירה» shows «שימו לב: התאריך כבר עבר…», and a second «שמירה» sends `correction: true`;
  - the Dashboard stores the correction with `pastCorrection = 1` and answers
    `warning: 'past_date'`.
- **Other limits**: not before the admission date; at most 2 years ahead.
- **«ניקוי»** appends a `cleared` row; it never deletes. History stays in the audit rows.
- **Optimistic concurrency**: the screen sends the date AND the label it showed. If someone
  changed either meanwhile, the save is refused («תאריך הוועדה עודכן בינתיים») and the current
  value is reloaded.

## Data path

`POST /api/work` `{ op: 'committeeSet', house, patientName, entryDate, committeeDate, label,
previousDate, previousLabel, correction?, mode? }` → Dashboard `managersWork` `committeeSet`
(E-Zone-Dashboard #239).

- **Session** required (401 without one).
- **House scope**: a manager is pinned to their own house; an admin names one. The Dashboard
  also checks the patient is in that house today with that admission date.
- **Proxy shape checks**: `mode` is `set` / `clear`; real `yyyy-MM-dd`; a clear carries no
  date; not before admission; the label is a string ≤ 60; `correction` is a boolean; the name is
  1–80 characters.
- **Rate limits**: the shared bucket plus the write bucket (60 / 15 min). Writes get a 30 s
  timeout.
- **Secret**: the existing fail-closed `MANAGERS_WORK_SECRET`. No new env var or Script
  Property.
- **Storage**: the Dashboard's APPEND-ONLY sheet `ManagersCommittee`. The value comes back in
  `houseData`: `patients[].committee` (`{ date, label, editedAt, editedBy }` or `null`), plus
  `committeeSupported: true`. With no flag (an older backend), nothing new is shown.

## Alerts (house «הבית היום», was «ראשי», + badge)

`public/committee-alerts.js`, computed from the cached `houseData`. It needs no extra request.

| Case | Shows |
|---|---|
| Committee today | red «ועדה היום», on top |
| Today+1 … today+7 (`COMMITTEE_LEAD_DAYS = 7`, inclusive) | amber «ועדה השבוע» |
| More than 7 days ahead, or already passed | nothing |

- Each alert shows the name, `ועדה: dd/m/yy · <label>`, «היום» / «מחר» / «בעוד N ימים», and a
  one-tap «שינוי» that opens that patient's form.
- Alerts are sorted by date, then name.
- The «הבית היום» sub-tab (was «ראשי») gets an amber badge with the count, beside the red discharge badge.
- **Admin (Sandra, Ron)**: the overview has «ועדות קרובות — כל הבתים» with its own house
  filter. Every alert names its house.
- Text-only DOM; nothing logs; no names in logs. In-app only: no email, WhatsApp or push.
- **Shared rule**: the E-Zone-Dashboard card «ועדות קרובות» runs the identical fixture
  `test/fixtures/committee-alert-cases.json`, with its sha256 pinned on both sides.
- Display-only: no bonus code reads it, and the golden bonus snapshots are unchanged.
