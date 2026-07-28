# Forever CRM — Independent Review Record and Final Recommendation

Status: Proposal / review record (Draft, not approved, not implemented)
Last updated: 2026-07-28
Task ID: FOREVER-CRM-ARCH-001

**This document authorizes nothing.** It records an adversarial review of the CRM architecture package and how
each finding was resolved, and it states the architect's final recommendation. It does not authorize
implementation, schema change, migration application, deployment, or any production action. No SQL in this
document is a migration; every SQL block is illustrative and is captioned as such. Factory autonomy remains
**A0 — Propose only**. Nothing here has been executed: no database was contacted, no migration was applied, no
deployment was performed, and **this repository has no CI, so no gate anywhere in this package may be described
as having passed.** `[Repository fact]`

Companion documents: `docs/FOREVER_CRM_ARCHITECTURE_V1.md`, `docs/FOREVER_CRM_CURRENT_STATE_AUDIT.md`,
`docs/FOREVER_CRM_MARKET_RESEARCH.md`, `docs/FOREVER_CRM_IMPLEMENTATION_PLAN.md`,
`docs/FOREVER_CRM_EXECUTIVE_SUMMARY_RU.md`.

**Privacy content in this package is architecture research, not legal advice.** Every point carrying a
`[LAWYER]` flag must be confirmed by a Thai-qualified privacy lawyer before it is relied on.

---

## 0. How to read this document

The brief required that the independent review be **reconciled into the architecture, not attached raw**. This
is therefore a record of the review and its resolution — not a dump of 166 findings. It answers five questions
in order:

| Section | Question |
|---|---|
| §1 | How was the review conducted, and what did it return? |
| §2 | What survived scrutiny? |
| §3 | What broke, and what was done about it? |
| §4 | Which findings were **declined**, and why? |
| §5 | What is still wrong or unresolved? |
| §6 | What should Forever build first? |

Section §6 is the deliverable the Owner should read if he reads nothing else.

---

## 1. Method

`[Repository fact]` Eleven independent skeptical reviewers examined the package, one per required perspective.
Each reviewer was given the repository at `main` SHA `821b3c4e2f6f82e0d4ddce86199a8ff24b44a094` as the **arbiter**
— not the package, not the decision brief, not the other reviewers — and was instructed to verify claims by
reading the cited file rather than by trusting the citation. Each was told explicitly that **a review that finds
nothing is a failed review**, and each was required to return a verdict from a fixed scale and a list of
findings graded blocker / major / moderate / minor, each with a stated defect, a concrete failure it would cause,
and a proposed fix.

The eleven perspectives:

| # | Perspective | What it was told to attack |
|---|---|---|
| 1 | Real-estate brokerage operations | An off-plan sales floor, commission-paid agents, buyers in UTC+2..+4 |
| 2 | CRM product simplicity | Total conceptual surface; what can be deleted from v1 |
| 3 | Repository reuse and architectural consistency | "One Engine, Many Interfaces"; no parallel sources of truth |
| 4 | Database and identity design | Domain model, DDL, keys, constraints, merge, dedup |
| 5 | Security, privacy and RLS | Paranoid application-security review, including D3 |
| 6 | Agent mobile usability | IA and wireframes, judged as a product designer |
| 7 | Owner oversight and control | Can the Owner see and run the business through this? |
| 8 | Integration failure modes / SRE | What fails, what pages someone, what is unrecoverable |
| 9 | Overengineering prosecutor | Is this bigger than the problem? |
| 10 | Migration and release risk | Cutover safety, version ordering, rollback |
| 11 | Commercial value | What does this programme return? |

### 1.1 What came back

**166 findings: 20 blocker, 61 major, 60 moderate, 25 minor.**

**All eleven verdicts were `sound_but_needs_material_changes`.** None returned `significant_rework_required`;
none returned `fundamentally_flawed`. `[Repository fact]`

`[Inference]` That result should be read precisely, and not more generously than it deserves. Eleven hostile
readers, each with a different axe, each explicitly rewarded for finding damage, converged on the same verdict:
the decisions are right, the documents that carry them are defective. Twenty blockers is a lot of blockers. But
none of them attacked a decision — every one of them attacked the execution of a decision inside the documents.

### 1.2 Distribution of the blockers

| Class | Count | Character |
|---|---|---|
| One concept, two or three names across the package | 6 | Document defect from parallel authoring |
| A table referenced as mandatory with no DDL anywhere | 4 | Document defect (omission) |
| A constraint that cannot implement the behaviour its own document specifies | 3 | Drift between two sections written by different hands |
| Two incompatible `CREATE TABLE` statements for one table | 3 | Document defect (duplication) |
| A privilege or grant that does not do what it claims | 2 | **Genuine engineering defect** |
| A foreign key that erases the guarantee it carries | 1 | **Genuine engineering defect** |
| A promise made to a person that the runtime cannot keep | 1 | Design defect with a real operational cost |

`[Inference]` Fourteen of the twenty blockers are traceable to a single cause: the package was written by
multiple agents in parallel and assembled without a reconciliation pass. That is a process failure, and it is
recorded here as one — including the fact that the package shipped into review containing two sections that told
the reader, in writing, that its own sections had not been reconciled with each other. Both have been deleted.

---

## 2. What the review confirmed

`[Repository fact]` Each reviewer was required to return a "survived" list — decisions they attacked and could
not break. Across eleven independent lists, the following were confirmed, most of them more than once:

