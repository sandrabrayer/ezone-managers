# MGR-ID-02 — Managers cross-system worker identity & update-flow handoff
**Date:** 21 Nov 2026 · **Scope:** Managers only · **Reference:** draft PR #82, issue #81, program Dashboard #331.
**Decision:** Keep *every existing account, role, house scope and compensation entitlement unchanged*. No merge, production deployment, external code changes, live-user test or data rewrite.

## 1. Ownership, real sources and existing flow (read-only code inspection)

| Hop | Owner / existing source | Currently delivered | Gap / requested owner-side correction |
|---|---|---|---|
| HR / Staffing | Staffing v3 `workers.id` and `assignments.worker_id`, `assignments.id` | Stable per-person ID exists **inside HR**; placements are distinct | **HR owner:** append stable `workerId` and per-house `assignmentId` (when applicable) to existing outbound roster/worker-cost feeds. Never replace columns or put payroll/PPI into Coordinators digest |
| Staffing → Coordinators | `GuidesRoster` digest, existing columns house, guideName, startDate, updatedAt, status, endDate, role | Names, house, employment dates and status; **no worker ID in frozen schema** | **HR + Coordinators owners:** append optional `workerId`/`assignmentId`, read by header, refuse older/undated identity versions, reconcile rename and 2-house placements via ID (not phone) |
| Coordinators → Dashboard | `ManagersShifts`, `ManagersStaff`, `ManagersTherapistWeek` in shared ManagersHouse digest | `ManagersStaff` includes house, name, kind, role, phone, onLeave, workdays, updatedAt, optional startDate. No workerId | **Coordinators owner:** append `workerId` (and `assignmentId` if meaningful) to `ManagersStaff`. Preserve the existing producer and other consumers, house scoping, therapist filtering and no-financial-fields rule |
| Dashboard → Managers | Apps Script `MW_DIGEST_TABS.staff` / `mwTeam_`; `managersWork` `houseData` | Projects name/kind/role/phone/onLeave/workdays/startDate; no workerId, read-only house | **Dashboard owner:** optional read-by-header `workerId`, return stable ID with each house staff member; preserve `available/stale/updatedAt` and current roles. No new mutable employee ledger |
| Dashboard feedback | `ManagersFeedbackLog`, `mwReadFeedback_`, `mwFeedbackDone_` | Append-only feedback rows with employee **name** and date; write checked by house + name (`some`, not unique ID) | **Dashboard owner:** append `workerId` column to the existing log; validate active person + house placement by workerId before writing; return `workerId` in reads and explicit capability/version. Ambiguous legacy name-only records remain unassigned until verified mapping |
| Dashboard private staff talks | `ManagersStaffTalks` via `managersWork` `logAdd/logUpdate` | Employee name plus author/actorId and ownership checks | **Dashboard owner:** append `workerId` on new rows and verify ID/house before write. Keep existing private author/admin rules **unchanged**. Never infer historical ownership from a name or phone |
| Staffing costs → Dashboard → Managers | `mwHouseStaffCost_`, existing worker-cost feed | **Current Dashboard code merges workers by `name` key** and merges ending `people` by name; it may turn two identically named persons into one cost row. Individual costs/birth dates and budget totals are already used by Managers | **HR + Dashboard owners:** carry stable `workerId` per cost row; aggregate multiple assignments by `(workerId, house)` instead of name. Keep aggregate house totals and existing entitlements/bonus formulas exactly stable. Do not expose individual birth date/cost without an ID match; legacy ambiguous name-only rows show unresolved, not another person's value |

**Source evidence:** Staffing `apps-script/Code.gs` defines v3 `workers.id` and `assignments.worker_id`; Staffing `DIGEST-CONTRACT.md` still documents no worker ID in `GuidesRoster`. Coordinators `DIGEST-CONTRACT.md` ManagersStaff schema ends at optional `startDate`. Coordinators `apps-script/Code.gs` `refreshManagersHouseDigest` rebuilds that existing digest. Dashboard `apps-script/Code.gs` `MW_DIGEST_TABS.staff`, `mwTeam_`, `mwFeedbackDone_`, `mwReadFeedback_`, `mwHouseStaffCost_` show the read/write and by-name cost joins described above. These are **code/contract findings**, not proof the entire new chain is live.

## 2. Changes implemented in Managers draft PR #82

