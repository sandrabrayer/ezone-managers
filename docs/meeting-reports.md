# «פגישות קליטה» — intake meetings and their reports (November 19, 2026)

Sandra, 19 Nov 2026: a manager reported a meeting through the link instead of the app. The meetings
Vered schedules must also appear in the app, whatever WhatsApp message the manager got. The manager
reports here whether the meeting happened. If not, they give the reason (לא הגיעו / נדחתה / בוטלה…).
If it did, they give the result. The report reaches the WhatsApp group and the Dashboard exactly as the
`/meeting-report` link does today.

## Where

House tab → sub-tab **«🤝 פגישות קליטה»** (after «מטופלים»). A red number on the tab counts the
past meetings nobody has reported yet.

- **ממתינות לדיווח**: past meetings with no report.
- **קרובות**: today onward.
- **דווחו**: closed by default (an arrow header). Each meeting shows its report: the result, the
  reason and proposed date, and who reported it. «עריכת דיווח» sends the report again, and the
  last one wins, as on the link.
- Every row has the name, the weekday, date and time, the lead's house and who holds the meeting.
  «רקע מהמשרד» (Vered's note) sits behind an arrow.
- **«הבית היום»** has a card with this week's meetings and «X פגישות ממתינות לדיווח». The count
  links to the tab. The card stays open while something is waiting.
- The window is 30 days back and 14 days ahead. A meeting belongs to the house when the lead's house
  is this house, or when this house's manager holds it (the intake-bonus rule).

## The report

«דיווח על הפגישה» → **«האם הפגישה התקיימה?»**

- **כן**: the result (מתקדם לכניסה / מתלבט / לא מתאים), «מי הגיע/ה איתו/ה» (the link's chips,
  with «אחר» as free text) and פירוט (up to 5,000 characters, with a live counter).
- **לא**: the reason (לא הגיעו / נדחתה / בוטלה ע"י הפונה/המשפחה / בוטלה על ידינו / אחר + text).
  «נדחתה» adds an optional «מועד חדש מוצע» date (today or later), plus פירוט. The proposed date
  never moves the meeting: Vered reschedules it.
- Saving shows a spinner and disables the button. A double tap sends nothing twice, and every
  form carries an idempotency key (`submissionId`). A failure keeps everything typed, and every
  error is in Hebrew.
- After saving: «✓ הדיווח נשמר ונשלח לדשבורד» and **«📤 שלח לקבוצה (וואטסאפ)»**. The
  WhatsApp text is the link's message byte for byte, with the `סיבה: …` line for a meeting that
  did not happen (`test/meetings.test.js` pins the Dashboard's output). The link opens through
  `window.open`, falling back to navigation, so it also works in the installed PWA.
- **Cancelled by the office** (25 Nov 2026): a meeting the Dashboard marks «בוטלה» (`meetingOutcome: 'cancelled'`)
  is not served by op `meetings` (unless the manager already reported on it), and the house's visits list hides it from
  «ביקורים קרובים», the visit tiles and the «יומן» fallback. A saved (STALE) meetings answer is followed by one fresh read.
- **«מתלבט» + «ביקש/ה שיחזרו»** (24 Nov 2026): when the result is מתלבט and the פירוט says the person
  asked to be called back («ביקשה שנחזור אליה בעוד שבוע», «שיתקשרו מחר»…), the Dashboard opens a call
  task for ורד, due on the day the text asks for, else the next working day. The confirmation shows
  «📌 נוצרה משימה למשרד לחזור אליהם · <date>». One open task per lead: editing the report does not add
  a second. The rule is in the Dashboard (`CHANGELOG-meeting-report-undecided-task.md` there).

## Data path

`POST /api/work` → Dashboard `managersWork`:

| op | sends | answers |
|---|---|---|
| `meetings` | — (house, role and actor from the session) | `{ ok, house, today, from, to, meetings: [{ id, name, house, houseLabel, visitDate, visitTime, meetingWith, officeNote, report \| null }] }` |
| `meetingReport` | `leadId, outcome, notHeldReason, proposedDate, companion, note, submissionId` | `{ ok, saved: { leadId, outcome, companion, reporter, reportedAt, notHeldReason, proposedDate, via } }` |

- The house is the manager's own. An admin names one, and `access.canSeeHouse` decides. The
  reporter is the signed-in person, set by the Dashboard from `actor`, never from the browser.
- The server checks the shape (outcome allowlist, reason only with `no_show` and required there,
  `YYYY-MM-DD` date, lengths, control characters) and refuses a wrong one with 400 without
  forwarding it. The Dashboard re-validates everything. A meeting outside the house's scope
  answers `lead_not_found`, the same answer as a missing lead.
- `meetingReport` is a write: it uses the write rate bucket and the longer timeout, and it drops
  the house's cached reads so the list is fresh at once.
- The report lands on the same lead row as the link (`meetingReport*` +
  `meetingNotHeldReason / meetingProposedDate / meetingReportVia='app'`), unread for Vered. See
  `CHANGELOG-meeting-report-in-managers.md` in E-Zone-Dashboard (#410).

## States

«טוען את הפגישות…», then one of:

- the lists;
- **«לא מחובר»**: amber, shown for an older Dashboard (`unknown_op`) or a missing secret. The home
  card stays hidden and the link keeps working;
- a read error with «נסו שוב».

## «זימון» — a meeting scheduled with you (20 Nov 2026, Part B)

When Vered schedules a meeting «נפגש/ת עם» a manager (the Dashboard sends that manager a WhatsApp
«זימון», Part A), the manager also sees it in their own app:

- «הבית היום» leads the «🤝 פגישות קליטה» card with a «📩 נקבעה פגישה איתך» block listing their
  upcoming (unreported) meetings.
- Every row in the full list that is scheduled with the logged-in manager carries an «איתך» chip.

The logged-in manager's name reaches the view through `MeetingsView.setViewer`, called by `app.js`
after login; admins are nobody's target and get no highlight. The match is by the manager's display
name, normalised (NFC, trim, collapse spaces, case-fold) — the same string on both sides
(`MANAGER_ACCESS.name` and the lead's `meetingWith`). This is UI-only: the `meetings` feed already
returns `meetingWith`, so nothing new is requested or written.

## Safety

- Every feed value is escaped. Free text never becomes markup.
- No device storage: the draft lives in page memory and survives a redraw.
- No new env var or secret: the existing `MANAGERS_WORK_SECRET` is used.