| Decision | Confirmed by | Why it held |
|---|---|---|
| **D1** — person identity spine + episodic work item; no separate Lead entity with destructive conversion | Simplicity, database, brokerage, reuse | The vendor convergence is real, and the alternative accretes CRM state onto the intake table |
| **D2** — `public.leads` stays the append-only intake log; it is not grown into the CRM | Reuse, migration, brokerage | The browser insert is the only path with real production rows and its source text is pinned by an existing test |
| **D3** — authorization at the app-server boundary; **no** `auth.uid()` RLS | Security, reuse, overengineering | `auth.uid()` appears in **zero** of the 24 migration files; `studio_members` and `audit_log` carry the explicit "RLS on, NO policies" precedent. The forfeited database-layer defence-in-depth is stated honestly rather than hidden |
| **D4** — ownership (permanent credit) separate from assignment (revocable work); the calendar-based 21-day lock `[Owner requirement]` rejected on evidence and re-offered as a configurable policy row | Brokerage, Owner oversight | A calendar lock rewards doing nothing for twenty days. No reviewer defended the calendar form; the Owner keeps the choice |
| **D5** — reuse the Studio claim/heartbeat durable-job pattern in a **separate** work-item table; no new infrastructure | Integration/SRE, reuse | The Studio due-jobs RPC joins `studio_members` and applies a shared limit; CRM rows would starve or be starved |
| **D6** — no WhatsApp API in v1; the agents' working number is a protected production asset | Integration/SRE, brokerage | The 1 Oct 2026 pricing inversion and the irreversible number-migration trap are both documented by the vendor |
| **D8** — consent as an append-only evidential record, not a boolean | Security, simplicity | A boolean cannot distinguish "refused at capture" from "withdrawn afterwards", and that distinction is the whole evidential value `[LAWYER]` |
| **D9** — adopt the phantom `navigator_*` vocabulary, reject the tables | Reuse | Seven declared table names exist in TypeScript and in **no** migration; building alongside them creates the second client system the mission forbids |
| **D10** — persist Navigator answers as enum keys; **no lead score, no fit percentage, no ranking** | Simplicity, Owner oversight, overengineering | The prohibition is executable, tested code in the matching module, which is stronger authority than a document |
| Contact-method UNIQUE index as the dedup engine; tombstone-and-repoint merge; no households table | Database, brokerage, migration | A constraint holds regardless of which code path writes; an application rule does not |
| Median first response reported **only** with coverage, and the anti-vanity list | Simplicity, Owner oversight | Publishing a median without its denominator is the classic lie: answer three fast, ignore thirty |
| The `*/5` cron honesty — timestamps exact, escalation resolution ≤5 minutes | Integration/SRE, brokerage, Owner oversight | The Owner's targets are a 2-minute acknowledgement and 5-minute human contact `[Owner requirement]`; refusing to print the 2-minute number in UI copy the runtime cannot honour is the correct call and is stated in six places |
| The "Do Not Build Yet" list as real restraint | Overengineering, security, simplicity | No households table, no probabilistic linkage, no trigram index at this row count, no un-merge, no role hierarchy, no field-level security |
| **Slice 0 before Slice 1** | Brokerage, simplicity, overengineering, Owner oversight | Named by four separate reviewers as the most valuable item in the package |

**The ten binding decisions came through nearly intact.** Not one of D1–D10 was overturned. `[Inference]` The
review's value was not in changing the architecture; it was in stopping a package that could not have been
implemented from the documents that carried it.

---

## 3. What the review broke, and how it was fixed

The architect reconciled all twenty blockers and the major findings that shared their root cause into fourteen
binding resolutions, R1–R14. Each is recorded below with the defect, the concrete failure it would have caused,
and the applied fix.

Before them, one mechanical pass: a deterministic rename was applied across the package (77 replacements) so
that every table has exactly one name. The canonical names are `crm_opportunity` and its satellites
(`crm_opportunity_party`, `crm_opportunity_stage_event`, `crm_opportunity_milestone`,
`crm_opportunity_attribution`, `crm_opportunity_shortlist`), `crm_activity`, `crm_intent_snapshot`,
`crm_client_registration`, `crm_routing_log`, and the column `assigned_user_id`. The three superseded names now
appear **zero** times in the package.

### R1 — One entity register, stated once
*Resolves blockers #1, #12, #15. Document defect.*

**Defect.** The package specified the same CRM twice under two non-overlapping sets of table names: the schema
section created one set, the metrics, integration, wireframe and backlog sections read another, and the activity
log had a third name that appeared in one document and nowhere in the other. A grep across the package yielded
roughly 38 distinct `crm_*` names for a design with far fewer tables.

**Failure it would have caused.** An implementer opening the package to build the first slice greps for the work
object, finds one name in the DDL and a different one in every screen spec, KPI definition and backlog row that
consumes it. Whichever they pick, half the downstream specs reference columns on a table that does not exist.
This is precisely the phantom-schema failure the package itself cites as the reason not to leave the
`navigator_*` declarations in place.

**Applied fix.** A **canonical entity register** immediately after §5.1 of the architecture, listing every
`crm_*` table with its purpose, its tier (`v1-slice1` / `v1-later` / `SHAPED` / `deferred`) and the section that
owns its DDL. Every other section now cites the register instead of restating shapes. Both "the assembler must
reconcile" placeholders were deleted — a shipped document must not contain them.

### R2 — The five missing tables
*Resolves blockers #8, #15. Document defect (omission).*

**Defect.** Five tables the package treats as mandatory had no DDL anywhere in it: `crm_policy`,
`crm_assignment`, `crm_routing_log`, `crm_opportunity_stage_event`, `crm_viewing`.

**Failure.** Six of the twenty-one KPIs are uncomputable. Three of the five numbers on the Owner's daily screen
cannot be produced. The routing log that D4 promises — the artefact whose stated purpose is settling arguments
about who got which lead — does not exist, so the design's own answer to the most political failure mode in a
commission-paid team is unbuilt.

**Applied fix.** Illustrative DDL added in §6.4 for all five, and all five moved out of the deferred group in the
§6.2 ERD.

### R3 — The stage CHECK must implement the state machine it claims to implement
*Resolves blockers #3, #6. Drift defect — and **the most operationally damaging finding in the review.***

**Defect.** `nurture` is a first-class state in the lifecycle: the state diagram defines four transitions into
it, the transition table gives it preconditions, and the re-engagement path depends on it entirely. The
`crm_opportunity.stage` CHECK did not contain it. Nor `spam`. The terminal states were named inconsistently
between the state machine and the DDL, and the transition table wrote ten timestamps that exist as no column.
Compounding it, invariant INV-O1 was a hard CHECK requiring `next_action_at IS NOT NULL` on every non-closed
stage.

