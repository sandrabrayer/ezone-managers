# «עדכון משמרת» — shift updates, read-only, own house (October 22, 2026)

The house manager reads the coordinators' shift-handover log («עדכון משמרת») of **their own house**,
one week at a time. There is no edit.

## Where

House tab → sub-tab **«עדכון משמרת»** (after «סיכומי ישיבות»):

- «שבוע קודם» · «השבוע» · «שבוע הבא» (never past the current week) and a shift filter
  (כל המשמרות / בוקר / אחר צהריים / לילה).
- The 7 days ending on the picked day, newest first, grouped by day: shift, author, the note (line
  breaks by CSS `white-space: pre-wrap`). An update written later than its day shows «הוזן בדיעבד ·
  d/m/yy HH:MM» (the real entry time, Israel).
- States: «טוען…»; «אין עדכוני משמרת בשבוע הזה»; «עוד לא מחוברים» (the feed variables are not set);
  a read error «לא הצלחנו לטעון את עדכוני המשמרת כרגע. זה לא אומר שאין עדכונים.» + «נסו שוב». A raw
  code is never shown, and a failed read never looks like an empty week.

## Data path

coordinators `ShiftHandover` (encrypted at rest in its read model) → coordinators
`POST /api/managers-feed` `{ kind: 'shiftUpdates', house, upTo }` (Bearer secret) → this server
(`lib/coord-feed.js`) → `POST /api/work` `{ op: 'shiftUpdates', upTo? }` → the browser.

- The house is the manager's own (server-decided); an admin names one. `upTo` is validated here
  (`bad_date` 400) and again by the coordinators (≤ tomorrow, ≤ 400 days back).
- Loaded only when the sub-tab is opened; kept 2 minutes in memory per house + week. **Nothing is
  stored on the device** (no localStorage / sessionStorage / IndexedDB — guard test).
- The text is clinical-adjacent: escaped and rendered as text only.
- No feed configured → `{ ok:false, error:'not_configured' }` and no request is made.

## Tests

`test/shift-updates.test.js` (session, not-configured, bad date, the view's states / escaping / filter /
«הוזן בדיעבד», wiring) and `test/coord-feed.test.js` (the op through a configured feed, every house).
