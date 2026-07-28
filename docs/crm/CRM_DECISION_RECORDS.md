# Forever CRM — Proposed Decision Records, Owner Decision Register and Do Not Build Yet

Task ID: FOREVER-CRM-ARCH-001
Status: Proposed architecture — not approved, not scheduled, not authorized for implementation
Repository state of record: main @ `82e2039270168df1043050204988fbd6c009ed0e`
Risk class: R0 (documentation only)

> This document is a design record. It asserts no product truth, changes no active stage, and authorizes no
> implementation. The active stage remains FOREVER-STUDIO-001 (`docs/CURRENT_STAGE.md`), which lists
> "large CRM integration" as out of scope. Any implementing task is R2 under the shared-contract rule and
> requires an Architect-reviewed stage change plus Owner approval.

## What this document decides

- Ten proposed durable decisions (CRM-D1 to CRM-D10), written in `docs/DECISIONS.md`'s exact format so an
  approved one can be promoted verbatim.
- One **Owner-approved operating policy** already in force (CRM-D11, the 21-day lead holding period), which
  the architecture implements rather than proposes.
- Seven questions that only the Owner can answer, with what each one blocks.
- Twenty things that must not be built yet, each with the trigger that would reopen it.

## Why these are not in `docs/DECISIONS.md`

[Repository fact] `docs/DECISIONS.md` is defined at its head as a log of **approved** durable decisions, and
its 22 existing entries each record a decision the Owner or Architect actually made. Nothing in this package
has been approved. Writing these into that file would misrepresent their status and would make the canonical
decision log unreliable — which is the one thing it must not be.

They are therefore held here, in the canonical format, marked Proposed. On approval, an entry is moved into
`docs/DECISIONS.md` unchanged apart from its status line. [Repository fact] There is no `ADR-N` numbering
scheme anywhere in `docs/` (zero occurrences), so none is introduced; the local `CRM-D<n>` labels below are
cross-reference handles within this package only, and are dropped on promotion.

---

## Part 1 — Proposed decision records

### CRM-D1 — 2026-07-28 — The CRM is an interface over the existing engine, not a second system

- **Status:** Proposed — pending Architect Review and Owner approval.
- **Decision:** The Forever CRM is implemented as internal server-boundary tooling over the existing Supabase
  database, owning only the seven fact classes permitted by `docs/FOREVER_BRAIN_V1.md` §7. It stores no
  project, developer, location, unit-inventory, price-history, Passport or Intelligence fact, and creates no
  second Decision Engine, project database, client-profile system, report engine or SunThai truth system.
- **Context:** `docs/FOREVER_STRATEGIC_NORTH_STAR.md:103` already charters "CRM-lite and communication
  workflows" as an interface of the one engine, and `:106` forbids any interface developing separate project
  truth, matching logic or guest profiles. Forever already owns the structured buyer-intent engine and the
  project database; an external or parallel CRM would duplicate both.
- **Consequence:** Every CRM table references project and unit entities by key only. A grep-testable rule
  applies: no `crm_*` column may hold a project, unit, developer, location, price or availability fact.
  Project writes from CRM code do not exist as a path.
- **Review trigger:** Any proposal to cache a project or price value on a CRM row; any proposal to purchase an
  external CRM as system of record.

### CRM-D2 — 2026-07-28 — Structured buyer intent is persisted structurally, never as prose

- **Status:** Proposed.
- **Decision:** The NAV-001 answer set is persisted as structured, versioned rows. The current behaviour —
  serialising the derived `DecisionProfile` into `leads.message` free text — is deprecated rather than
  extended.
- **Context:** [Repository fact] `buildBoothMessageSummary` in `src/features/navigator/core/lead.ts` renders
  the entire profile to prose, and `submitLead` in `src/lib/lead-service.ts:92` writes it into a table with no
  `SELECT` policy. The 28 approved enum keys in `src/features/navigator/core/questions.ts` are therefore
  unqueryable the moment they are captured, which defeats segmentation, reactivation and every conversion
  metric that depends on intent.