**Failure — the one to read.** An advisor speaks to a real buyer in July who says *"we're deciding after the
school year, call me in March."* There is no `nurture` stage to move them to. The advisor has exactly two legal
moves: leave the opportunity open, in which case INV-O1 forces a `next_action_at` and the buyer appears on "My
Work Today" as **OVERDUE every single day for eight months**; or set `closed_lost`, which clears the list.
Agents will take the second. Within a quarter the entire warm pipeline is recorded as lost, the lost-reason
report is meaningless, and the funnel arithmetic the design exists to keep honest is corrupted — by a design that
punished the correct answer. `[Inference]`

**Applied fix.**
- `nurture` and `spam` added to the `crm_opportunity.stage` CHECK.
- `next_review_at TIMESTAMPTZ` and `prior_opportunity_id UUID REFERENCES crm_opportunity(id)` added.
- INV-O1 amended to `stage IN ('closed_won','closed_lost','nurture','spam') OR next_action_at IS NOT NULL`.
- A companion CHECK added: `stage <> 'nurture' OR next_review_at IS NOT NULL` — a nurtured buyer must carry a
  date on which someone looks at them again. "Not now" is not "never".
- §4's terminal names reconciled to `closed_won` / `closed_lost`, and §4.2's timestamp list reduced to columns
  that actually exist.

### R4 — Append-only must be enforced against `service_role` too
*Resolves blocker #4.* **Genuine engineering defect — a security hole.**

**Defect.** Every append-only table carried `REVOKE ALL ... FROM PUBLIC, anon, authenticated;` followed by a
narrow `GRANT INSERT, SELECT ... TO service_role;`, under a comment asserting that "append-only is enforced by
GRANT, not by convention". The REVOKE list omits `service_role` — **which is the only role the application
actually uses.** A GRANT only ever adds privileges; it never removes any. Supabase's default privileges on the
`public` schema already grant ALL on newly created tables to `service_role`, so the narrow grant added nothing
and removed nothing. The repository documents this exact mechanism in its own ACL-hardening migration
(`20260721123000_studio_internal_acl_hardening.sql:1-3`). `[Repository fact]`

**Failure.** The migration runs green. The safety comment says append-only is enforced. The application role
retains UPDATE and DELETE on `crm_consent_record` by platform default. A bug, a contributor, or an
incident-response one-liner issues `UPDATE public.crm_consent_record SET granted = true` and it **succeeds
silently**. The evidential value of the consent record — the entire reason it is append-only — is gone, and the
only thing that would have caught it is a test that, in a repository with no CI, runs when a human remembers.
`[LAWYER]`

**Applied fix**, on `crm_consent_record`, `crm_activity`, the audit-style tables and `crm_outbox`:

```sql
-- illustrative — not a migration
REVOKE ALL ON TABLE public.crm_consent_record
  FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT ON TABLE public.crm_consent_record TO service_role;
```

plus a stated pg-test asserting
`has_table_privilege('service_role','public.crm_consent_record','UPDATE') = false`. A note was added recording
that in Supabase, *omitting* a grant is not the same as *revoking* one.

### R5 — The `leads` additive migration widened the anonymous write surface
*Resolves blocker #13.* **Genuine engineering defect — a security hole.**

**Defect.** The migration adding columns to `public.leads` was labelled "PURELY ADDITIVE, anon policy UNCHANGED",
on the reasoning that it adds no new grant. That is the wrong test. The shipped grant is **table-level and
column-less** — `GRANT INSERT ON public.leads TO anon, authenticated`
(`20260704132000_create_leads.sql:29`) — and in PostgreSQL a table-level grant automatically extends to every
column added later. The INSERT policy's `WITH CHECK` (`:32-41`) constrains only `status` and the non-emptiness of
`name`, `email` and `phone`. `[Repository fact]`

**Failure.** After the migration, any browser holding the public anon key POSTs a lead carrying
`provenance_tier: 'server_intake'` — the tier that asserts the row came through a validated server path with
consent captured — plus a guessed `contact_id` attaching an attacker-authored enquiry to a real buyer's identity,
plus an arbitrary JSONB blob. All three pass, because the policy does not mention them. The one field the entire
lawful-basis argument rests on is attacker-controlled. `[LAWYER]`

**Applied fix**, in the same illustrative migration:

```sql
-- illustrative — not a migration
REVOKE INSERT ON public.leads FROM anon, authenticated;
GRANT INSERT (name, email, phone, country, budget, interest,
              project_slug, message, status, source)
  ON public.leads TO anon, authenticated;
-- and extend the existing INSERT policy's WITH CHECK with:
--   contact_id IS NULL AND provenance_tier IS NULL AND intake_metadata = '{}'::jsonb
```

The block was **reclassified from "purely additive" to "additive columns + privilege tightening"**, with the
reason stated: the column grant reproduces the shipped column set exactly, so it narrows the write surface back
to what production has today rather than changing the shipped contract.

### R6 — Permanent credit must actually be permanent
*Resolves blocker #7.* **Genuine engineering defect — a broken guarantee.**

**Defect.** `owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL` was the column carrying "permanent
credit". `studio_members.user_id` is `ON DELETE CASCADE` to `auth.users`
(`20260721120000_forever_studio_v1.sql:84`), so ordinary offboarding — deleting a departing advisor's Auth user —
triggers it. `[Repository fact]` The ERD also disagreed with the DDL about which table the FK even targets.

**Failure.** An advisor leaves in month 9. Her Auth user is deleted. Every opportunity she ever sourced silently
sets `owner_user_id = NULL`. D4 offers agents permanent credit **in exchange for** accepting that their work
assignment is revocable; that trade was unbacked for the one person most likely to test it — a departed agent
chasing a trailing commission on a deal that completes eighteen months after reservation. There is no snapshot,
so the record cannot be reconstructed.

