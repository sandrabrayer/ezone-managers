# Worker identity v2 — Managers client compatibility with Dashboard #415

**Date:** 25 Nov 2026 · **Scope:** ezone-managers only · **Pairs with:** E-Zone-Dashboard
[PR #415](https://github.com/sandrabrayer/E-Zone-Dashboard/pull/415) (draft, head `f4aad02a258e`,
`docs/architecture/MANAGERS-WORKER-IDENTITY-v2-HANDOFF.md`) · **Program:** ezone-managers #63, #81 (merged #82).

## 1. What changes

The Managers app can now send `workerId` + `assignmentId` with the two personal writes. It sends them only when
the house's own roster carries a certified pair for that person. There is no new endpoint, op, env var, secret,
role or house rule.

| Write | Request (unchanged fields + the pair) | Where the pair comes from |
|---|---|---|
| Half-yearly feedback «בוצע» | `feedbackDone { employee, doneAt, workerId, assignmentId }` | the roster row of that feedback line (`houseData.team.staff[]`) |
| Staff talk, first talk | `logAdd staffTalks entry { employeeName, …, workerId, assignmentId }` | a unique name in the roster, or the employee card's «💬 רישום שיחה חדשה» (the card's person) |
| Staff talk, follow-up / outcome | the same, with `parentId` | the thread's first talk (`logs.staffTalks[]` row), followed to the roster row with the same pair. After a rename the current name is sent |

The **house** is never part of the identity sent by the browser. As before, the server takes it from the signed
session (an admin names one; `access.canSeeHouse` decides). Both the Managers gate and the Dashboard check the
pair against **that** house's roster.

## 2. When a pair is "certified" (all must hold)

1. The Dashboard put **both** fields on the staff row. #415 does this only from a certified `managers-house-v2`
   publication (`MANAGERS_DIGEST_REQUIRE_MANIFEST=true` and the Coordinators v2 publisher). Today's production
   Dashboard sends neither field.
2. Each field matches `/^[A-Za-z0-9_-]{1,120}$/`, the Dashboard's own pattern, with no trimming.
3. In this house's active roster, the assignment appears once **and** the worker appears once. One worker with two
   assignments in the same house is ambiguous, so it is refused.
4. The roster is fresh: `team.available === true`, `team.stale !== true`, and the page copy is not `__stale`.

`employeeId`, `idKind:'worker'` and phone are **never** a write identity (they are display-only, as in #82).

## 3. Server gate (`server.js` `verifyWorkerIdentity`)

The gate runs before anything is forwarded, after the session check, the house check and the write rate limit:

| Input | Reply | Forwarded? |
|---|---|---|
| no pair (legacy) | unchanged path | yes, name only (as today) |
| half a pair, or `employeeId` on a personal write | `409 identity_contract_required` | no |
| `workerId`/`assignmentId` on `events` / `familyCalls` | `409 identity_contract_required` | no |
| malformed pair (pattern, type) | `400 bad_request` | no |
| roster has no certified pairs at all (v1, today's production) | `409 identity_contract_required` | no. An id is never sent to a writer that would drop it (the #82 guarantee) |
| roster unavailable / stale / read failed / refresh failed | `409 identity_review_required` | no |
| pair not on exactly one active row **with this name** (swapped pair, another house's pair, renamed and old name, left the house) | `409 identity_review_required` | no |
| exactly one match | Dashboard call with `workerId`, `assignmentId` | yes; the Dashboard re-verifies under its lock |

The roster read is `houseData` for **this person + house**. It has its own read-cache key (`identityRoster`), so
the page's committee-merged copy is untouched. A stale copy is refreshed first, and a failed refresh refuses.
Every successful write to the house drops this copy, so a replay after a write is checked against a fresh roster.

**Replay:** a replayed request is re-authorised from scratch: the same session, the same house, the pair checked again.
It can never move a record to another person or house. The Dashboard's feedback log is append-only, as before:
the same feedback replayed adds a second row with the same date and identity. That was already true for
name-only writes, and the button ignores a double tap.

## 4. Client (`lib/feedback-due.js`, `public/work.js`, `public/crm.js`)

- `FeedbackDue.certifiedIdentity / uniqueIdentity / talkIdentity` are the pure rules from §2. They are unit-tested.
- **Feedback:** a certified row is writable even when its name is shared. The form carries the drawn pair
  (`data-fb-wid` / `data-fb-aid`), and the save refuses it when the live row's pair has changed since.
- **Staff talks:** a shared name typed in the form is refused, with «פתחו את כרטיס העובד/ת». The card's button
  carries its own pair (hidden `workerId` / `assignmentId` fields). Typing another name clears them. A legacy
  name-only thread never adopts a certified pair, because the Dashboard refuses that too.
- New Hebrew messages for `identity_review_required`, `identity_source_contract_required` and
  `identity_contract_required`. A raw code is never shown.
- **v1 (today's production):** no pair exists, so every request is byte-for-byte what #82 sent.

## 5. Not changed, and not claimed

- Roles, houses, `MANAGER_ACCESS`, staff-talk privacy (author + admins), rate limits, read-only rules.
- **Salary, cost, birth date, termination:** not touched. The HR worker-cost feed has no ids by policy. The card
  still matches cost rows only on an exact `workerId` that the feed does not carry, so it shows «ממתינה להתאמת
  מזהה עובד». None of this is certified by this change.
- History: old name-only feedback and talks stay unassigned to a certified worker. Nothing is rewritten.

## 6. Ready for integration with #415 — and what still blocks activation

**Ready in this draft (code + tests):** the request shapes that #415's `mwFeedbackDone_` / `mwLogAdd_` read
(`params.workerId/assignmentId`, `entry.workerId/assignmentId`), the reading of #415's `houseData.team.staff[]`
and `logs.staffTalks[]` pairs, and the handling of every #415 refusal code. Without #415 live it does nothing:
the inert default.

**Blocked outside this repo (in order):**
1. Coordinators publisher v2 (`ezone-coordinators#360`) writes `workerId,assignmentId` after `startDate`.
2. Dashboard #415 merged and deployed (Apps Script auto-deploys on merge), then
   `MANAGERS_DIGEST_REQUIRE_MANIFEST=true`. Both need Sandra's approval.
3. Paired synthetic UAT, then a user-role UAT: two same-name workers, a rename, a two-house worker, stale feed.

**Order:** this Managers PR can merge **before** #415. It is inert until the roster carries pairs. Merging after
#415 is also safe. While v2 is active and this PR is not, the Dashboard refuses name-only personal writes for the
whole house (`identity_source_contract_required`). So this PR must be live before the flag is turned on.

**Rollback:** turning the Dashboard flag off makes the roster v1 again, and the client goes back to name-only by
itself. Reverting this PR restores #82 exactly: ids are refused with a 409, and name-only writes still work under v1.