- **Consequence:** Profile persistence carries an explicit schema version, so a future sixth NAV question does
  not silently invalidate historic profiles. The prose summary may remain as a human-readable convenience, but
  it stops being the record. This is Phase 2 work, not first-slice work, because it requires `/booth` to be
  access-controlled first.
- **Review trigger:** Any change to the NAV-001 question set; before Phase 2 begins.

### CRM-D3 — 2026-07-28 — Authorization stays at the app-server boundary; no user-scoped RLS is introduced

- **Status:** Proposed.
- **Decision:** CRM authorization follows the established Forever idiom exactly: every CRM table uses
  `ENABLE ROW LEVEL SECURITY` with zero policies plus an explicit `REVOKE ALL … FROM PUBLIC, anon,
  authenticated` and `GRANT … TO service_role`; per-user authorization is TypeScript in server functions
  behind the existing middleware chain. No `auth.uid()` or `auth.jwt()` policy, no `FORCE ROW LEVEL SECURITY`,
  no column-level `GRANT UPDATE`, no second service-role key path.
- **Context:** [Repository fact] There is not one occurrence of `auth.uid()`, `auth.jwt()`, `auth.role()` or
  `request.jwt` across all 25 migrations; `auth.` appears only seven times as `auth.users` foreign-key targets.
  Introducing user-scoped RLS would create a second, parallel authorization model. Separately, column-level
  `GRANT UPDATE` has zero precedent, and the independent review found it was the mechanism by which the first
  draft's merge operation could not execute at all.
- **Consequence:** RLS defends the CRM against PostgREST, not against an application bug — this is stated
  plainly rather than implied. The compensating controls are: a declarative endpoint-to-capability map the
  middleware reads and a test asserts is total; a contract test that discovers `crm_*` tables by regex rather
  than counting; the existing bundle-boundary test extended with every new client-reachable file; and
  per-invocation read logging that records actor, endpoint, filter shape and row count, never contents.
- **Review trigger:** Any proposal to expose a CRM table through PostgREST; any proposal to grant an
  authenticated role direct table access.

### CRM-D4 — 2026-07-28 — Merge is reversible; destructive merge is prohibited

- **Status:** Proposed.
- **Decision:** Duplicate people are resolved by setting `merged_into_person_id` and appending a merge record
  capturing field-level survivorship, so unmerge is a replay. No row is deleted. Automatic probabilistic
  merging is prohibited; fuzzy matching may only produce suggestions for human confirmation.
