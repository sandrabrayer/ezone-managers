# «📅 יומן» — the house's week, and «הוספה ליומן» (November 21, 2026)

Sandra, 21 Nov 2026: «כשקובעים פגישה למנהל צריך שחוץ מזה שזה שולח באפליקציה זה יוציא לו זימון
לפגישה ליומן, גם באפליקציה צריך להיות לו יומן של השבוע נניח עם כל הפגישות או אירועים אחרים».

Two parts:

- The **calendar invitation to the manager's phone** is the Dashboard's job (E-Zone-Dashboard,
  `CHANGELOG-meeting-calendar-invite.md`): the WhatsApp «זימון» carries a «להוספה ליומן בטלפון»
  link. An invitation by email is an optional second channel there; this app shows its status.
- The **weekly calendar** and the **«הוספה ליומן» buttons** are here (`public/calendar.js`).

## Where

House tab → sub-tab **«📅 יומן»**, right after «הבית היום». «הבית היום» has one line,
«📅 השבוע: X אירועים · היום Y — ליומן ←», that opens it.

## What it shows

The week from Sunday to Saturday, today marked, with every dated item the app already has:

| Kind | From | Opens |
|---|---|---|
| 🤝 פגישת קליטה | the `meetings` op (30 days back, 14 ahead) | «פגישות קליטה» |
| 📋 ועדה | `houseData.committees` (the coordinators set them; information only) | «ועדות» |
| ➕ קליטה צפויה | `houseData.expectedAdmissions` | «מטופלים» |
| 🚪 שחרור צפוי | the date the manager entered on a patient | «מטופלים» |
| 🔔 תזכורת מעקב | `followUpDate` of a family call, a staff talk or an operational issue | that log's tab |
| 📝 משוב חצי־שנתי | `lib/feedback-due.js`, on the day it is due | «צוות ומשמרות» |
| 🩺 טיפול | `houseData.team.therapistWeek`, this week only, hidden until its chip is tapped | «מטפלים» |

- A meeting shows «איתך» when it is scheduled with the signed-in manager, «ממתינה לדיווח» in red
  when it is past and not reported, and its report when there is one.
- Timed items come first by hour, then the all-day ones.
- **Filters:** a chip per kind with the week's count. The choice lives in the page's memory only.
- **Other weeks:** «שבוע קודם» / «שבוע הבא», 4 weeks back and 8 ahead; «השבוע» returns to
  today. A week beyond what the meetings feed carries says so.
- On a phone the week is a list by day. From 1100px it is a 7-column grid.
- A kind whose source is not available is named in an amber line. An empty day says «אין אירועים».
  Until the meetings feed is connected, the house's visits list fills in for it and says so.

«הבית היום»'s «🤝 פגישות קליטה» card now lists **today's** meetings only, with
«עוד N פגישות השבוע — ביומן ←». The week is listed once, in «יומן».

## «הוספה ליומן»

Under every coming meeting that has an hour, in «יומן» and in «פגישות קליטה»:

- **«📅 הוספה ליומן Google»** opens Google Calendar's new-event page (local times with
  `ctz=Asia/Jerusalem`).
- **«קובץ ליומן (.ics)»** downloads an iCalendar file for the iPhone calendar or Outlook. It
  carries the zone's own clock-change rule, and the same UID as the Dashboard's invitation, so a
  meeting that was also mailed is one calendar entry, not two.
- **«📅 נשלח זימון ליומן במייל»** appears when the Dashboard reports `invite: 'sent'` for the
  meeting. Before the Dashboard has that field, only the buttons show.

**Privacy:** the entry's title is «פגישת קליטה · E-ZONE <בית>» and its text holds the lead's
**first name only**. No surname, phone or office note leaves the app.

## Data path and safety

- **No new request, route, op, env var or secret.** `calendar.js` reads the `houseData` that
  `work.js` already loaded and the meetings that `meetings.js` already loaded. `server.js` is
  untouched. The house is the one the server decided for those two reads.
- Staff talks are private to their author and the admins. The server already returns only the
  rows a person may see, so a follow-up of someone else's talk never reaches the calendar.
- Every feed value is escaped. Nothing is stored on the device.
- The only outside link the calendar opens is `https://calendar.google.com/…`.
- The bonus is untouched: no bonus module reads the calendar.

## Not in this change

- **«ישיבת צוות»** (the house's weekly team-meeting day) is not in any feed this app reads
  today. It lives in ezone-coordinators (`Houses.MEETING_DAY`). To show it here, the coordinators
  feed needs one more field: `meetingDay` (0–6, Sunday = 0) per house in the `committees` /
  team digest answer. Nothing was added on that side.
- An all-houses calendar for the admins. Each house tab has its own calendar.

## Tests

`test/week-calendar.test.js` (22): the week (Sunday start, month and year change, the
clock-change weeks, the arrows' range); every kind mapped; sorting; flags; filters; missing
sources named; markup and escaping; the home line; the Google link and the .ics file (first name
only, folding, the zone rule checked against the real clock changes of 2026–2030); wiring; no
request and nothing stored.
