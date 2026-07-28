# Forever CRM Architecture Index

Task ID: FOREVER-CRM-ARCH-001
Status: Proposed architecture — not approved, not scheduled, not authorized for implementation
Repository state of record: main @ `821b3c4e2f6f82e0d4ddce86199a8ff24b44a094`
Risk class: R0 (documentation only)

> This package is a design record. It asserts no product truth, changes no active stage, and authorizes no
> implementation. The active stage remains **FOREVER-STUDIO-001** (`docs/CURRENT_STAGE.md`), which lists
> "large CRM integration" as out of scope. Any implementing task is R2 under the shared-contract rule in
> `docs/FOREVER_FACTORY_CONSTITUTION.md` and requires an Architect-reviewed stage change plus Owner approval.

## The one-paragraph answer

Forever does not need a CRM product. It needs to stop destroying the structured buyer intent it already
collects. Navigator derives a complete `DecisionProfile` — 28 approved enum keys across five questions — and
Booth then serialises all of it into a prose `leads.message` field, in a table that has no `SELECT` policy and
that no code in the repository ever reads. The engine already exists; the operational layer is a write-only
mailbox. The CRM is therefore **one more interface over the existing engine**, not a second system. It owns
exactly the seven kinds of fact `docs/FOREVER_BRAIN_V1.md` §7 permits it to own, and stores no project,
developer, location, unit, price, Passport or Intelligence fact.

## What to build first

**Nothing with a schema.** The recommended first move is two reversible steps that together cost one props
change and two new files:

| Step | Content | Tables | Risk |
| ---- | ------- | ------ | ---- |
| **Slice 0** | A checked-in read-only SQL script the Owner runs in the Supabase SQL editor, returning lead counts by month, source, status and distinct email | 0 | none — not code |
| **Slice 1** | An Owner-only, phone-usable read view of the existing `public.leads`, plus the one-line repair that stops `/contact?project=&unit=` discarding its own context | 0 | R1 |

Slice 0 answers the trigger `docs/ROADMAP.md:228` already sets for the build-versus-buy decision
("lead volume exceeds the simple internal workflow") — a trigger that **cannot currently be evaluated**,
because `public.leads` has no `SELECT` policy and no code reads it. Slice 1 serves the task already active in
`docs/CURRENT_STAGE.md:109` ("Establish lead-response and guest-feedback baseline") and in scope at `:212`
("simple lead-response measurement and alert design where it provides immediate value").

Full reasoning, acceptance criteria and kill triggers: `docs/crm/CRM_IMPLEMENTATION_PLAN.md`.

## Reading order

Read in this order. Each document assumes the ones above it.

| # | Document | Purpose |
| - | -------- | ------- |
| 1 | [`CRM_EXECUTIVE_SUMMARY_RU.md`](CRM_EXECUTIVE_SUMMARY_RU.md) | Executive summary for the Owner (Russian) |
| 2 | [`CRM_CURRENT_STATE_AUDIT.md`](CRM_CURRENT_STATE_AUDIT.md) | What Forever actually has today, verified against main |
| 3 | [`CRM_PRODUCT_BOUNDARY.md`](CRM_PRODUCT_BOUNDARY.md) | What the CRM is, what it is not, roles and workspaces |
| 4 | [`CRM_MARKET_RESEARCH_2026.md`](CRM_MARKET_RESEARCH_2026.md) | Cited 2026 research, and the patterns deliberately rejected |
| 5 | [`CRM_DOMAIN_MODEL.md`](CRM_DOMAIN_MODEL.md) | Entities, ERD, identity, merge, invariants — the anchor document |
| 6 | [`CRM_JOURNEYS_AND_STATE_MACHINES.md`](CRM_JOURNEYS_AND_STATE_MACHINES.md) | Every lead source through to closed or nurture |
| 7 | [`CRM_UX_INFORMATION_ARCHITECTURE.md`](CRM_UX_INFORMATION_ARCHITECTURE.md) | Screens, wireframes, mobile navigation |
| 8 | [`CRM_SECURITY_AND_RBAC.md`](CRM_SECURITY_AND_RBAC.md) | Roles, capabilities, RLS posture, threat model |
| 9 | [`CRM_PRIVACY_CONSENT_RETENTION.md`](CRM_PRIVACY_CONSENT_RETENTION.md) | PDPA-led consent, suppression, erasure, retention |
| 10 | [`CRM_INTEGRATION_AND_EVENTS.md`](CRM_INTEGRATION_AND_EVENTS.md) | Capture path, scheduled seam, messaging, failure modes |
| 11 | [`CRM_AUTOMATION_CATALOGUE.md`](CRM_AUTOMATION_CATALOGUE.md) | Automation design, priority, and the engine deliberately not built |
| 12 | [`CRM_ANALYTICS_AND_KPI.md`](CRM_ANALYTICS_AND_KPI.md) | Owner metrics, and why most conversion rates are withheld |
| 13 | [`CRM_BUILD_VS_INTEGRATE.md`](CRM_BUILD_VS_INTEGRATE.md) | Build, buy or hybrid, with measurable flip triggers |
| 14 | [`CRM_IMPLEMENTATION_PLAN.md`](CRM_IMPLEMENTATION_PLAN.md) | Phases, backlog, migration strategy, risk register |
| 15 | [`CRM_DECISION_RECORDS.md`](CRM_DECISION_RECORDS.md) | Proposed decisions, Owner Decision Register, Do Not Build Yet |
| 16 | [`CRM_INDEPENDENT_REVIEW.md`](CRM_INDEPENDENT_REVIEW.md) | The adversarial review that corrected this package |
| 17 | [`CRM_FINAL_RECOMMENDATION.md`](CRM_FINAL_RECOMMENDATION.md) | **The single page to point at** — what to build first and why |