- **Context:** [Web research] Two of the largest CRM vendors shipped destructive merge and are now stuck with
  it; HubSpot documents plainly that "It's not possible to unmerge records"
  (https://knowledge.hubspot.com/records/merge-records). A wrong merge in Forever's context means one buyer
  seeing another buyer's budget and a commission dispute between advisors.
- **Consequence:** Every read path that resolves a person must follow `merged_into_person_id`. This is
  load-bearing for the marketing-consent gate in particular: the independent review found that a gate which
  does not follow the merge pointer silently restores marketing eligibility when a suppressed duplicate is
  merged — on the one duty PDPA treats as absolute.
- **Review trigger:** The first production merge; any proposal to auto-merge on a similarity threshold.

### CRM-D5 — 2026-07-28 — Consent is an append-only event log, and marketing suppression is a separate table

- **Status:** Proposed.
- **Decision:** Consent is recorded as append-only events referencing versioned notice wording, with an
  insert-only correction path for voiding a mistaken record. Marketing objection is recorded in a table
  structurally separate from the contact record, and every send path consults it.
- **Context:** [Web research, descriptive only — not legal advice] PDPA s.19 places the burden of proving
  consent on the controller, which a mutable boolean cannot discharge. The s.32(2) direct-marketing objection
  is absolute with no rebuttal and requires the data to be immediately clearly distinguished, which is why
  suppression cannot be a column on the person row.
- **Consequence:** Consent cannot be edited or deleted, only appended to. Erasure becomes partial rather than
  global, because a minimum identifier may need to survive in order to honour a suppression — an interaction
  that requires Thai counsel to confirm (Owner decision 3b). Qualified Thai counsel must confirm the whole of
  this record before real personal data is processed at scale.
- **Review trigger:** Counsel opinion; any new communication channel; before any outbound send capability
  ships.

### CRM-D6 — 2026-07-28 — Response-time commitments are automated acknowledgement plus a business-hours human target

- **Status:** Proposed.
- **Decision:** Forever commits to immediate automated acknowledgement and a human first-response target
  measured in **business hours** in Asia/Bangkok, with an explicit overnight policy. The proposed
  five-minute wall-clock human-contact target is not adopted.
- **Context:** [Web research] The five-minute rule traces to a single vendor study whose own author states the
  pattern appears "only when data from several companies is combined together"
  (https://www.onecavo.com/wp-content/uploads/2015/11/MIT-InsideSales.com_Lead-Response-Management.pdf). The
  defensible published threshold is one hour, from an audit of 2,241 companies whose more useful finding is
  that 23% never responded at all
  (https://thedenmangroupselling.wordpress.com/wp-content/uploads/2011/03/the-short-life-of-online-sales-leads-harvard-business-review.pdf).
  The best independent evidence — warm transfer versus callback, 25% against 12.9%, n=2,341
  (https://pmc.ncbi.nlm.nih.gov/articles/PMC10395154/) — locates the value in not breaking the session rather
  than in shaving minutes off a callback. [Repository fact] The only scheduled execution seam runs every five
  minutes, which is itself a hard floor on any sub-five-minute promise. [Inference] Moscow-evening browsing
  arrives 23:00–03:00 Phuket time, so a global wall-clock target would be recorded as failed nightly.
- **Consequence:** Policy values are configurable TypeScript constants with review triggers, not hard-coded
  literals and not a database policy engine. SLA breaches are reported as raw counts, never as a percentage.
- **Review trigger:** Owner decision 4 (actual operating hours); sustained enquiry volume above 200 per month.

### CRM-D7 — 2026-07-28 — No numeric score, rank or conversion rate is persisted or rendered

- **Status:** Proposed.
- **Decision:** No CRM surface persists or renders a match score, confidence, probability, rank or
  stage-conversion percentage. Ratios are shown only when the denominator reaches 30, and are accompanied by
  the denominator. Per-agent conversion comparison is prohibited at any volume in v1.
- **Context:** [Repository fact] `docs/CURRENT_STAGE.md:221-222` places a new Decision Engine and new scoring
  systems out of scope, and no approved evidence-backed calculation rule exists in the repository.
  [Web research] Using the NIST-recommended Wilson interval, 3 of 20 is 15% with a 95% confidence interval of
  5.2%–36.1%; 2 of 20 and 3 of 20 are indistinguishable; detecting a real 10%→15% improvement needs roughly
  1,400 leads (https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
- **Consequence:** The Owner sees counts, ageing, coverage gaps and absolute currency instead. A greppable
  column-name test keeps score-shaped columns unstorable. The per-agent ban lifts only when both conditions
  hold — at least 30 matured opportunities per agent **and** an assignment mechanism making lead mix
  comparable.
- **Review trigger:** Both per-agent conditions met; or an approved evidence-backed scoring rule entering
  `docs/DATA_STANDARD.md`.

### CRM-D8 — 2026-07-28 — Build the operational core; buy only a messaging gateway; never sync bidirectionally

- **Status:** Proposed.
- **Decision:** Forever builds the CRM core in its existing Supabase database. No external CRM becomes the
  system of record. If a messaging gateway is later purchased, it writes one-way into Supabase, and
  bidirectional synchronisation is prohibited permanently.
- **Context:** [Repository fact] `docs/ROADMAP.md:144` already directs using the existing Supabase lead
  boundary and Advisory foundations before buying or building a large CRM, and `:228` defers an external CRM
  behind a volume trigger. [Web research] Cost is not the deciding variable — the market spans roughly
  $3k–$21k per year at ten seats, immaterial against a single Phuket commission. The deciding variable is
  the write path: Forever already owns the project database and the buyer-intent engine, so an external system
  of record would either duplicate them or require two-way sync. The open-source middle path is blocked:
  Twenty CRM is AGPLv3 with additional commercially-licensed files, and AGPL §13 network copyleft targets
  precisely the embed-in-a-network-served-product case (https://raw.githubusercontent.com/twentyhq/twenty/main/LICENSE)
  — not legal advice; counsel opinion required before importing any AGPL code.
- **Consequence:** The gateway purchase is gated on Owner decision 1 (WhatsApp number ownership), not on a
  date, because direct Cloud API onboarding of an existing WhatsApp Business App number deletes the account
  and its history (https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/migrate-existing-whatsapp-number-to-a-business-account/),
  and because Kommo's six-month minimum makes a premature purchase irreversible within a quarter.
- **Review trigger:** Sustained enquiry volume above 500 per month for three consecutive months; or the
  WhatsApp ownership answer.

### CRM-D9 — 2026-07-28 — No phase proposes more schema than one reviewer can verify

- **Status:** Proposed.
- **Decision:** The target architecture may be large; the buildable set may not. No phase proposes more schema
  than a single reviewer can hold in mind while checking every foreign key, every CHECK constraint and every
  trigger interaction. Phase 1 is capped at eleven tables in three foreign-key-ordered migrations.
- **Context:** The first draft of this architecture proposed 33 buildable tables against a 52-table target.
  Independent review found that its migration chain would not apply (a foreign key referenced a table created
  three files later), its merge operation could not execute, and its marketing gate failed open — and that
  fifteen defects of that class survived eight independent reviews. The defect was not the table count; it was
  presenting an unverifiable quantity of schema as a plan.
- **Consequence:** Phase 1 ships without a pipeline, without opportunities and without decision-profile
  persistence. A pilot that cannot record a deal is still a pilot that answers buyers correctly and lawfully,
  and a pipeline is worth nothing over untrustworthy intake.
- **Review trigger:** Any phase proposal exceeding roughly a dozen tables.

### CRM-D10 — 2026-07-28 — The first slice creates no schema and answers the build-versus-buy trigger

- **Status:** Proposed.
- **Decision:** The first implementation slice creates zero CRM tables, zero migrations, and no change to how
  a lead is written. It consists of a read-only SQL script the Owner runs directly, followed by an
  Owner-only read view of existing leads plus the repair that stops `/contact?project=&unit=` discarding its
  own context.
- **Context:** [Repository fact] `docs/ROADMAP.md:228` defers an external CRM behind the trigger "lead volume
  exceeds the simple internal workflow", but `public.leads` has no `SELECT` policy and no code reads it, so
  that trigger cannot currently be evaluated. [Repository fact] `docs/CURRENT_STAGE.md:109` already carries
  "Establish lead-response and guest-feedback baseline" as an active task and `:212` places simple
  lead-response measurement in scope. [Provisional — open Draft PR #118] Gate G0 asserts the lead submission
  path has never been proven to deliver end-to-end.
- **Consequence:** The slice is R1, not R2, because it adds no shared contract. It is reversible by deleting
  two files and one route. It produces the number on which every later phase depends, and it proves or
  disproves gate G0 either way.
- **Review trigger:** Slice 0 results; the kill triggers in `docs/crm/CRM_IMPLEMENTATION_PLAN.md`.

---

### CRM-D11 — 2026-07-28 — The 21-day lead holding period is the Owner-approved default

- **Status:** **Owner-approved operating policy.** Unlike CRM-D1 to CRM-D10, this records a decision the Owner
  has already made. The architecture implements it; it does not propose it.
- **Decision:** An agent holds an assigned lead for **21 calendar days**. After 21 days **without successful
  progression**, the lead moves to **warm-up / reassignment** according to the operational policy. A
  reactivated lead returns to the **originating agent** where the operational policy requires it. Permanent
  attribution and ownership credit are modelled **separately** from current assignment.
- **Context:** [Owner requirement] This is existing Forever operating policy, not a design proposal. An
  earlier revision of this package presented an activity-driven variant as the default — the holding period
  reset by any agent-attributed outbound message, and expiry producing only a flag. That variant permits an
  indefinite claim maintained by sending one message every twentieth day, which converts a bounded holding
  period into a permanent one, and it substituted an engineering preference for a policy the Owner had set.
- **Consequence:** Three ownership concepts are kept structurally separate: `relationship_owner_user_id`
  (current assignment, the only column the sweep may move), `originating_owner_user_id` (permanent
  attribution, never written or nulled by any automated process), and `crm_opportunity_credit` (commercial
  credit, human-written only). Because the sweep touches only the first, the transition performs no
  commission-relevant write, which is what makes automating the Owner's rule safe. The sweep may **not**
  select the next assignee — that requires ordered routing rules with working hours and availability, which do
  not exist. `next_action_at` does not suppress this check; deferral requires an explicit, audited
  `ownership_extension` activity, so a holding period cannot be extended indefinitely by scheduling a
  reminder. The activity-driven variant is retained in `docs/crm/CRM_JOURNEYS_AND_STATE_MACHINES.md` §7.3.4 as
  a future alternative and must not be presented anywhere as Forever's default.
- **Review trigger:** The first ownership dispute; or a separate explicit Owner decision changing the holding
  period, the reset condition, or the expiry action. [Unverified assumption] 21 days is a policy number; no
  source in the research set supports 21 over 14 or 30, and it is never presented as a research finding.

## Part 2 — Owner Decision Register

Seven questions that evidence and professional judgement cannot resolve. Everything else in this package has
been decided rather than deferred to the Owner.

| # | Decision | What it blocks | Cost of deciding late |
| - | -------- | -------------- | --------------------- |
| 1 | **WhatsApp number ownership** | Any gateway purchase; any conversation-capture design | History may already be unrecoverable, and Cloud API onboarding of an existing Business App number destroys it |
| 2 | **Does Forever deliberately target the EU?** | Whether GDPR stacks on PDPA | Retrofitting an Art 27 representative and dual DSR clocks |
| 3 | **Three PDPA questions for Thai counsel** | Consent, erasure and suppression design | Suppression may be unenforceable; erasure may be impossible on time |
| 4 | **Actual operating hours and days (Asia/Bangkok)** | Every response-time metric | No SLA count can be published against an assumed window |
| 5 | **Must `public.leads` remain a complete journal?** | Low-friction booth capture | Converges with Draft PR #102's nullable-email decision |
| 6 | **Reallocate the WIP slot, or queue behind #103?** | Slice 1 start | Slice 0 runs either way |
| 7 | **Ratify the constitutional reconciliation** | The Phase 1 stage change | Blocks Phase 1 entirely; does not block Slice 0 or 1 |

### 1. Where do buyer WhatsApp conversations live today?

A company-owned WhatsApp Business App number, or individual advisors' personal accounts? This is the largest
commercial exposure in the whole area and no schema decision touches it. If conversations are on personal
accounts, Forever has no ownership claim over the relationship, no copy of the history, and no reassignment
path when an advisor leaves. It also gates the gateway purchase absolutely: [Web research] direct Cloud API
onboarding of an existing Business App number deletes the account and the history, and only a partner
supporting business-app onboarding preserves it
(https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/migrate-existing-whatsapp-number-to-a-business-account/),
while Kommo's six-month minimum with no monthly billing makes a premature purchase irreversible within a
quarter (https://www.kommo.com/buy/tariff/).

### 2. Does Forever deliberately target the EU?

EUR pricing, EU-language landing pages, EU-geotargeted advertising spend. [Web research] Per EDPB Guidelines
3/2018 the trigger is targeting, not buyer nationality
(https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-32018-territorial-scope-gdpr-article-3-version_en).
[Repository fact] The code carries no targeting signal — no EUR pricing, no `hreflang`, no third-party
marketing tags — but absence of evidence in the code is not evidence of absence in the business. A late "yes"
means retrofitting an Article 27 representative and dual data-subject-request clocks. Recommended form: a
three-sentence `docs/DECISIONS.md` entry with the review trigger "the first EU-geotargeted ad spend,
EU-language landing page, or EUR-denominated price".

### 3. Three PDPA answers, all requiring qualified Thai counsel

**Descriptive only, not legal advice.**

- **(a)** What purpose each historic `public.leads` form actually stated at collection, and whether the s.95
  withdrawal-method publication duty has been discharged. Suppression-by-default is only an interim answer.
- **(b)** Whether retaining a minimum identifier in order to honour an absolute s.32(2) marketing objection
  survives an s.33 erasure request. **This is the most consequential open legal item in the package**, because
  a "no" makes the objection unenforceable against any re-acquisition of the same person.
- **(c)** The Supabase point-in-time-recovery and backup retention window. If it exceeds 90 days, erasure
  cannot be completed on time by waiting, and no schema decision changes that.

### 4. Actual operating hours and days in Asia/Bangkok

No SLA count can be published against an assumed window, and this is the denominator for every response
metric. Equally uninferable and equally needed: the call-duration threshold that distinguishes a real
conversation from a voicemail (60 seconds proposed).

### 5. Must `public.leads` remain a complete journal of every capture?

If **yes**, a minimised tier-0 booth capture requires relaxing `leads.email NOT NULL` *and* re-issuing the
public INSERT policy by DROP-then-CREATE — a security-boundary change requiring its own R2 review, and one
that converges with Draft PR #102's nullable-email decision. If **no**, minimised captures write a CRM enquiry
only and `public.leads` becomes an explicitly incomplete mirror. This is a business-records question, not an
engineering one.

### 6. Reallocate the WIP slot, or queue?

[Repository fact] `docs/FOREVER_STRATEGIC_NORTH_STAR.md:266-271` permits one active guest/product/commercial
task, currently issue #103 (Studio production launch, P0, which explicitly instructs pausing non-blocking
product expansion). Slice 0 is evidence gathering and runs concurrently. Slice 1 queues behind #103 unless the
Owner deliberately reallocates. There is reciprocal value: Slice 0's synthetic-lead proof is the same class of
action as the controlled smoke test in issue #103, under the same gate.

### 7. Ratify the constitutional reconciliation before Phase 1

[Repository fact] `docs/FOREVER_PRODUCT_SPECIFICATION.md:17` states Forever "is not: … A CRM" while
`docs/FOREVER_BLUEPRINT.md` §13 charters one with seven capabilities and `docs/FOREVER_CORE_ARCHITECTURE.md`
places CRM in the core workflow chain. `docs/FOREVER_STRATEGIC_NORTH_STAR.md:14` requires conflicting
product-priority statements to be resolved before new work starts. The proposed resolution is in
`docs/crm/CRM_PRODUCT_BOUNDARY.md` §2. It is R3 and Owner-ratified, and it gates the Phase 1 stage change, not
this record.

---

## Part 3 — Do Not Build Yet

Twenty exclusions. Each carries the trigger that would reopen it. An item with no trigger is permanent.

### Schema and phasing

1. **Any `crm_*` table before the stage change.** Slice 0 and Slice 1 add zero.
   `docs/CURRENT_STAGE.md:224` lists "large CRM integration" as out of scope and `:228` excludes
   architecture-only foundations without a measured current-stage need. *Trigger: an Architect-reviewed
   transition recording the measured need.*
2. **The automation, policy and routing engine — all 15 tables.** The five coverage sweeps ship as five SQL
   functions and one page; the eleven policy numbers ship as TypeScript constants with review triggers in
   comments. *Trigger: sustained enquiry volume above 200 per month — the automation section's own threshold.*
3. **`crm_record_history`.** Cut permanently in favour of `public.audit_log` with `crm_*` action values and
   populated `old_values`/`new_values`. It was churn, and it was the holder of un-erasable JSONB copies of
   every buyer's name. *No trigger — permanent.*
4. **`crm_ropa_v1` and the blanket column census.** The ROPA is a markdown table with a review trigger until
   counsel confirms the duty applies and the table count is large enough to drift. *Trigger: counsel
   confirmation.*
5. **`crm_commission_claim`.** Modelled in the target, built later. A chase queue over zero reservations is a
   foundation without a measured need. *Trigger: the first reservation reaching SPA signature.*
6. **`crm_trip` and `crm_reservation_unit`.** Modelled, not built. *Triggers: the first buyer visit spanning
   more than one day; the first reservation covering more than one unit.*
7. **Deposit custody and refund columns.** *Trigger: ships with the reservation table itself, not before.*

### Communication

8. **Outbound messaging of any kind, and any purchased gateway.** [Repository fact] Nothing on main sends, and
   Workers has no SMTP. `docs/CURRENT_STAGE.md:212` says alert *design*. *Trigger: Owner decision 1, not a
   date.*
9. **Any inbound webhook endpoint.** No provider exists, and it would be the repository's first unauthenticated
   route on a Worker whose deployment is unverified. When it comes: per-provider files, no wildcard route,
   startup assertion on secrets. *Trigger: a provider being adopted.*
10. **Any second consumer of the `cloudflare:scheduled` hook**, until the deployed Worker's `scheduled()`
    export is confirmed live. Slice 1 is deliberately cron-free. When one is added it must yield to the Studio
    tick, carry a wall-clock deadline checked between every job, and render its own last-run time.
    *Trigger: verified production deployment.*
11. **The project-change unit watch.** Suppressed until a canonical unit-availability history exists; emitting
    it now produces unbounded "check it" tasks the design cannot make actionable. *Trigger: that table
    existing.*

### Security and authorization

12. **Any `auth.uid()` / `auth.jwt()` RLS policy, `FORCE ROW LEVEL SECURITY`, a second identity roster, or a
    second service-role key path.** Zero occurrences across all 25 migrations. This design creates no pressure
    toward any of them. *Trigger: each is a separately justified architectural decision with its own
    `docs/DECISIONS.md` entry — never a CRM implementation detail.*
13. **Column-level `GRANT UPDATE`.** Zero occurrences repo-wide, and the mechanism that broke merge in the
    first draft. Use whole-table narrowing plus guard triggers — the precedent the repository actually proves.
    *No trigger — permanent.*
14. **A partner or referral login.** The commercial function is delivered by modelling a referrer as a flagged
    person with referral credit. *Trigger: a partner sending more than roughly one referral a month and
    repeatedly asking about status.*

### Measurement

15. **Any numeric score, confidence, probability, rank or conversion rate — persisted or rendered.**
    *Trigger: an approved evidence-backed calculation rule entering `docs/DATA_STANDARD.md`.*
16. **Per-agent conversion comparison, in any surface, at any volume.** Wins per advisor as a *count* is
    permitted; the ratio is not. *Trigger: at least 30 matured opportunities per agent **and** a comparable
    lead mix — both, not either.*

### Scope

17. **Bidirectional sync with any external CRM.** *No trigger — permanent. If a gateway is bought it writes
    one-way into Supabase, which stays sole system of record.*
18. **Call recording and transcription.** No table, no column, no action kind. *Trigger: an explicit counsel
    opinion, nothing less.*
19. **Any AI-written field a deterministic path can read** — routing, SLA timers, stage transitions,
    commission. [Web research] HubSpot's documented failure mode is the rule to adopt verbatim: when credits
    run out "the action will fail and any outputs used will populate with an empty value"
    (https://knowledge.hubspot.com/workflows/use-breeze-to-research-and-summarize-data-in-workflows).
    *No trigger — permanent.*
20. **Editing `docs/CURRENT_STAGE.md` as part of a CRM change.** A CRM architecture record does not change the
    active stage; touching it would silently promote out-of-scope work. *No trigger — permanent.*
