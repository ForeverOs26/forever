# Forever CRM Slice 1 — Implementation Contract

Task ID: `FOREVER-CRM-SLICE1-STAGE-AND-ACCESS-CONTRACT-001`
Status: **Canonical and Owner-authorized.** This document authorizes implementation of CRM Slice 1 and governs it.
Authorized base: `main` @ `2af08048a66bfe42b85c18d135235ddbd5cb66c1` (merge of PR #128)
Risk class of this document: R0 — documentation only. It creates no table, no migration, no application code.
Architecture basis: the completed external package `FOREVER-CRM-SLICE-1-ARCHITECTURE-RESEARCH-001` (verdict `ARCHITECTURE_READY`),
as amended by the Owner decisions recorded in §21.

---

## 0. What this document is, and what it is not

**It is** the single contract every future CRM Slice 1 pull request is reviewed against. Where it and any other CRM document
disagree, this document governs for Slice 1.

**It is not** an implementation. No CRM functionality, table, migration, generated type, application source, Worker configuration
or production change is created by the task that wrote it.

**It is not** authorization for a generic enterprise CRM. Slice 1 is a controlled minimum vertical slice through one guest
enquiry, and the deferred list in §15 binds as hard as the in-scope list in §14.

The approved architecture basis must not be enlarged. Anything not named in §14 is out of scope until separately authorized.

---

## 1. The authorized stage

The official project stage is now:

> **FOREVER CRM SLICE 1 — GUEST LEAD WORKSPACE AND ACCOUNTABLE FOLLOW-UP**

Previous stage: **Forever Studio — Publisher Direct Upload** (`FOREVER-STUDIO-001`).

### 1.1 What the stage change authorizes

- Controlled, staged, independently reviewable implementation of CRM Slice 1 exactly as bounded by §14.
- The scalable employee-access model of §9–§13, so the Owner can run a real sales team without a deployment per employee.

### 1.2 What the stage change explicitly does not authorize

| Not authorized                                                        | Status                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A completed CRM                                                       | Slice 1 is a minimum vertical slice, not a finished product                                      |
| A generic enterprise CRM                                              | Refused. The deferred list in §15 binds.                                                         |
| External CRM integration or migration                                 | Refused. Measured lead volume is 0; `docs/ROADMAP.md`'s build-versus-buy trigger is not met.     |
| Unified communications (WhatsApp / email / telephony send or receive) | Refused                                                                                          |
| Autonomous AI operation of any kind                                   | Refused. See §7.                                                                                 |
| Commission, credit, payroll or money accounting                       | Refused. No money concept ships in Slice 1.                                                      |
| Bulk marketing or marketing automation                                | Refused. No consent record exists anywhere.                                                      |
| Any change to Forever Factory autonomy                                | Unchanged. Factory remains **A0 — Propose only**.                                                |
| Activating Forever Studio                                             | Unchanged. Studio remains dormant unless separately authorized; its rollout gates are untouched. |
| Booth V2                                                              | A separate stream, unchanged by this contract.                                                   |
| Public Project Detail contact actions                                 | Remain **disabled**. See §16.                                                                    |

### 1.3 The previous stage's exclusions, honoured rather than overridden

The previous stage listed "large CRM integration" as out of scope and excluded "new architecture-only foundations without a
measured current-stage need". Both lines are honoured rather than overridden:

- **"Large CRM integration" remains out of scope.** Slice 1 integrates no external CRM and buys no seats. It is an internal,
  minimum operational layer over data Forever already collects.
- **"Architecture-only foundations" remains excluded.** Every element of §14 serves one named operating need, and §15 records
  what was refused for having no measured need.

---

## 2. The boundary in one paragraph

Make one guest enquiry survivable end to end: captured with its project and unit context intact, owned by a named person,
carrying exactly one next action, with an immutable record of everything that happened — and make the exceptions visible to a
Working Sales Manager and to the Owner without asking anyone to watch a dashboard. Everything that does not serve that sentence
is deferred.

---

## 3. Canonical role model

Slice 1 freezes **exactly four CRM actor types**. No further production CRM role may be introduced in Slice 1.

| #   | Actor                       | Nature                                                             |
| --- | --------------------------- | ------------------------------------------------------------------ |
| 1   | **Owner**                   | Global CRM authority. Sole holder of access-administration rights. |
| 2   | **Working Sales Manager**   | A producing sales agent who additionally leads an authorized team. |
| 3   | **Agent**                   | A producing sales agent.                                           |
| 4   | **System automation actor** | Not a person and not an employee account. See §7.                  |

### 3.1 Roles that must not be created in Slice 1

Booth Host · Forever Guide · Analyst · Auditor · Administrator · Partner · Project Manager · Marketing Manager.

**Booth Host and Forever Guide are operating descriptions, not authorization roles.** A person doing either job operates through
Agent or Working Sales Manager permissions as appropriate. Creating a distinct role for them would ship a permission set nothing
enforces.

An **Administrator** distinct from the Owner is refused for Slice 1 even at the expected headcount: the Owner retains sole access
authority by explicit decision (§4), so a delegated administrator would be a shape for an organisation Forever does not yet have.

---

## 4. Owner

The Owner holds global CRM authority. **Only the Owner may:**

**Access administration**

- grant CRM access;
- revoke CRM access;
- assign the Agent role;
- assign the Working Sales Manager role;
- change Agent → Working Sales Manager;
- change Working Sales Manager → Agent;
- activate a disabled employee;
- deactivate an employee;
- create or change team structures;
- assign Agents to Working Sales Managers.

**Company-wide operation**

- view all company leads;
- view all manager and agent queues;
- reassign any lead;
- override assignment restrictions;
- approve exceptional ownership extensions;
- access company-wide exports;
- view staff-role history;
- view access-change audit history.

### 4.1 The Owner must not need a developer to run the team

Adding, activating, deactivating or re-roling an employee must require **none** of the following:

no schema change · no migration · no application code change · no redeployment · no per-employee permission policy ·
no hard-coded staff account · no external CRM seat purchase · no replacement of the internal Forever CRM architecture.

This is a hard acceptance condition for PR 2 and PR 10 (§19), not an aspiration.

---

## 5. Working Sales Manager

The canonical role name is **Working Sales Manager**. It must appear under that name in documentation, UI copy and the role
vocabulary. "Manager" alone is acceptable only as an in-code identifier.

### 5.1 Definition

A Working Sales Manager is **not** an administrative-only manager. The role is simultaneously:

- an active real-estate sales agent;
- a team leader;
- a lead-distribution authority for one authorized team;
- a manager of overdue and exception queues;
- a participant in their own sales pipeline.

The role includes **all Agent capabilities for the manager's own leads**, plus the defined team-management capabilities below.

### 5.2 Two logically separate work areas

A Working Sales Manager has one account and one role, and two clearly distinct work areas.

**A · MY WORK** — the manager as a producing agent

- leads personally assigned to the manager;
- the manager's next actions;
- the manager's overdue follow-ups;
- the manager's guest requirements;
- the manager's project and unit shortlists;
- the manager's own pipeline;
- the manager's own nurture and reactivation cases.

**B · MY TEAM** — the manager as a team leader

- Agents assigned to the manager's authorized team;
- new and unassigned team leads;
- untouched team leads;
- overdue team follow-ups;
- team leads without a next action;
- leads approaching the 21-day boundary;
- 21-day manager-review cases;
- nurture candidates;
- reactivated leads;
- transfer requests;
- workload and capacity indicators;
- leads requiring manager intervention.

### 5.3 A Working Sales Manager may

| Personal (My Work)                     | Team (My Team)                                |
| -------------------------------------- | --------------------------------------------- |
| work personal leads                    | assign leads to Agents in the authorized team |
| receive new leads                      | reassign team leads                           |
| record personal lead activities        | release a lead into an approved queue         |
| maintain personal next actions         | move appropriate leads into nurture           |
| add guest requirements                 | review reactivated leads                      |
| add project and unit shortlist entries | intervene in overdue cases                    |
|                                        | approve or reject permitted transfer requests |
|                                        | help Agents with difficult negotiations       |
|                                        | see team exception queues                     |
|                                        | see operational team counts and workload      |

### 5.4 A Working Sales Manager may not

- create an Owner;
- grant CRM access;
- create another Working Sales Manager;
- promote an Agent;
- reactivate disabled staff;
- assign Agents outside the manager's authorized team without Owner authority;
- access another manager's team unless separately authorized;
- delete staff history;
- delete lead history;
- edit immutable CRM events;
- hide overdue personal leads;
- exempt personal leads from accountability;
- alter historical timestamps;
- rewrite loss reasons;
- remove audit evidence;
- export the entire company database unless the Owner grants an explicit permission.

Export is **Owner-only by default**. Any manager export capability requires an explicit, revocable, audited Owner grant and is
scoped to the manager's authorized team.

### 5.5 The manager's own leads are not privileged

The same rules apply to a Working Sales Manager's personal leads as to any Agent's leads:

- mandatory next action while the lead is active;
- 4 / 7 / 28-day follow-up defaults;
- overdue indicators;
- 21-day ownership accountability;
- immutable activity history;
- required loss reason;
- nurture rules;
- reactivation rules.

### 5.6 The anti-concealment rule

**A Working Sales Manager must not be able to use team authority to conceal or rewrite problems in the manager's own pipeline.**

Concretely, the implementation must satisfy all of the following:

1. A manager's personal leads appear in the Owner's exception queues on the same terms as any other lead. There is no suppression,
   snooze, mute or exclusion control anywhere in the product.
2. A manager may **not** grant an ownership extension to a lead assigned to themselves. Self-extension is an exemption from
   accountability and requires Owner authority.
3. A manager taking a team lead into their own pipeline is a team-management mutation: it records the acting manager, and the count
   of manager self-assignments is visible in the Owner's view.
4. A manager may not move a stage backward. Backward correction is Owner-only with a mandatory written reason, because backward is
   the only move that can make history disagree with itself.
5. Every management intervention — assignment, reassignment, release, extension, transfer approval or rejection, nurture move —
   creates audit evidence naming the acting manager, the affected lead and the stated reason.
6. Nothing a manager does can delete, edit or backdate an immutable event.

---

## 6. Agent

**An Agent may:**

- access leads assigned to the Agent;
- see the permitted guest contact data for an authorized lead workspace;
- record calls, WhatsApp interactions, emails, meetings and notes;
- update permitted guest requirements;
- set and complete the canonical next action;
- move leads through permitted lifecycle and pipeline transitions;
- add projects and units to the shortlist;
- record guest reactions;
- request reassignment;
- request manager intervention;
- view the Agent's own queues and overdue work.

**An Agent may not:**

- view all company leads;
- view unrelated team leads;
- grant CRM access;
- change their own role;
- promote another employee;
- assign arbitrary leads to themselves;
- reassign leads without authority;
- delete a lead to hide history;
- edit or delete immutable events;
- export company-wide guest information;
- bypass the next-action requirement;
- alter the 21-day clock without an authorized and audited operation.

---

## 7. System automation actor

The future system actor:

- is **not** a normal employee account and holds no staff membership row;
- is **not** represented as an Agent or a Working Sales Manager anywhere in the product;
- must carry a clearly identified actor kind on every row it writes;
- may perform only explicitly authorized automation;
- must produce append-only audit events;
- must use idempotency keys, so a repeated tick is a no-op;
- must never silently assign, lose, delete or contact a lead;
- must remain subordinate to human approval boundaries.

Because it holds no membership row, a bug that treats the system actor as a member fails the membership lookup rather than
escalating.

**No autonomous AI behaviour is authorized in Slice 1.** No AI may route, score, summarise, decide or contact.

---

## 8. Initial staff capacity — estimates, not limits

The initial operational expectation at first release is:

| Actor                  | Initial expectation  |
| ---------------------- | -------------------- |
| Owner                  | 1                    |
| Working Sales Managers | approximately 5      |
| Agents                 | approximately 10     |
| **Total CRM users**    | **approximately 16** |

**These counts are operational launch estimates only.** They are explicitly **not**:

technical limits · licensing limits · role-slot limits · permanent staffing limits · a maximum of any kind.

The platform must support, without any of the changes forbidden in §4.1:

- adding more Agents;
- adding more Working Sales Managers;
- reducing staff counts;
- changing team composition.

No number in this section may be encoded as a constant, a capacity check, an array length, a slot count or a seat limit anywhere
in the implementation.

---

## 9. Scalable staff access model

Future implementation must express CRM access as **staff membership records and role values** on the authorization roster that
already exists, resolved at request time on the server.

### 9.1 Explicitly rejected

Every item below is a review-blocking defect if it appears in any CRM pull request:

- hard-coded arrays of ten Agents;
- hard-coded arrays of five Working Sales Managers;
- numbered employee slots;
- `agent_1`, `agent_2`, `manager_1` columns;
- one column per employee;
- one table per team;
- one database policy per employee;
- code branches for named staff;
- deleting a staff identity when employment ends;
- external CRM seat-based architecture.

### 9.2 Required properties

1. Granting access is **data**, not deployment: a row change, performed through an Owner-only server operation.
2. The default for every existing and future roster row is **no CRM access**. A migration that introduces the model must grant
   nobody anything.
3. Authorization is resolved server-side from the roster on every request. It is never read from a token claim and never decided
   in the browser.
4. Hiding a control in the UI grants and denies nothing. Every command re-resolves the actor server-side.
5. No staff member may alter their own authorization role, activation state or team membership through any CRM surface. The
   Owner's own Owner status is not changeable through the CRM at all.

---

## 10. Team membership model

Slice 1 requires a **scalable team-membership model or an equivalent relational structure**: a team identity, and a membership
relationship between a person and a team carrying that person's role in it.

Required behaviour:

- an Agent belongs to a team led by a Working Sales Manager;
- a Working Sales Manager leads exactly the team or teams the Owner authorized;
- team composition changes are data changes, never schema or code changes;
- every team-membership change is audited with actor, timestamp and previous value;
- historical team membership is preserved, so a past event can be read against the structure that existed when it happened.

**Do not build an HR system.** No payroll, attendance, employment contract, salary, seniority ladder, org-chart editor or
capacity-planning engine. The model exists to answer two questions only: _whose leads are these_ and _who may act on them_.

### 10.1 Visibility consequence

Team scoping is a **security boundary** in Slice 1, not a convenience filter:

- an Agent sees the Agent's own leads and nothing beyond the authorized scope;
- a Working Sales Manager sees personal leads plus the authorized team's leads;
- the Owner sees everything.

Because scoping exists, indirect-object-reference control is load-bearing: a request for a lead outside the actor's authorized
scope must be refused with the **same response and the same code path** as a request for a lead that does not exist. Any
cross-scope signal — including a duplicate-guest banner, a count, an error difference or a timing difference — is a leak and must
be treated as one.

---

## 11. Staff lifecycle contract

The future CRM implementation must support all seventeen:

| #   | Requirement                                                                            |
| --- | -------------------------------------------------------------------------------------- |
| 1   | Adding an authenticated staff account                                                  |
| 2   | Granting CRM access                                                                    |
| 3   | Assigning Agent or Working Sales Manager                                               |
| 4   | Assigning the employee to an authorized team                                           |
| 5   | Activating access                                                                      |
| 6   | Deactivating access                                                                    |
| 7   | Reactivating access                                                                    |
| 8   | Changing Agent ↔ Working Sales Manager through an Owner-authorized operation           |
| 9   | Transferring active leads before or during deactivation                                |
| 10  | Preventing disabled employees from receiving new leads                                 |
| 11  | Immediately refusing CRM access after deactivation                                     |
| 12  | Preserving historical assignments                                                      |
| 13  | Preserving historical events                                                           |
| 14  | Preserving the employee's historical identity                                          |
| 15  | Preserving the employee's name or stable display identity used at the time of an event |
| 16  | Preventing hard deletion while CRM history references the employee                     |
| 17  | Auditing every role, activation and team-membership change                             |

### 11.1 Default safe rule

> **Only the Owner may grant, revoke, activate, deactivate or change CRM roles.**
>
> Working Sales Managers may manage leads and authorized team operations. They may not manage CRM access rights.

---

## 12. Deactivation

### 12.1 Before deactivation, the Owner UI must identify

- active leads assigned to the employee;
- overdue next actions;
- open manager interventions;
- nurture cases;
- future next actions;
- unresolved transfer requests.

### 12.2 The Owner must be able to

- transfer active leads;
- transfer team responsibility;
- disable assignment eligibility;
- deactivate access.

### 12.3 Deactivation must not

- delete the employee;
- delete assignments;
- delete activities;
- delete notes;
- delete manager actions;
- rewrite the historical actor;
- erase audit records.

**Historical events continue to display the original actor.** Offboarding is never an account deletion. Because an underlying
authentication account can in principle be removed outside the CRM, every actor-bearing CRM row must carry a stable display
identity captured at write time, and every actor reference must be non-destructive — removing a person must never remove a
guest's history.

---

## 13. Owner-only CRM Staff Access view

A required Slice 1 view: **CRM Staff Access**. It is **Owner-only**.

It is required inside the approved Slice 1 boundary and **must not be implemented during this documentation task**; it is
delivered by PR 10 (§19).

The view must eventually allow the Owner to:

- find an authenticated staff user;
- grant CRM access;
- choose Agent or Working Sales Manager;
- activate access;
- deactivate access;
- reactivate access;
- assign team membership;
- assign Agents to a Working Sales Manager;
- see current role;
- see current access state;
- see active lead counts;
- see whether deactivation requires lead transfer;
- transfer active leads;
- see role-change history;
- see activation history;
- see who performed each access change.

**It must not become:** payroll · HR management · attendance tracking · employment contracts · salary management ·
commission accounting.

---

## 14. CRM Slice 1 — in scope

The authorized direction, frozen:

**Capture and intake**

- context-preserving lead capture;
- privacy-safe list DTOs;
- authorized detailed lead DTOs;
- server-mediated CRM writes.

**Working surfaces**

- Lead Inbox;
- My Leads;
- Lead Workspace;
- Working Manager **My Work** view;
- Working Manager **My Team** view;
- Team Queue;
- manager exception queues.

**Ownership and accountability**

- company ownership of leads;
- assigned operational responsibility;
- originating-agent history;
- controlled lead lifecycle;
- controlled sales pipeline;
- append-only activity timeline;
- mandatory next action for active leads;
- overdue follow-up detection;
- missing-next-action detection;
- 4 / 7 / 28-day default timing;
- 21-day ownership accountability;
- nurture;
- reactivation;
- loss reasons.

**Guest understanding**

- guest requirements;
- project shortlist;
- unit shortlist.

**Access and governance**

- scalable staff access;
- scalable team membership;
- Owner-only Staff Access administration;
- immutable role and assignment history;
- audited management interventions.

---

## 15. Deferred and unauthorized for Slice 1

Nothing below is authorized. A pull request that introduces any of it is out of contract regardless of how small the change is.

full multi-task workflow engine · unified communications inbox · WhatsApp Business API synchronization · Gmail synchronization ·
Google Calendar synchronization · telephony · call recording · autonomous AI follow-up · autonomous AI lead routing ·
AI contact without approval · commission calculations · payroll · advanced business intelligence · bulk marketing campaigns ·
marketing automation · external CRM integration · external CRM migration · CRM marketplace · seller and resale CRM ·
full recommendation engine · document signing · payment handling · guest-facing CRM portal · automated legal advice ·
unrestricted data export.

---

## 16. Public contact-action boundary

**Public Project Detail contact actions remain disabled.** CRM Slice 1 must not silently enable any of:

- WhatsApp CTA;
- enquiry CTA;
- mobile contact bar;
- unit-row contact action;
- direct guest messaging.

Any future public contact activation requires **separate Owner authorization, a privacy review and its own release task**. It is
not a side effect of shipping a CRM, and no CRM pull request may flip the gate.

---

## 17. Security contract

### 17.1 The existing public model is preserved exactly

- the existing anonymous public lead INSERT remains limited to the approved intake path;
- anonymous browser SELECT on `public.leads` remains denied;
- authenticated browser SELECT on `public.leads` remains denied.

### 17.2 Every future CRM implementation must satisfy

**Privilege**

- no CRM table receives browser write privileges;
- no CRM table relies only on row-level security while broad table privileges remain;
- every CRM migration explicitly revokes browser privileges for the tables it creates;
- every CRM migration verifies effective privileges before `COMMIT` and aborts rather than committing a half-secured table;
- `service_role` is never exposed to the browser.

> **The single most important security rule in Slice 1.** A newly created table can inherit browser privileges from the schema
> default ACL. This requires no attacker — only a migration that forgets its verification tail. A CRM migration without an
> aborting privilege postcondition is a breach, not a style issue.

**Authorization**

- complex transitions are server-mediated;
- role, team and assignment authorization is checked server-side;
- no staff member can alter their own authorization role;
- disabled staff lose access immediately.

**Data exposure**

- detailed contact data is returned only for an authorized Lead Workspace request;
- Lead List DTOs contain no email, no phone and no message, so no single request can return a roster of guest contact details;
- no generated internal database row crosses hydration directly.

**Evidence**

- immutable events cannot be updated or deleted;
- role changes are audited;
- team changes are audited;
- management interventions are audited.

### 17.3 Order of operations

No CRM database migration may be applied to production before the Storage migration state is re-established and independently
verified (§20). Merging a migration is not applying it.

---

## 18. Working Manager UI contract

The future CRM information architecture must make the two manager responsibilities **visually distinct**.

| MY WORK                     | MY TEAM                        |
| --------------------------- | ------------------------------ |
| personal lead inbox         | team lead inbox                |
| personal active leads       | team assignment queue          |
| personal next actions       | overdue team follow-ups        |
| personal overdue follow-ups | team leads without next action |
| personal nurture cases      | 21-day review queue            |
| personal pipeline           | nurture candidates             |
| personal shortlist activity | reactivation cases             |
|                             | transfer requests              |
|                             | manager intervention requests  |
|                             | workload overview              |

Required properties:

- **Do not require two accounts.**
- **Do not require switching roles.** The Working Sales Manager uses one account and one role.
- The UI must clearly label whether the user is acting on the manager's own lead, an Agent's lead, or performing a
  team-management action.
- Every team-management mutation records the acting manager.
- Workload is rendered as **counts of work states**, never as a leaderboard, ranking, ratio or per-person performance comparison.

---

## 19. Implementation sequence

Future work proceeds as independently reviewable pull requests in this order. Exact numbering may be refined; the sequence and the
gates may not.

| PR        | Content                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PR 0**  | Stage, scope, Working Manager and scalable staff-access contract — **this task**                                                                                                 |
| **PR 1**  | Public contact-context repair. Preserve `projectSlug` and unit context with **no CRM schema changes**                                                                            |
| **PR 2**  | CRM security and schema foundation: staff CRM role field, team/access model, CRM tables, explicit browser-privilege revocation, database postconditions and a PostgreSQL harness |
| **PR 3**  | Authentication, CRM policy and server command/query services                                                                                                                     |
| **PR 4**  | Privacy-safe Lead List and Lead Workspace DTOs                                                                                                                                   |
| **PR 5**  | Lead Workspace UI                                                                                                                                                                |
| **PR 6**  | Assignment, next action and append-only activity timeline                                                                                                                        |
| **PR 7**  | Working Manager My Work / My Team views and manager queues                                                                                                                       |
| **PR 8**  | 21-day accountability sweep and nurture / reactivation handling                                                                                                                  |
| **PR 9**  | Project and unit shortlist integration                                                                                                                                           |
| **PR 10** | Owner-only CRM Staff Access view                                                                                                                                                 |
| **PR 11** | Independent security, privacy and role-authorization review                                                                                                                      |
| **PR 12** | Controlled production release                                                                                                                                                    |

### 19.1 Binding PR discipline

- **Independently reviewable PRs.** One reviewer must be able to hold the whole change and state exactly what breaks if it is wrong.
- **Narrow file scopes.** A pull request that sprawls is a signal the slice boundary was drawn wrong; re-cut it rather than merge it.
- **No combined schema + full UI + deployment PR.** Ever.
- **No production release before independent security review** (PR 11 precedes PR 12, and PR 11 is performed by someone who did not
  write the implementation).
- **No CRM migration application before the Storage migration state is verified** (§20).
- PR 1 is independently valuable and may ship alone. If the rest of Slice 1 were later stopped, PR 1 remains correct.

---

## 20. Storage migration and the migration-application boundary

`supabase/migrations/20260731100000_storage_default_acl_hardening.sql` is present in `main` (merged by PR #128) and **has not been
applied to production**. Applying it remains a separate, controlled, Owner-gated operation.

Two consequences bind CRM work:

1. **No CRM database migration may be applied to production before the Storage migration state is re-established and
   independently verified.**
2. Applying any later migration replays the pending backlog before it. The backlog's size must be re-derived at the moment of
   application from a live read of the applied-migration ledger diffed against the migration directory — never from a count
   written in a document, including this one.

Anyone describing a CRM apply as "one migration" has missed this.

---

## 21. Owner decisions that supersede the architecture research

The research package is the approved architecture basis. The following Owner decisions supersede it where they differ, and the
differences are recorded rather than absorbed silently.

| #        | Research position                                                                 | Owner decision (governs)                                                                                                                       | Consequence                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OD-1** | Slice 1 is _proposed_; a stage change is the blocking question                    | **Authorized.** Stage change recorded in §1                                                                                                    | Implementation may begin at PR 1                                                                                                                                                       |
| **OD-2** | Headcount at release is unknown; if one person, defer a third of the slice        | **1 Owner, ~5 Working Sales Managers, ~10 Agents, ~16 total**                                                                                  | Assignment, the 21-day rule and the manager queues are all load-bearing. Nothing is deferred for being ceremony over a single actor.                                                   |
| **OD-3** | Every CRM member sees every lead; visibility groups are an explicit non-feature   | **Team-scoped visibility is required.** Agents may not view all company leads or unrelated team leads                                          | Scoping becomes a security boundary (§10.1). Cross-scope refusal, identical error responses and the duplicate-signal surface are now real controls, not habits.                        |
| **OD-4** | Team, office or region scoping deferred until a second office                     | **A scalable team-membership model is required in Slice 1** (§10)                                                                              | Adds a team identity and membership relation to the PR 2 foundation                                                                                                                    |
| **OD-5** | Role named "manager" / "Sales Manager"                                            | **Working Sales Manager**, defined as a producing agent who also leads a team, with two distinct work areas                                    | My Work / My Team is a required information architecture (§18), not a preference                                                                                                       |
| **OD-6** | Membership administration exists as a capability, with no user interface          | **Owner-only CRM Staff Access view is required** (§13), delivered by PR 10                                                                     | The Owner runs the team without a developer (§4.1)                                                                                                                                     |
| **OD-7** | An Administrator role becomes worth considering past roughly fifteen members      | **Refused for Slice 1.** The Owner retains sole access authority                                                                               | No fifth role                                                                                                                                                                          |
| **OD-8** | Agent self-claim from an unassigned pool is the only way an agent gains ownership | **Not authorized as an unrestricted right.** The Owner's Agent capability list omits claiming and forbids assigning arbitrary leads to oneself | Default: assignment is performed by the Owner or a Working Sales Manager. A bounded claim from the agent's own authorized team queue is an **open decision** (§22), not an assumption. |

Everything in the research package that these decisions do not touch — the lifecycle and pipeline vocabularies, the single
mandatory next action, the append-only event model, the 21-day rule and its reset condition, the 4/7/28 defaults, the loss-reason
vocabulary, the shortlist model, the DTO split, the privilege posture and the migration discipline — is carried forward unchanged
and is the approved basis for PR 2 onward.

---

## 22. Open decisions carried forward

These are **not** blockers for PR 1. Each must be answered before the pull request that first depends on it.

| #    | Question                                                                                         | Needed by      | Safe default if unanswered                                               |
| ---- | ------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------ |
| OQ-1 | May an Agent claim an unassigned lead from their own authorized team queue?                      | PR 6           | **No.** Assignment is by Owner or Working Sales Manager.                 |
| OQ-2 | May one Working Sales Manager lead more than one team, and may an Agent belong to more than one? | PR 2           | One team per Agent; a manager may lead one or more, all Owner-assigned.  |
| OQ-3 | Where do guest WhatsApp conversations live today — a company number or personal accounts?        | before release | Unrecorded. If personal, the first action is operational, not technical. |
| OQ-4 | What are Forever's operating hours in Asia/Bangkok?                                              | before release | Leave unrecorded; report counts and ages, never a response-time target.  |
| OQ-5 | Does the enquiry form gain a privacy-notice line?                                                | PR 1           | Yes — a notice line, with no checkbox and no consent column.             |
| OQ-6 | Are public Project Detail contact actions opened after Slice 1?                                  | after release  | Remain closed. Separate authorization required (§16).                    |

---

## 23. Validation and review triggers

### 23.1 Every CRM pull request is checked against

1. It touches only what its stated scope requires.
2. It introduces no role beyond the four in §3.
3. It introduces nothing from the deferred list in §15.
4. It encodes no staff count, seat count or employee slot (§8).
5. It contains no per-employee policy, column, table or code branch (§9.1).
6. Any migration it adds revokes browser privileges and verifies them before `COMMIT` (§17.2).
7. Any list DTO it adds or widens carries no email, phone or message (§17.2).
8. Any management capability it adds records the acting manager (§5.6).
9. Any deactivation path it touches deletes nothing (§12.3).
10. It leaves the public contact gate closed (§16).

### 23.2 Review triggers for this contract

- The first request for a fifth CRM role.
- The first ownership dispute, or any Owner decision to change the 21-day holding period, its reset condition or its expiry action.
- A second office, or the first partner or contractor needing access.
- Any proposal to send a message to a guest from any code path.
- Any proposal to open the public Project Detail contact actions.
- Sustained enquiry volume above roughly 200 per month, which is the only condition under which the automation and
  build-versus-buy questions reopen.
- Adoption failure: no authenticated CRM session in any 14-day window after release. The recorded response is a **smaller**
  surface, not more features.