In a hurry, read documents 1 and 17 only. Together they are the Owner's decision set.

## Governing constraints

These are not this package's inventions. They are existing Forever rules the design is bound by.

- **One Engine, Many Interfaces** (`docs/FOREVER_BLUEPRINT.md:11`). `docs/FOREVER_STRATEGIC_NORTH_STAR.md:103`
  already lists "CRM-lite and communication workflows" as a chartered interface, and `:106` forbids any
  interface developing separate project truth, matching logic or guest profiles.
- **`docs/FOREVER_BRAIN_V1.md` §7 "CRM Interaction"** is the binding contract, cited rather than restated.
  The CRM may own leads, buyer profiles, advisor notes, follow-up state, buyer preferences, inquiry history
  and deal workflow state. It must not own project, developer, location, unit-inventory, price-history,
  Passport or Intelligence truth.
- **Forever's authorization idiom.** There is not one occurrence of `auth.uid()` or `auth.jwt()` in any of the
  24 migrations. Per-user authorization is TypeScript at the app-server boundary; internal tables use
  `ENABLE ROW LEVEL SECURITY` with zero policies plus an explicit `REVOKE`. This package introduces no
  competing model.
- **Fail-closed public truth.** Missing evidence renders as `false`, `null`, "Not available" or a hidden
  claim — never as a positive default.
- **No new scoring.** `docs/CURRENT_STAGE.md:221-222` places a new Decision Engine and new scoring systems out
  of scope. No numeric score, confidence, probability or rank is persisted or rendered anywhere in this design.

## Three corrections to the requested requirements

The brief that commissioned this work contained three assumptions the evidence does not support. Each is
argued in full in the linked document; each is summarised for the Owner in
[`CRM_EXECUTIVE_SUMMARY_RU.md`](CRM_EXECUTIVE_SUMMARY_RU.md).

1. **The five-minute human-contact target is not evidence-based.** Its source is a single vendor study whose
   own author states the effect appears only when data from several companies is combined. The defensible
   published threshold is one hour, and the market-leading speed-to-lead product deliberately *delays*
   routing to route correctly. Compounding it, Moscow-evening browsing arrives between 23:00 and 03:00 Phuket
   time, so a global wall-clock human target would be recorded as failed nightly. See
   `docs/crm/CRM_AUTOMATION_CATALOGUE.md` and `docs/crm/CRM_MARKET_RESEARCH_2026.md` §7.
2. **Per-stage conversion percentages will be dishonest at Forever's volume.** Three conversions of twenty
   leads is 15% with a 95% confidence interval of 5.2%–36.1%; detecting a real 10%→15% improvement needs
   roughly 1,400 leads. The design withholds ratios below a denominator of 30 and shows counts, ageing and
   coverage instead. See `docs/crm/CRM_ANALYTICS_AND_KPI.md`.
3. **The CRM cannot be the place buyer conversations start living without first answering who owns the
   WhatsApp number.** If advisors run buyer conversations on personal accounts, Forever has no ownership
   claim, no copy of the history and no reassignment path when an advisor leaves — and onboarding an existing
   WhatsApp Business App number to the Cloud API deletes that history. This is the largest commercial exposure
   in the area and no schema decision touches it. See `docs/crm/CRM_DECISION_RECORDS.md`, Owner decision 1.

## How this package was produced

Nineteen independent agents audited the repository and researched the 2026 market; ten authored the
architecture; eight independent skeptical reviewers attacked it across brokerage operations, product
simplicity, repository consistency, database and identity design, security and privacy, mobile usability and
Owner oversight, integration failure modes, and overengineering, migration risk and commercial value. They
returned 109 findings, of which 23 were blockers and two reviewers judged the first draft materially flawed.
Ninety findings were accepted and eleven rejected with reasons. The proposed buildable set fell from 33 tables
to zero for the first slice and eleven for the first pilot phase. The review and its adjudication are recorded
in [`CRM_INDEPENDENT_REVIEW.md`](CRM_INDEPENDENT_REVIEW.md) rather than being quietly absorbed.