**Applied fix.** `owner_user_id` and `assigned_user_id` now point at `public.studio_members(user_id)`, with
`ON DELETE RESTRICT` on owner; a **write-once `owner_display_name TEXT NOT NULL` snapshot** is stamped at
creation, mirroring the retained-identity pattern the repository already uses for Studio upload jobs. Deactivation
is `is_active = false`, **never** a row delete. The ERD was corrected to match.

### R7 — Merge must not violate the append-only guarantee it depends on
*Resolves blocker #5. Drift defect.*

**Defect.** The merge pseudocode issued `UPDATE` against `crm_activity` and `crm_intent_snapshot`, which are
granted INSERT and SELECT only, and referenced a `merged_from_contact_id` column that exists in no DDL.

**Failure.** An operator merges two duplicate contacts. Once R4's grant fix lands, the transaction aborts with
*permission denied* on the first merge of any contact that has activity — that is, every real merge. The whole
merge rolls back after the party-collision handling has already run, so the duplicate persists and there is no
partial state to diagnose from.

**Applied fix.** `merged_from_contact_id UUID REFERENCES crm_contact(id)` added to `crm_activity`; repointing
routed through a `SECURITY DEFINER` merge function, **or** a column-scoped
`GRANT UPDATE (contact_id, merged_from_contact_id)`. INV-A2 restated honestly as *"append-only except for merge
repointing, which is audited"* — an honest invariant beats an aspirational one.

### R8 — One definition per table
*Resolves blockers #14, #17. Document defect (duplication).*

**Defect.** `crm_consent_record` and `crm_suppression` each had two incompatible `CREATE TABLE` statements;
`crm_outbox` had three, and one of them silently dropped the `idempotency_key TEXT NOT NULL UNIQUE` that makes
an outbox safe at all.

**Failure.** An implementer building the event edge naturally starts in the integration section, creates the
outbox without an idempotency key, and the binding rule — *"every externally-triggerable write carries a NOT NULL
UNIQUE idempotency key; a retry collides and is a no-op"* — becomes unenforceable. A retried server function
emits the same event twice, the sweeper alerts twice, and two agents call the same buyer.

**Applied fix.** One survivor per table, cross-referenced everywhere else:
- **Consent:** the three-state version (`granted` / `withdrawn` / `refused`) survives — it is the one that can
  actually prove consent. `purpose_key` stays plain TEXT in v1 with the FK deferred. `[LAWYER]`
- **Suppression:** §16.8's shape survives.
- **Outbox:** §9.3's version survives, including `idempotency_key TEXT NOT NULL` and `available_at`. The
  duplicate DDL was deleted.

### R9 — The sweeper index cannot see the rows it must recover
*Resolves blocker #18. Drift defect with an execution consequence.*

**Defect.** The work-item due index was `WHERE status = 'pending'`, declared "the only index the sweeper needs" —
while the table's own CHECK allows `processing` and `failed`, and it carries `retryable`, `claim_token` and
`heartbeat_at`.

**Failure.** The Worker is redeployed after a compare-and-set has flipped an SLA escalation item to `processing`.
Its heartbeat goes stale. Every subsequent tick queries `status = 'pending'`, never sees it, and the escalation
for that unacknowledged lead **never fires, permanently and silently** — contradicting the package's own claim
that "a stale claim is recoverable, never orphaned".

**Applied fix.** Mirror Studio exactly:
`WHERE status='pending' OR (status='failed' AND retryable IS TRUE) OR (status='processing' AND heartbeat_at < now() - <stale_interval>)`,
with the interval stated and cited to Studio's `STALE_PROCESSING_SECONDS = 900`. `[Repository fact]`

### R10 — Stop promising a five-minute response with no way to deliver a message
*Resolves blocker #9. Design defect with a real operational cost.*

**Defect.** The Booth wireframe printed *"she'll call you within five minutes"* to a guest, and the queue
escalation footer promised an escalation chain — while the same document states that push notification is not
available in v1, and the first slice puts every outbound send out of scope. **In v1 there is no transport of any
kind:** no push, no SMS, no email, no WhatsApp. `[Repository fact]`

**Failure.** 14:03 at a booth. The host taps HAND OVER; the screen shows a progress indicator. The assigned
agent's phone is in her pocket with the browser closed. Nothing pings her. At 14:18 the escalation writes a
reserve-agent row that nobody sees either. The guest was told five minutes and leaves after eight. The routing
log records a perfect escalation chain that no human ever received.

**Applied fix.** The time promise was stripped from the Booth wireframe and the escalation footer and replaced
with *"the Host stays responsible until an agent acknowledges in the app."* An explicit line was added to the
wireframe notes: **in-app only; no notification is delivered in v1.** Transactional email to the assignee is
recorded as the cheapest first delivery channel and made a **stated prerequisite** of any screen that promises a
response time.

### R11 — `leads.source` gets no CHECK constraint; the task that adds one is deleted
*Resolves blockers #11, #20. Document defect — two documents giving opposite instructions.*

**Defect.** The architecture forbids it in bold — *"a silent lead loss at the front door"* — and the
implementation plan scheduled it as a Phase-0 task and made it a hard dependency of the identity spine.

**Failure.** The CHECK lands. `leads.source` is written from the browser under the anon INSERT policy, from a
string the client supplies. Anyone adding a new entry point — a campaign landing page, a new CTA, or a Booth v2
source value if two migrations land in the wrong order — sends a value the CHECK has not seen. PostgreSQL rejects
the INSERT; the visitor sees a generic error; **nothing is recorded anywhere**, on a path that has never once been
observed to deliver.

**Applied fix.** The task was **deleted**, along with the `leads.source` CHECK row in the forward/reverse table
and its entry in the identity-spine dependencies. The preceding task was retargeted to seeding
`crm_intake_channel` / `crm_intake_channel_alias`, whose unmapped case resolves to `unmapped` rather than
rejecting the insert. The metrics section's stray "CHECK or reference table" note was corrected to read
*"a reference table — never a CHECK on `leads.source`"*.

