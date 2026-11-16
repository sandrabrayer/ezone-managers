# Work tabs, 16 Nov 2026 — committees for information, operational issues, collapsible cards, the budget simulation, next month per worker, family calls

## Why

Sandra, 16 Nov 2026, after looking at the redesigned app:

> «הועדות אצל המנהלים רק אינפורמטיביות, הם לא מכניסים דאטה … לאירועים חריגים תקרא "סוגיות תפעוליות למעקב". בעמוד
> שיש בו הרבה נתונים צריך כותרות עם חץ ושיפתח תפריט עם המידע, אחרת מגוללים כל הזמן לחפש משהו. ברשימת עובדים ועלות
> שכר ותקציב צריך לאפשר סימולציה ליד כל עובד עם אפשרויות: סגירת העובד, שינוי שכר עם סכום. הנתון מהסימולציה צריך
> להופיע במקום הנתון הקיים ולהשפיע על הסה"כ שרשום למטה … הנתונים על עובדים שמסיימים צריכים גם להופיע מסטאפינג …
> ברבעון 4 זה לא נכון שהעלות נשארת סטאטית. בועדות מי שממלא את המידע על מה שקורה שם זה המטפלים, שאין להם גישה
> לאפליקציה הזו … תוסיף שדה אחרי מטופלים לשיחות עם בני משפחה שתהיה מתועדת כמו ב-CRM. תיקח את הנתונים מדשבורד …
> תבדוק אם יש כפילות מידע או סרבול ותתקן.»

## 1. «ועדות» — information only

- The sub-tab shows when there is a committee: weekday, date, time, type, patient, participants, status. Soonest first.
- **Removed:** the «מה היה בוועדה» form, the «📝» buttons, the «ועדות שהתקיימו — עוד לא נרשם מה היה» list, the notes in
  the patient card, and the `committeeNotes` log in this app.
- The therapists document a committee; they do not use this app.
- `server.js` refuses a `committeeNotes` write (`unknown_log`, 400) before anything is forwarded.
- The Dashboard keeps the `ManagersCommitteeNotes` sheet and its rows. Nothing was deleted; the app no longer reads it.
- The committee alerts on «הבית היום» are unchanged.

## 2. «סוגיות תפעוליות למעקב»

- The new name of «אירועים חריגים»: the sub-tab, the card on «הבית היום», the patient-card tab («סוגיות»), the
  reminder label («סוגיה תפעולית») and the guide.
- The log key, the sheet and the saved rows are unchanged (`events`). Field labels: «מה הסוגיה», «מה נעשה / מה נדרש».

## 3. Collapsible cards — a header with an arrow

- Every card of a work tab is a header with an arrow. A tap, Enter or Space opens or closes it.
- A tab with 3 or more cards opens with its main card(s) open and the rest closed:
  - the cards marked `data-default-open`, else the first card;
  - a card that has alerts (committee today, discharge soon) is always open;
  - a card with a half-typed form or an open date picker is never closed by a redraw.
- A tab with 1–2 cards opens fully.
- «פתיחת הכול» / «סגירת הכול» at the top of a tab with 3+ cards.
- A link that jumps into a card («לכל המשובים ←», «שינוי תאריך», «+ רישום שיחה») opens that card first.
- What a person opened or closed is kept in the page's memory only. Nothing is written to the device, as in the rest
  of `work.js`; a reload starts from the defaults.
- Not applied to «בונוס», «סיכומי ישיבות» and «עדכון משמרת».
- Printing shows every card open.
- Code: `work.js` `applyCollapse`, `collapseKeyOf`, `collapseDefaultOpen`; `styles.css` `.is-collapsible` / `.is-collapsed`.

## 4. The simulation in «תקציב כוח אדם»

- Beside every named worker: «ללא שינוי» / «סיום העסקה» / «שינוי שכר». «שינוי שכר» opens a field for the worker's
  **new monthly cost**.