- Distinct same-name roster people remain separate. Prefer a verified `workerId`/`employeeId`; do not treat a generic `id` (potential assignment or log-row ID) as worker ID without explicit `idKind:'worker'`.
- A valid *unique* phone may distinguish two workers **in the UI only**. Phone is mutable/recyclable and never used to migrate historical records or as a backend write key.
- Employee cards, private-talk readback, feedback and cost/birth-date matching fail closed on ambiguous person identity. Only records carrying the **same stable worker ID** can follow a renamed worker safely. The existing unique legacy name-only read remains available where no competing person exists.
- The **budget simulation** is *client-only* and keyed by name in the existing app. This draft detects duplicate names across roster **and** staffing cost rows, suppresses that person's simulation, prevents a stale saved scenario from applying to both people, avoids an arbitrary next-month/termination join and disables the ambiguous employee-card shortcut. Aggregate cost/budget figures remain unchanged; no financial calculations are sent to HR.
- Managers' proxy now returns `409 identity_contract_required` when a client claims a `workerId`, `employeeId` or `assignmentId` in a name-only `feedbackDone`/staff-talk write. This prevents silent dropping of claimed identity; ordinary existing name-only writes and **all existing access controls** remain unchanged. This does **not** stop a manually forged ambiguous **name-only** request at the Dashboard source.
- Existing data/cache sources remain Dashboard + Coordinators + HR. No new database, staff ledger, roles, account changes, shared secrets or API endpoint added.

## 3. What remains BLOCKED outside Managers

1. **P0 — Stable employee identity contract and upstream source join**: append IDs in Staffing/Coordinators; Dashboard must project them. Add source contract fixtures for rename, duplicate names, transfers and multi-house employment. No name-to-ID backfill without verified proof.
2. **P0 — Source-side write enforcement**: Dashboard `mwFeedbackDone_` and staff-talk writer must reject ambiguous/forged name-only writes, validate worker ID + house + original actor, and persist the stable ID to the **existing** append-only history. Managers UI protections alone cannot guarantee a determined client cannot forge a name-only request.
3. **P0 — Cost feed identity**: current Dashboard combines worker and ending cost by display name; HR/Dashboard owners must fix grouping to worker ID and audit that total house cost and settled bonuses stay unchanged. Until then, the ambiguous person's row and personal scenario remain blocked locally.
4. **P1 — Actual propagation and business acceptance**: after owner changes and approved deployment, verify source save → digest refresh → Dashboard read → Managers reload → second authorized reader; stale/unknown data must **not** look like a zero or an absent employee. Validate source timestamp and deployed producer version. No live tests or production mutations were performed here.
5. **P1 — Employee lifecycle**: rename and phone change keep ID; two houses carry one worker ID but separate assignment ID; termination removes active placement while keeping historical staff-talk/feedback IDs; leave/return and rehiring must not create a second person. Managers remains a reader and does not author employment state.

### Recommended acceptance matrix (owned by each source team)

| Case | Required outcome |
|---|---|
| Two staff, identical names, distinct worker IDs, one house | Two distinct cards; separate feedback/talks/cost; no duplicated or misattributed write |
| Same person, 2 house assignments | One worker ID, two assignment IDs; manager sees only own house; historical records retain original house |
| Rename or phone replacement | Same worker ID and timeline in both viewers; old name-only notes remain unassigned without verified mapping |
| Unverified person or duplicate phone | Explicit ambiguity; no guess, no silent save and no personal cost applied |
| HR leave, end date, termination/re-hire | Source change travels through existing digest, stale timestamp visible; no phantom active person; historical records stay intact |
| Failed/downstream refresh or partial feed | Explicit unavailable/stale; retry, no fake zero, no new duplicate data store |
| Salary and role regression | Existing Managers access/house/payroll entitlements and business calculation parity remain exactly unchanged |

## 4. Release control and next step

The prior PR #82 exact-head Node+Chromium runs were already green and must **not** be re-run for the old head. Run fresh CI only for this PR's new commits, inspect failures, and record the exact head and links. Keep this a **draft**; no merge or Railway deployment without Sandra's explicit approval. Keep PR #80 permission work separate and unmerged. Source teams should file/attach their exact contract changes to Dashboard #331 and link them back to Managers #81. Once the source contracts are published and tested, Managers can switch the existing name-only edit forms to ID-based writes **in a separately approved patch**, without duplicating HR or CRM records.