### R12 — Slice 1 has one definition, and it is genuinely minimal
*Resolves blockers #2, #10, #16. **Architect's ruling.***

**Defect.** The architecture and the implementation plan disagreed about what the first slice contains. The
architecture's Scope IN required ownership/assignment, a routing-log row per decision, `first_response_at` "on
the work record" and the Owner's median — while its own Scope OUT excluded the opportunity entity those columns
live on, and the plan said in plain text: *"No routing. No SLA automation. No deal entity."*

**Failure.** Two engineers reading the two authoritative documents build different first slices. The one who
follows the architecture builds an assignment and routing layer that the plan's own kill criterion says should
not exist yet. The one who follows the plan cannot satisfy the architecture's acceptance criteria, because no
table in the slice has the columns they name. Alternatively the implementer takes the union, and a phase sized as
"one screen faster than the spreadsheet" becomes the Phase 3 build.

**Applied ruling — binding.**

**Slice 1 Scope IN:** `crm_contact`, `crm_contact_method`, `crm_consent_record`, `crm_activity`,
`crm_work_item` — with `owner_user_id`, `assigned_user_id`, `next_action_at`, `next_action_note` and
`first_response_at` **on the work item, not on an opportunity**; `leads.contact_id`; the server-boundary read
path; one mobile "My Work Today" screen; one enquiry detail screen; and the Owner's two numbers (median first
response time, count of unworked enquiries).

**Slice 1 Scope OUT:** `crm_opportunity` and the entire stage machine; routing rules and `crm_routing_log`;
`crm_assignment` offers and fallback; `crm_policy`; viewings; sequences; any outbound send.

Consequences applied: `first_response_at` capture moved into Phase 1 — it is one timestamp column and it is the
only thing that makes the slice measurable at all. Logging an outcome against a contact with no work item
**creates one**, so a promise made on the phone always has somewhere to live. The queue screen was renamed so it
does not imply deals exist.

### R13 — Lead the recommendation with the honest answer, not with the architecture
*Resolves blocker #19 and the overengineering reviewer's headline. **Architect's ruling.***

**Defect.** The implementation plan already reaches the right conclusion — *"do Phase 0 only, and stop"* — and
then buries it at line 455 of a document the Owner is unlikely to open, while the 5,000-line architecture
document he **will** open presented Slice 0 → Slice 1 as the recommendation, with a kill condition that gates
only on Slice 0. The strings identifying the gate appeared **zero** times in the architecture. `[Repository fact]`

**Failure.** The Owner reads the flagship document, reaches the recommendation section, sees a first slice with a
green-looking kill condition, and authorizes four new tables, a `leads` ALTER and two screens — having never been
shown the architect's actual recommendation not to start it, nor the four thresholds that would justify starting.

**Applied fix.** The recommendation section now **opens with the gate, stated first and verbatim:** *Slice 1 does
not start until OD-8 is answered and the R-13 thresholds are evaluated; the architect's recommendation is Slice 0
only, then re-decide.* The threshold table is reproduced there, and the work-in-progress conflict is
cross-referenced. The reviewers were right that the previous ordering was the most misleading thing in the
package.

### R14 — Put a cost on both sides of the build-versus-buy decision
*Resolves the commercial reviewer's headline.*

**Defect.** The programme is anchored on a build-versus-buy decision made with **no money on either side**. The
architecture recorded the CRM build's ROI as "n/a" while rejecting the external CRM. That is not a decision; it
is a preference with a citation.

**Failure.** The Owner authorizes a large backlog against an alternative whose price he has never been shown.
Worse, the plan's own reopen trigger — *"a needed capability costs more than six reviewable PRs and a vendor ships
it as a documented feature"* — depends on a licence figure the research never fetched, so the reopen condition is
unevaluable for exactly the same reason the original decision was.

**Applied fix.** An explicit order-of-magnitude comparison is now stated: external CRM seat cost per user per
month at 3–5 users, against the engineering effort of Slice 0 + Slice 1 expressed in relative complexity. And the
honest conclusion is stated plainly rather than implied: **at this volume the money difference is small either
way, so the decision turns on data ownership and One Engine, not on cost.** The measurable reopen trigger is
kept.

### 3.1 Summary of R1–R14

| R | Class | One-line resolution |
|---|---|---|
| R1 | Document | One canonical entity register; every section cites it |
| R2 | Document | Five missing tables given illustrative DDL |
| R3 | Drift → **operational** | `nurture` + `spam` + `next_review_at`; INV-O1 amended |
| R4 | **Engineering — security** | `service_role` added to every append-only REVOKE |
| R5 | **Engineering — security** | Column-scoped INSERT grant on `leads`; block reclassified |
| R6 | **Engineering — guarantee** | Ownership FK repointed; write-once name snapshot |
| R7 | Drift | Merge repointing made legal and audited |
| R8 | Document | One `CREATE TABLE` per table; idempotency key preserved |
| R9 | Drift → execution | Sweeper predicate mirrors Studio's recovery cases |
| R10 | Design | The five-minute promise removed; no transport exists in v1 |
| R11 | Document | The `leads.source` CHECK task deleted |
| R12 | **Ruling** | One Slice 1 definition; work item, not opportunity |
| R13 | **Ruling** | The gate leads the recommendation |
| R14 | Commercial | Cost stated on both sides; the decision does not turn on it |

---

## 4. Findings not adopted, with reasons

`[Recommendation]` A reconciliation that adopted 100% of 166 findings would mean the architect exercised no
judgement — it would mean the reviewers, not the architect, designed the system. Several findings were correct as
observations and wrong as prescriptions; several proposed fixes would have expanded v1; two pairs of reviewers
proposed opposite fixes for the same defect. The declined items are recorded here with reasons, so a future
reader can overturn them on evidence rather than rediscover them.

