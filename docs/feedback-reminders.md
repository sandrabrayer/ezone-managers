# Half-yearly feedback «משוב» reminders (October 20, 2026)

Every employee of the house is due a feedback talk every 6 months. The app reminds the house manager and
records when it was done.

## Rule — `lib/feedback-due.js` (pure, also served to the browser)

- **Next due** = 6 calendar months after the **last recorded feedback**, or after the **start date** when
  there is none yet.
- **Month ends clamp**: 31 Aug + 6 months = 28 Feb (29 in a leap year); 31 Mar → 30 Sep. It never rolls
  into the next month.
- **Status** (Asia/Jerusalem "today"):
  - `overdue`: the due date has passed (red);
  - `soon`: due within 30 days, inclusive; due today is `soon`, not overdue;
  - `ok`: later;
  - `unknown`: no start date and no feedback yet («אין תאריך התחלה», never a guessed date).
- **Inactive employees are left out** (`active === false`). The digest already carries only active staff.
  Duplicate names are merged, the first one wins. A feedback date in the future or invalid is ignored.

## Where

- **«הבית היום»**: the card «משובים חצי־שנתיים» lists the overdue (red, «באיחור N ימים») and due-soon
  («בעוד N ימים») employees and the count without a start date. «לכל המשובים ←» opens the full list.
- **«צוות ומשמרות»**: every employee shows:
  - the status, the due date, and the last feedback or the start date;
  - a date input (default and max = today) and «בוצע».

  One request per tap, with double taps ignored. A future date is refused locally. A Hebrew reason is shown
  on failure.
- Unavailable: «עוד לא מחוברים» (no coordinators feed) or «יופיעו אחרי עדכון השרת» (an older Dashboard).

## Data

- **Roster** = `houseData.team.staff`, the coordinators ManagersHouse digest of active guides and therapists.
  `startDate` is a guide's staffing-synced `Guides.startDate` (digest column appended 20 Oct 2026);
  therapists have none until a first «בוצע».
- **Done dates** = `houseData.feedback.rows`, from the Dashboard's append-only **`ManagersFeedbackLog`**
  (`id, house, employee, doneAt, doneBy, doneById, createdAt`). Every «בוצע» is a new row.
- **Write**: `/api/work` `{ op: 'feedbackDone', employee, doneAt }`.
  - The server pins the house and the author from the session.
  - It checks the shape (`bad_request` / `bad_date`) and applies the write rate limit.
  - The Dashboard re-checks that the employee is on THIS house's staff (fail-closed) and that the date
    is not in the future.

## Tests

- `test/feedback-due.test.js`: month ends, leap years, no start date, inactive employees, the soon window,
  the last feedback winning.
- `test/feedback-reminders.test.js`:
  - the proxy pinning and shape checks;
  - the home card and list;
  - honest states;
  - the save flow;
  - the wiring.