- The simulated figure replaces the worker's figure (the real one stays beside it, struck through).
- The total under the table follows, for this month and for next month's forecast, with the change in ₪.
- A «🧪 סימולציה» card shows the simulated monthly cost against the budget, the saving, what is left, and next month.
- The quarter card gets a «בסימולציה» column for the running month and the months after it. A settled month has none.
- «איפוס הסימולציה» clears it. So does a reload.
- **A what-if only.** It lives in the page's memory: it is never saved, never sent to the server, and it changes
  nothing in the staffing app. The amounts are for a full month. No bonus figure reads it.
- Only a worker of the list on screen can be simulated; an amount is a whole number from 0 to 1,000,000.
- Code: `crm.js` `simulateStaff`, `budgetHtml`, `quarterHtml`; `work.js` `simState`.

## 5. The people who are leaving — next month, per worker

- **Who is leaving** is one card: «חיסכון צפוי מסיומי עבודה» (PR #73, the same day), the staffing app's own forecast —
  how many finish, the saving this month, next month and in a full month, and who finishes when. This PR adds no
  second list. The card is open when the tab opens.
- **Added here:** next month's cost per worker.
  - The workers table has a «צפי <next month>» column; the month card has a «צפי <next month>» tile.
  - Source: `houseStaffCost` for the next month. Staffing prices a month without the days after an end date, so a
    worker who leaves shows the full cost this month and less, or nothing, next month. This app computes no pay.
  - The simulation uses the same next-month list, so «<next month> בסימולציה» already leaves out whoever is leaving.
- **Why Q4 looked static:** December equals November when the staffing app has no end date for anyone in the house.
  Once «סיום העסקה» is recorded there with a date, December drops here by itself — in this tab, in the quarter card
  and in the December bonus card. Until then the simulation shows the effect.

## 6. «שיחות עם משפחה» — after «מטופלים»

- **אנשי קשר לפי מטופל/ת**: one row per patient in the house — the contact person, the relation, the phone (a `tel:`
  link), the last documented call, how many calls, and «+ רישום שיחה».
- The contact comes from the Dashboard: the lead the patient came from (`houseData.patients[].contact`). To fix a
  detail, it is fixed in the Dashboard. Needs E-Zone-Dashboard #402; without it the tab says the contact is not
  connected yet, and calls can still be documented.
- **+ רישום שיחה**: patient, who you spoke with, relation, date, time, the main points, an optional follow-up date.
  Picking a patient shows their contact and fills the two fields when they are empty.
- **השיחות המתועדות**: grouped by patient, newest first, with a patient filter. A follow-up that is due shows in the
  «🔔» strip. Only the author or an admin can mark it done or delete.
- The same calls are in the patient card, in a new «משפחה» tab, with the contact details.
- Log `familyCalls` (Dashboard sheet `ManagersFamilyCalls`, unchanged since October). The family-calls log was removed
  from the app on 14 Oct 2026 and is back now, by this decision.

## 7. Duplicated information removed

| Was shown twice | Now |
|---|---|
| The reminders: the «🔔» strip above the tabs, and «בקשות פתוחות» inside the «הבית היום» card | The strip only (it has «בוצע»). The card keeps the count. |
| The therapists: in «צוות ומשמרות» → «עובדי הבית», and in «מטפלים» | «מטפלים» only, now with «כרטיס ←». «צוות ומשמרות» links to it. |
| «נקלטו»: on «הבית היום» («נקלטו לאחרונה») and in «מטופלים» | «מטופלים» only. «הבית היום» links to it. |
| Manpower cost: the card on «הבית היום» and «תקציב כוח אדם» | Both stay (a summary and the detail); the card now links to the tab. |

Also fixed: the link buttons under the home cards were white text on pale grey; wide tables (workers, leavers,
contacts, budget lines, the quarter) are shown one block per row on a phone, each value with its label.

## Security

- Access is unchanged: a manager sees only their own house; the server decides the house on every call.
- The contact person is family personal data. It arrives only inside the manager's own `houseData`, is `no-store`,
  is never cached by the service worker and never logged. A phone becomes a link only when it is a plain local number.
- Every feed value is escaped; `crm.js` stays pure (no `innerHTML`, `fetch` or `console`).
- The simulation and the open / closed state of the cards never leave the page and are never stored.
- No new endpoint, env var, secret or dependency.