| # | Finding / proposed fix | Reviewer | Declined because |
|---|---|---|---|
| N1 | **Ship `crm_pipeline` + `crm_pipeline_stage` tables and make `stage` an FK**, so a second pipeline is configuration rather than migration | Database; Owner oversight | Two reviewers proposed opposite fixes for the same contradiction; the overengineering prosecutor's branch was taken. Two configuration tables and a three-table join, holding permanently one pipeline row and seven stage rows, for a business with one process — to avoid a future `ALTER TABLE` that the do-not-build list says will not be needed. The correction belongs in the ADR's wording, not in the schema |
| N2 | **Weaken the contact-method UNIQUE index to a partial index on the primary method**, so two people can share a phone | Database; simplicity | The observation is right and is carried into §5 as a residual risk. The prescription would disable the dedup engine that eleven reviewers independently confirmed as correct, and would replace a database constraint with an application rule — the exact substitution D-brief §4 forbids. The resolution is a review-candidate rule at the resolver, not a weaker constraint |
| N3 | **Add a `contracted` stage between `reserved` and `closed_won`**, plus a `contract_rescinded` transition | Brokerage | Correct for Thai off-plan, and recorded as SHAPED. Declined for v1 because R12 removes the opportunity entity from the first slice entirely: adding a stage to a machine that has never had a single row pass through it is exactly the pattern the review condemned elsewhere |
| N4 | **Promote `crm_client_registration` into v1** and create the row at first introduction rather than at reservation | Brokerage | The timing argument is persuasive, but the same reviewer's own evidence finding showed the cited source does not support the claim and retagged it `[Inference]`. Building the highest-value record in a brokerage on a retracted citation is worse than deferring it. It stays SHAPED, and the transition precondition that depended on it was deleted rather than left as a promise |
| N5 | **Make one outbound delivery channel a hard prerequisite of Slice 1** (transactional email to the assignee) | Mobile usability, option (a); overengineering | R10 took option (b) instead: remove the promise. Option (a) adds a provider, a secret and a send path to a slice that has no deployed environment to hold a secret. The channel is recorded as the cheapest first delivery mechanism and as a stated prerequisite of any screen that promises a response time — which is the honest form of the same fix |
| N6 | **Add a Phase-1 task enrolling staff accounts in MFA and asserting `aal2` on the CRM route** | Security | Correct as a control, declined as a scope item. MFA enrolment is an account-administration action, not architecture, and this task authorizes documentation only. It is recorded instead as a **gate on the CRM route**: if MFA is not in place, the route stays disabled. That is a stronger statement than a backlog row |
| N7 | **Publish per-seat list prices for five named vendors as `[Web research]`** | Commercial | R14 adopted the substance and declined the form. A price table in a static document is stale the week after it is written, and would be read as the reason for the decision. The order-of-magnitude comparison plus the explicit statement that cost does not decide it is more honest and does not expire |
| N8 | **Score Phases 0–4 against the North Star's five-criterion gate in a table** | Commercial | The gate is real and the omission was a fair hit. Declined because R13 makes the recommendation *Slice 0 only, then re-decide* — scoring Phase 3 and Phase 4 would present them as planned work awaiting a score, which is the opposite of the recommendation. The gate is applied to Slice 0 and Slice 1 only |
| N9 | **Add an Owner decision offering a one-minute cron** as an alternative to the `*/5` tick | Owner oversight | Declined because a second reviewer falsified the option's cost in the same round: the scheduled hook takes no arguments and does not inspect which cron expression fired, so a second entry would also run the **Studio** tick every minute — a change to a shipped subsystem made by editing a config file. `[Repository fact]` The correction belongs in the cost cell, not in a new Owner decision built on a wrong number |
| N10 | **Store a Latin transliteration of every contact name** for search; **group multi-property viewings under a trip id**; **add per-member working hours and an away flag** | Mobile usability; brokerage | All three are real problems that will appear. All three are v1 scope expansion for capabilities that Slice 1 does not contain (there is no viewing entity, no routing, and one screen). Recorded as SHAPED with named triggers rather than built now |
| N11 | **Add a `crm_lost_reason` lookup table with an FK from the opportunity** | Database | Right in principle; declined for v1 for the same reason as N3 — Slice 1 has no opportunity. Recorded against the opportunity's promotion |
| N12 | **Reduce the webhook security contract and remove the inbound landing table** | Overengineering | Partially adopted: the contract is reduced to the binding standard *if* the WhatsApp trigger fires. Declined the deletion — a three-line rule that already exists costs nothing to keep, and re-deriving HMAC-over-raw-bytes under time pressure is how signature verification gets done wrong |

`[Inference]` Two of these declines could reasonably be overturned by the Owner: **N5** (an alert channel) and
**N6** (MFA). Both are cheap, both close real gaps, and both are declined on scope discipline rather than on
evidence. If the Owner wants either, the right way in is an explicit decision, not a quiet expansion of Slice 1.

---

## 5. Residual risks and known imperfections

`[Recommendation]` The following are **not resolved**. Each is stated with what would resolve it.

