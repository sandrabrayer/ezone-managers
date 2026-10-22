# «סיכומי ישיבות» — meeting summaries, read-only (October 20, 2026)

The house manager reads the coordinators' team-meeting summaries of **their own house**, by month.
There is no edit.

## Where

House tab → sub-tab **«סיכומי ישיבות»** (after «ועדות»):

- A month picker: this month and the 11 before it.
- Each meeting is a collapsible row: weekday + date, title and patient count. Opened, it shows:
  - the participants;
  - the general summary;
  - per patient, the weekly update («עדכון שבועי») and the goals («מטרות טיפוליות»).
- **Final meetings only.** A meeting appears once the coordinator presses «סיום ישיבה». A draft is
  still being typed live.
- States:
  - «טוען…»;
  - «אין סיכומי ישיבות ב<month>»;
  - «עוד לא מחוברים» (the secrets are not set);
  - «יופיעו אחרי עדכון אפליקציית הרכזים» (an older coordinators deploy);
  - a read error, with «נסו שוב». A raw code is never shown.

## Source (22 Oct 2026)

The summaries now come **first from the coordinators feed** (`docs/coordinators-feed.md`,
`kind: 'summaries'`, final meetings only, one house + month). If the feed is off or fails, the
Dashboard path below answers as before.

## Data path

coordinators `TeamMeetings` + `TeamMeetingRows` → coordinators Apps Script
`getMeetingSummariesForManagers` (`MANAGERS_READ_SECRET`; one house + one month; final only) →
Dashboard `managersWork` op `meetingSummaries` (same Script Properties as the committees feed;
cached per house + month) → `POST /api/work` `{ op: 'meetingSummaries', month }` → the browser.

- The house is the manager's own: the server pins it, and an admin names one. The month is validated
  (`bad_month` 400, never forwarded).
- The request is loaded only when the sub-tab is opened, and kept 5 minutes per house + month.
- The text is clinical. It is escaped and rendered as text. Line breaks come from CSS
  (`white-space: pre-wrap`), never from markup. Nothing is stored on the device.

## Tests

`test/meeting-summaries.test.js`:

- the proxy pinning and month validation;
- the month picker;
- escaping and line breaks;
- every state;
- the wiring.