| # | Residual issue | Why it is still open | What would resolve it |
|---|---|---|---|
| K1 | **The package is very large for a three-person company.** Four documents, tens of thousands of lines, a schema surface far bigger than the slice it recommends | The reviewers hit this from three directions and they are right. R1's entity register and R13's gate make the size *navigable* and make the recommended scope *unmissable* — they do not make the package smaller | Deleting the catalogue sections once Slice 0 and Slice 1 are decided, and keeping only what the next phase needs. That is a decision to take **after** the Owner answers OD-8, not before |
| K2 | **Several KPIs depend on tables that do not exist until later phases.** R2 gave five of them DDL; the metric catalogue still specifies numbers whose numerator and denominator will both be zero for months | The catalogue was written against the end state, not against the first slice. Slice 1 ships exactly two numbers | Marking every metric with the phase that first makes it computable, and keeping the Owner's daily view to the two numbers Slice 1 produces. Anything else teaches the Owner to distrust the system on day one |
| K3 | **There is no CI to enforce any invariant.** No `.github` directory exists `[Repository fact]` | Every test named in this package — the bundle-boundary test, the grant assertions, the migration-contract test — runs only when a human runs it | A CI configuration is out of scope for this task and is a separate decision. Until then, **every gate in this package is a human-run gate and must be described as one.** No result in this package may be reported as "passing" |
| K4 | **Nothing in this package has been executed.** No migration applied, no database contacted, no deployment | By design — Factory autonomy is A0, Propose only | Nothing. This is the correct state. It is recorded here so no reader infers otherwise |
| K5 | **One phone number can belong to exactly one contact, forever.** Joint buyers in this market routinely share a mobile (see N2) | The dedup constraint is correct and confirmed; the shared-identifier case is genuinely unhandled | A resolver rule: a phone match with a materially different name creates a review candidate rather than resolving identity, and a consent record is **always** written against the contact the form named, never against a contact resolved purely by identifier. `[LAWYER]` |
| K6 | **Deployment is blocked (Cloudflare verdict E), and the task that resolves it is not first.** `[Repository fact]` | Slice 1 is buildable and testable locally and delivers no business value until a deployed environment exists | Resolving the host identity. The reviewer's proposal to move that task to the front of the backlog was not applied by this reconciliation and remains an open plan-level question for the Owner |
| K7 | **The 14 September 2026 PDPA date has two readings.** One source implies a 30-day commencement (≈15 August 2026), another 60 days (14 September 2026) | The Gazette text is the arbiter and this review did not obtain it | A Thai-qualified privacy lawyer confirming the commencement date. **Plan to the earlier date.** `[LAWYER][Unverified assumption]` |
| K8 | **First response time is self-reported.** The activity timestamp is written by the same person whose response time it measures, and no channel integration exists to corroborate it | D6 defers every channel integration, correctly | Stating in the metrics section that until a channel integration exists, the median is an internal service statistic and **not independent evidence** — and reporting alongside it the share of first responses whose *recording* time, not claimed time, fell inside the window |
| K9 | **A documentation inconsistency remains around the pipeline decision** (see N1): one ADR promises configuration where the DDL delivers a CHECK constraint | The schema branch was declined; the ADR wording correction is a text change, not a design change | Amending the ADR to state honestly that v1 hard-codes one stage list and a second process costs a migration — and that this is acceptable at three users |
| K10 | **No product analytics exist**, so four of the five stated anti-spreadsheet adoption checks cannot be evaluated `[Repository fact]` | The repository has no telemetry dependency of any kind | Keeping only the checks computable from `crm_activity` itself, and labelling the rest "not measured in v1" rather than presenting unbuildable checks as an acceptance protocol |

`[Inference]` K1 deserves one more sentence of honesty. The single strongest criticism in the whole review is
that a 5,000-line architecture document is itself the mechanism by which a parallel-schema defect survived
internal review. That criticism stands. The reconciliation makes the document correct; it does not make it
short.

---

## 6. Final recommendation

### 6.1 The recommendation, in one paragraph

**Build Slice 0 — prove that a lead actually arrives end to end, and make a failed submission visible to Forever
— and nothing else until that is done.** Then, and only then, decide whether to start Slice 1, gated on Owner
decision **OD-8** and on the four **R-13** thresholds. `[Recommendation]`

### 6.2 The two repository facts that decide it

**Fact one — nothing in the product can read a lead back.** `public.leads` has RLS enabled with a single INSERT
policy for `anon` and `authenticated` and **no SELECT policy** (`20260704132000_create_leads.sql:27-41`). A
repository-wide search for reads of that table returns exactly two occurrences: the insert itself
(`src/lib/lead-service.ts:92`) and the test that pins its source text
(`src/lib/lead-demo-mode-bundle-boundary.test.ts:22`). There is no route, no loader, no component, no admin
surface, no query, no alert. `[Repository fact]`

**Fact two — nobody has ever confirmed that a lead arrives.** PR #118's own Gate G0 records that the submission
path must be proven to deliver end to end, with a test lead created in a non-production context, before a single
new lead CTA is exposed to the public — and that this has never been done. `[Repository fact]`

`[Inference]` Read together, those two facts say something uncomfortable: Forever does not currently know whether
it is receiving enquiries. Every argument in this package about routing, ownership, SLA clocks, stage machines
and Owner dashboards is downstream of a pipe that has never been observed to deliver. **A pipeline UI on a pipe
that may not deliver is theatre.**

### 6.3 Slice 0, precisely scoped

| In | Out |
|---|---|
| Submit a test lead through the real form into a **non-production** Supabase context and observe the row | Any production write, migration application, deployment or publication |
| Record the observation: timestamp, environment, the confirming person, the submitted `source` value | Any new table, any schema change, any `crm_*` object |
| Make a failed submission visible **to Forever**, not only to the visitor | Retry logic, quarantine tables, alerting infrastructure |
| Record the observation in the Gate G0 record and as a dated `docs/DECISIONS.md`-format entry | Opening any new lead CTA to the public |

**A correction the review forced, and it matters.** The package originally stated that the only signal of a
failed submission is a browser `console.error`, and made "surface the error in the form" the single code
deliverable of Slice 0. That is wrong: the submitting visitor already sees an error. `ContactForm.tsx:62-68`
catches the thrown error and renders it in a destructive-styled block at `:184-188`; the Booth navigator catches
and shows a failure banner. `[Repository fact]` What does not exist is an **operator-visible** signal: when a
submission fails, nothing reaches Forever — no server-side capture, no quarantine, no count, no alert. Slice 0's
second deliverable is therefore the *operator* half, not the visitor half. Without this correction a team would
have re-implemented a shipped error surface, declared Slice 0 complete, and still had no idea when intake was
failing.

**Two constraints that shape the work.** `[Repository fact]` The browser insert must never gain `.select()` or
`.returns()` while there is no SELECT policy — it would fail at runtime, and the client can therefore never learn
the id of the lead it created; confirmation is an out-of-band observation of the row, not an API response. And
the lead service short-circuits the write in DEV when either demo flag is set (`src/lib/lead-service.ts:83-90`),
a behaviour pinned by an existing test — so any Slice 0 run must confirm both flags are off, or it will "succeed"
without writing anything at all.

**Cost and reversibility.** Slice 0 adds no schema and no server code. The only code change is the operator
failure signal. It is revertible in one commit.

### 6.4 Why this ordering beats every alternative that was proposed

| Alternative | Why it loses |
|---|---|
| **Build the schema first** | Four tables, a `leads` ALTER and a migration that will sit unapplied behind a backlog of pending migrations, all shaped around an intake path nobody has confirmed works. If intake is broken, every table is empty and the emptiness is indistinguishable from no demand — which is the one thing the Owner most needs to be able to tell apart |
| **Start with WhatsApp** | Self-onboarding the agents' working number to the Cloud API **deletes the account, loses all history, and permanently locks the number out of the app**, and from 1 Oct 2026 the message economics invert with rates unpublished until 1 Sep 2026. `[Web research]` It is the most expensive irreversible action available and it does not answer whether leads arrive |
| **Start with automation** | Every automation in the catalogue fires on a `*/5` cron into a runtime with **no notification transport of any kind**. An alert nobody receives is indistinguishable from no alert, and the diagnosis afterwards will be recorded as adoption failure rather than as a missing channel |
| **Start with the Owner dashboard** | Three of its five numbers depend on tables that did not exist until R2, and all of them render zeros until a full deal cycle completes. It teaches the Owner to distrust the system on day one — and it is the fastest way to conclude "the CRM does not work" when what does not work is intake |
| **Buy an external CRM instead** | Triple-blocked by Forever's own governance, and the stated reopen trigger is lead volume — which is not measured anywhere. Slice 0 is also the cheapest way to make that trigger evaluable. Per R14, the money difference at 3–5 users is small either way; the decision turns on data ownership and One Engine |

`[Inference]` Every alternative shares one property: it produces artefacts before it produces knowledge. Slice 0
produces knowledge, costs hours, and cannot be wasted — the answer it returns is needed whichever direction the
Owner then takes.

### 6.5 Measurable outcome

Slice 0 is complete when **all four** of the following are true:

1. A **named person** has seen a **specific row** in a **named non-production environment** at a **recorded
   time**, with the submitted `source` value noted — and both demo flags confirmed off for that run.
2. A deliberately broken submission produces a record **Forever can see**, not only an error the visitor sees.
3. The observation is written into the Gate G0 record and as a dated decision-log entry, which **discharges PR
   #118's Gate G0** — a dependency Slice 0 clears for someone else's work as a side effect.
4. The monthly enquiry count exists and has produced **at least one real number**, so the external-CRM trigger
   and the R-13 thresholds stop being unevaluable.

Nothing in that list requires a migration, a deployed environment, or an Owner spend decision.

### 6.6 Kill triggers

- **If Slice 0 cannot demonstrate that a lead arrives, Slice 1 does not start.** The correct next work is
  repairing intake delivery — not CRM construction. Building a read path over a pipe that does not deliver
  produces an empty screen and a false sense of completion.
- **If the measured enquiry count is zero or near-zero for three consecutive months, Slice 1 does not start.**
  The correct action is demand generation and catalogue work. `[Recommendation]`
- **If Slice 1 does start and fewer than 50% of enquiries carry a logged first response after one full month,
  stop and diagnose before building anything further** — and diagnose honestly, remembering that in v1 there is
  no notification channel, so low coverage may be an absent alert rather than an unwilling team.

### 6.7 The gate on Slice 1, stated in full

**Slice 1 does not start until OD-8 is answered and the R-13 thresholds have been evaluated. The architect's
recommendation is Slice 0 only, then re-decide.** `[Recommendation]`

| Evidence | Threshold | Where it comes from |
|---|---|---|
| Real inbound volume | ≥ 15 genuine enquiries in a single calendar month | The Phase 0 monthly count |
| Enquiries actually being lost | ≥ 3 enquiries in a month with no logged response within 48h | The Phase 0 count plus a manual audit of the existing WhatsApp inbox |
| A concrete allocation dispute | ≥ 1 argument about who owned a lead that could not be settled from records | Owner report |
| Catalogue readiness | 5–8 project records usable in advisory | The roadmap's own Phase 1 exit criterion, which it sequences **before** advisor conversion |

If those four are not met, the honest recommendation is: **do Slice 0 only, and stop.** `[Recommendation]`

Two further constraints the Owner must see before authorizing Slice 1. `[Repository fact]` First, the
work-in-progress limit: Forever should normally hold one guest/product/commercial task at a time, and that slot
is currently held by the Studio production launch — which names CRM automation among its own non-goals. Slice 1
consumes that slot. Second, deployment is at verdict E, so Slice 1 is buildable and testable locally but
**delivers zero business value until a deployed environment exists.** Neither fact is a reason to abandon the
design. Both are reasons not to start it this week.

### 6.8 If the Owner authorizes only one thing

Authorize Slice 0. It costs hours, it adds no schema, it is revertible in one commit, it discharges a gate
another PR is already waiting on, and it converts the single most important open question in this entire package
— *does a lead actually reach us?* — from a belief into a record. `[Recommendation]`

---

## 7. Provenance of this review record

| Item | Value |
|---|---|
| Reviewers | 11, independent, one per required perspective |
| Arbiter given to each reviewer | The repository at `main` SHA `821b3c4e2f6f82e0d4ddce86199a8ff24b44a094` |
| Findings returned | 166 — 20 blocker, 61 major, 60 moderate, 25 minor |
| Verdicts | 11 × `sound_but_needs_material_changes`; 0 × `significant_rework_required`; 0 × `fundamentally_flawed` |
| Binding decisions overturned | **0 of 10** |
| Resolutions applied | 14 (R1–R14), of which 2 are architect's rulings on scope and framing |
| Findings explicitly declined | 12 classes, recorded in §4 with reasons |
| Database connections made | **None** |
| Migrations applied | **None** |
| Commands claimed to have passed | **None — this repository has no CI** |
| Factory autonomy | **A0 — Propose only** |
