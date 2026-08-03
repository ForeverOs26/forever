# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-31

## Stage name

**FOREVER CRM SLICE 1 — GUEST LEAD WORKSPACE AND ACCOUNTABLE FOLLOW-UP**

Previous stage: **Forever Studio — Publisher Direct Upload** (`FOREVER-STUDIO-001`), whose production rollout gates remain open and unchanged (see "Retained Studio state" below).

Forever has completed the core product, data, import, intake, PDF-extraction, Navigator, Booth, Partner Demo, and bounded offline source-watcher foundations needed for the next phase.

The project now moves from infrastructure-first development to market-facing proof, and the market-facing bottleneck is now operational rather than structural: Forever collects guest enquiries and has nothing that works one through to an answer.

The active product checkpoint is:

**FOREVER-CRM-SLICE1 — Guest Lead Workspace and Accountable Follow-up**

CRM Slice 1 implementation is **Owner-authorized** and governed by `docs/FOREVER_CRM_SLICE1_IMPLEMENTATION_CONTRACT.md`, which is the single contract every CRM pull request is reviewed against.

### What this authorization is, and is not

CRM Slice 1 is a **controlled minimum vertical slice**. It is explicitly **not**:

- a completed CRM;
- authorization for a generic enterprise CRM;
- authorization for external CRM integration or migration;
- authorization for unified communications;
- authorization for autonomous AI operation;
- authorization for commission accounting;
- authorization for bulk marketing.

Unchanged by this stage change:

- Forever Factory autonomy remains **A0 — Propose only**;
- Forever Studio remains dormant unless separately authorized, and its six rollout gates are untouched;
- Booth V2 remains a separate stream;
- public Project Detail contact actions remain **disabled** unless separately authorized.

### CRM operating cohort

The initial expected cohort is 1 Owner, approximately 5 Working Sales Managers and approximately 10 Agents — approximately 16 CRM users at release. **These are operational launch estimates only.** They are not technical limits, licensing limits, role-slot limits or permanent staffing limits, and no number among them may be encoded anywhere in the implementation. The Owner must be able to add, activate, deactivate and manage further Agents and Working Sales Managers without a schema change, a migration, an application-code change, a redeployment, a per-employee permission policy, a hard-coded staff account or an external CRM seat.

### Retained Studio state

FOREVER-TRUTH-001A repository implementation is completed and canonical after PR #94. Fabricated public claims and optimistic evidence defaults are removed or fail closed. The prepared production cleanup plan remains unexecuted and Owner-gated; PR #94 performed no production inventory or cleanup.

TG-WATCH-001A is completed and canonical as a bounded offline internal tool. Live Telegram authentication, recurring monitoring, and multi-channel expansion are deferred until project freshness is a measured operating bottleneck.

The strategic direction is defined in `docs/FOREVER_STRATEGIC_NORTH_STAR.md` and is mandatory context for stage and task selection.

The Studio direct-publication rule remains canonical and unchanged: an upload by Owner or Trusted Publisher is direct publication authorization; no separate readiness, verification, review, or publication-approval step follows; incomplete business data never blocks publication.

FOREVER-STUDIO-001 is implemented and canonical after PR #95 merged at `7963ceeb3e49f932153dd92afde0e5cb446b57f5` (report: `docs/FOREVER_STUDIO_001_IMPLEMENTATION_REPORT.md`; runbook: `docs/FOREVER_STUDIO_OWNER_RUNBOOK.md`). The 2026-07-23 configuration-and-identity checkpoint created exactly one confirmed production Owner Auth identity and disabled public signup while retaining email/password sign-in. No Studio membership, bootstrap, or login occurred. Production rollout remains **BLOCKED** under Cloudflare verdict E: Owner authentication reached an account route, but the account and Workers & Pages inventory surfaces never rendered, Chrome blocked the focused read-only dashboard API GET with `ERR_BLOCKED_BY_CLIENT`, and no authorized Wrangler fallback exists. Cloudflare Workers/Nitro remains the preferred canonical production direction; Lovable remains design/prototyping absent contrary authoritative deployment evidence. Consequently, target/repository identity, deployed revision, and the four required production environment names/scopes remain unverified. No migration, deployment, smoke, publication, catalogue mutation, or Storage mutation occurred. See `docs/FOREVER_STUDIO_PRODUCTION_PREFLIGHT_REPORT.md`.

## Stage objective

Make one guest enquiry survivable end to end: captured with its project and unit context intact, owned by a named person, carrying exactly one next action, with an immutable record of everything that happened — and make the exceptions visible to a Working Sales Manager and to the Owner without asking anyone to watch a dashboard.

This stage must:

1. preserve the project and unit context a guest arrives with, instead of discarding it at submit;
2. give every active lead exactly one owner and exactly one next action;
3. keep an append-only record that no actor, including automation, can edit or delete;
4. surface overdue work, missing next actions and the 21-day ownership boundary as exceptions rather than as a dashboard;
5. let a Working Sales Manager run a personal pipeline and a team from one account and one role, with the two work areas visually distinct;
6. let the Owner add, re-role, activate and deactivate staff as data, with no migration, no code change and no redeployment;
7. preserve every historical assignment, event and actor identity when an employee leaves.

Exactly four CRM actor types exist in this stage: Owner, Working Sales Manager, Agent, and a system automation actor. No fifth production CRM role may be introduced. Booth Host and Forever Guide are operating descriptions and operate through Agent or Working Sales Manager permissions; they are not separate authorization roles.

The full in-scope list, the deferred list, the role definitions, the staff-access and lifecycle contract, the security boundaries and the implementation sequence are frozen in `docs/FOREVER_CRM_SLICE1_IMPLEMENTATION_CONTRACT.md`. That document governs; where any other CRM document disagrees with it for Slice 1, it wins.

The proposed architecture package at `docs/crm/` remains the design record it has always been. It is not superseded and it is not, by itself, authorization: the authorized boundary is the contract document above.

## Canonical foundations retained

The following remain canonical and unchanged:

- shared Navigator at `/navigator` and Booth Mode at `/booth` over one NAV-001 core;
- universal Project Detail and Forever Passport foundations;
- evidence-only Advisory, comparison, recommendation, and report foundations;
- Supabase project data and one generic Progressive draft importer;
- Coralina prepared as an unpublished draft payload: 1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch (reported loaded to dedicated staging in Wave 1; see Catalogue 10 state below);
- Fast Intake v1;
- Structured Input Preparation Design v1;
- SIP-001A real Rainpalm text-PDF validation;
- SIP-001B real Coralina 2026-07-17 validation;
- Partner Demo v1;
- Forever Factory RC1 at A0 — Propose only.

## Catalogue 10 state

**Nothing in this section is a live query.** No staging or production database was
contacted to write it. Each statement carries its footing.

- **PR #100 is canonical on `main`** (merge commit `a9d275fc`). Its production
  migration and deploy remain a separate, unexecuted Owner gate.
- **Wave 1 was _reported_ imported to a dedicated staging project as four
  unpublished drafts** — Coralina, Rainpalm Villas, Garden of Eden and The Title
  Sierra — on 2026-07-26. Footing: **reported** by the session that performed the
  import, recorded in `docs/FOREVER_CATALOG_10_WAVE1_STAGING_REPORT.md` §15. The
  arithmetic in that record was recomputed against the committed payloads; the
  live state was **not reverified** here.
- **All four remain unpublished.** Footing: **code-derived** — every payload is
  `mode: create` with `publish: false`, and the public catalogue requires
  `public_status = 'published'`.
- **Layan Green Park Phase 1 and AYANA Heights Seaview Residence are prepared
  offline only.** Their payloads are built, validated and committed; neither has
  been imported anywhere.
- **No Wave 2 staging import occurred.**
- **Production was untouched** throughout Catalogue 10. No project was published.
- **Closed PR #104 was replaced, not merged.** It carried the same catalogue
  work, but its documentation exposed inappropriate local and private metadata,
  so it was closed unmerged and the legitimate work was reconstructed on a clean
  sanitized branch. The replacement changes no payload data beyond the audit
  corrections recorded with it.
- **Forever Factory remains A0 — Propose only.**
- **Forever Studio production launch remains a separate P0 task**, unaffected by
  Catalogue 10 and still blocked on the Cloudflare host and environment-scope
  decision recorded above.

Coralina, Rainpalm, Garden of Eden and The Title Sierra remain unpublished. Layan
and AYANA remain offline-only.

## Current business and product reality

Forever has a strong technical foundation but insufficient external validation.

The current constraints are:

- the repository public-truth boundary is canonical, but no production inventory or cleanup was performed by PR #94; the prepared cleanup plan remains separately Owner-gated;
- the published real catalogue is too small to prove the full Navigator and Passport value proposition;
- Partner Demo is ready but has not yet produced structured partner feedback;
- guest funnel, response time, viewing, reservation, and transaction metrics are not yet established;
- guest enquiries are collected but not worked: nothing in the repository reads a lead back, so an arriving enquiry has no owner, no next action and no record;
- further infrastructure work has lower priority than truth, external feedback, and commercial proof.

CRM Slice 1 addresses exactly the second-to-last constraint. It is authorized because that constraint is operational and measured, not because a CRM is a natural next foundation.

## Active tasks

| Task                                                          | Owner                  | Status                                                                                    |
| ------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| CRM Slice 1 stage, Working Manager and staff-access contract  | Owner / Architect      | **Active** — frozen in `docs/FOREVER_CRM_SLICE1_IMPLEMENTATION_CONTRACT.md`               |
| CRM Slice 1 implementation, PR 1 through PR 12                | Owner / Architect      | **Active** — authorized, sequenced, not started                                           |
| Storage default-ACL migration production application          | Owner                  | Separate controlled operation; blocks any CRM migration application                       |
| TG-WATCH-001A offline watcher core and real Coralina pilot    | Codex / Owner          | Completed and canonical offline tooling; no live transport expansion                      |
| FOREVER-TRUTH-001A public truth audit and fail-closed cleanup | Claude / Codex / Owner | Repository implementation completed and canonical; production cleanup remains Owner-gated |
| FOREVER-STUDIO-001 direct publisher upload                    | Owner / Architect      | PR #95 merged; Auth ready; rollout blocked on authoritative host and environment scope    |
| Present Partner Demo v1 and collect structured feedback       | Owner                  | Parallel pending business checkpoint                                                      |
| Establish lead-response and guest-feedback baseline           | Owner / Architect      | Absorbed into CRM Slice 1                                                                 |
| Coralina publication readiness                                | Owner / Architect      | Next separate checkpoint; publication not authorized here                                 |
| Any imported-draft publication                                | Owner                  | Separate consequential action                                                             |

## Completed FOREVER-TRUTH-001A repository scope

### Read-only inventory

Establish the actual public and production-facing surface without assuming that old migrations equal current production state.

Inventory:

- active public projects;
- developers;
- project media;
- public routes;
- sitemap output;
- Navigator catalogue;
- offers, reviews, areas, counts, badges, scores, verdicts, images, inspections, freshness, and verification claims.

### Fail-closed cleanup

Remove, disable, or replace unsupported public behavior, including where present:

- fictitious or seeded reviews;
- fictitious or seeded offers;
- unsupported project or developer records;
- unsupported listing counts;
- unsupported inspection, verification, score, verdict, yield, market-position, demand, promotion, and freshness claims;
- project images that are not the project's media;
- optimistic defaults produced when source data is absent.

Expected missing-data behavior:

```text
missing evidence
→ false / null / Not available / hidden claim
```

Forbidden behavior:

```text
missing evidence
→ Forever Verified / Strong Buy / positive score / assumed image / invented fact
```

### Regression protection

Tests must prove that:

- no public route renders a known fictitious entity;
- a missing field cannot become a positive claim;
- sitemap and catalogue output contain only allowed projects;
- production output does not contain seeded project/review/offer names that were removed;
- evidence-dependent badges and labels require actual supporting state.

### Consequential-action boundary

FOREVER-TRUTH-001A may prepare a migration, deactivation plan, or exact production change set, but it must not perform an irreversible production change without the separate Owner gate required by the repository's safety policy.

Coralina publication is not included in this checkpoint.

## Partner and guest validation

Partner Demo v1 remains canonical and may be presented in parallel.

Feedback must be recorded and classified as:

- demo blocker;
- product comprehension issue;
- product improvement;
- data or trust issue;
- commercial or partnership decision;
- future roadmap idea.

The stage target is at least:

- one real partner presentation when scheduling permits; and
- five real guest, former-client, advisor, or trusted-user walkthroughs.

Feedback may change the roadmap. Code completion alone cannot close this stage.

## Metrics introduced in this stage

Begin recording:

- qualified guest conversations;
- enquiries received, by month and by source, as counts;
- enquiries with no recorded contact at all, as a count and an age;
- active leads with no next action — which should be zero;
- overdue next actions, banded 4 / 7 / 28;
- holding periods ending in the next three days;
- losses by reason, as counts;
- Navigator completion to contact;
- contact to viewing;
- guest comprehension and trust findings;
- Owner time spent preparing a project record;
- errors or corrections discovered after public review.

**Counts and ages only.** No response-time target in minutes or hours is published in code, copy or documentation, and no percentage is rendered against a denominator below 30 — Forever's own medians must be measured before any target is stated, and a ratio shown at single-digit volume is not a small measurement but a wrong one. Per-person ratios, conversion rates and rankings are not built in this stage; a workload view shows counts of work states, never a leaderboard.

The strategic North Star metric remains reservations or closed transactions in which Forever materially influenced the guest's decision. Early stage metrics are proxies until that evidence exists.

## In scope

CRM Slice 1, exactly as bounded by `docs/FOREVER_CRM_SLICE1_IMPLEMENTATION_CONTRACT.md` §14:

- context-preserving lead capture;
- Lead Inbox, My Leads and the Lead Workspace;
- the Working Sales Manager's My Work and My Team views, the Team Queue and the manager exception queues;
- company ownership of leads, assigned operational responsibility and originating-agent history;
- a controlled lead lifecycle and a controlled sales pipeline;
- an append-only activity timeline;
- a mandatory next action for active leads, overdue and missing-next-action detection, and 4/7/28-day default timing;
- 21-day ownership accountability, nurture, reactivation and loss reasons;
- guest requirements, project shortlist and unit shortlist;
- privacy-safe list DTOs, authorized detailed lead DTOs and server-mediated CRM writes;
- scalable staff access, scalable team membership and the Owner-only CRM Staff Access view;
- immutable role and assignment history, and audited management interventions.

Carried forward from the previous stage:

- fail-closed display defaults and the public-truth boundary;
- public-route and production-bundle regression tests;
- use of TG-WATCH-001A only as bounded offline tooling;
- Partner Demo presentation and structured feedback;
- documentation alignment with the Strategic North Star.

## Out of scope

- publishing Coralina;
- updating or upserting Coralina production data;
- TG-WATCH-001B live Telegram authentication or recurring monitoring;
- scaling Telegram monitoring to many channels;
- a new Decision Engine;
- new scoring systems;
- OCR, XLSX, scanned-PDF, image, or AI extraction;
- **large CRM integration** — unchanged. CRM Slice 1 integrates no external CRM, migrates from none, and buys no seats; it is an internal minimum operational layer over data Forever already collects;
- everything on the deferred list in `docs/FOREVER_CRM_SLICE1_IMPLEMENTATION_CONTRACT.md` §15, including unified communications, WhatsApp/Gmail/Calendar synchronization, telephony, autonomous AI follow-up or routing, commission and payroll, bulk marketing, a guest-facing CRM portal and unrestricted data export;
- enabling public Project Detail contact actions;
- activating Forever Studio;
- mobile app;
- marketplace or international expansion;
- Factory autonomy expansion;
- new architecture-only foundations without a measured current-stage need.

## Acceptance criteria

- exactly four CRM actor types exist: Owner, Working Sales Manager, Agent, system automation actor;
- a Working Sales Manager works a personal pipeline and leads a team from one account and one role, with My Work and My Team visually distinct;
- a Working Sales Manager's personal leads are subject to every accountability rule that applies to an Agent's leads, and no team authority can conceal or rewrite them;
- only the Owner may grant, revoke, activate, deactivate or change CRM roles, or change team structure;
- adding, re-roling or deactivating an employee requires no schema change, no migration, no code change, no redeployment and no per-employee policy;
- deactivation preserves every assignment, event, note, manager action and audit record, and historical events continue to display the original actor;
- every CRM table denies browser read and write at both the privilege and policy layers, verified before each migration commits;
- anonymous public lead INSERT remains supported and unmodified; browser SELECT on `public.leads` remains denied for both browser roles;
- no Lead List DTO carries an email, a phone number or a guest message;
- no deferred capability from the contract's §15 is shipped;
- no CRM migration is applied to production before the Storage default-ACL migration state is re-established and independently verified;
- an independent security, privacy and role-authorization review precedes any production release;
- public Project Detail contact actions remain disabled;
- the public surface contains no known fictitious review, offer, project, developer, or unsupported verification claim, and missing data continues to fail closed;
- affected tests, type checks, build, bundle scans, and security checks pass;
- TG-WATCH-001A remains bounded offline tooling with no live-transport expansion;
- no unauthorized import, publication, lead mutation, or production write occurs;
- Coralina and Rainpalm remain unpublished throughout this stage unless a later separately approved checkpoint changes that state; a Wave 1 load to a dedicated staging project is reported and is not publication;
- Factory remains A0.

## Definition of done

This stage is complete when:

1. one real guest enquiry arrives with its project and unit context intact, is assigned to a named person, carries a next action, and is answered — with the whole of it visible in the timeline;
2. the Owner can state, without opening the database, how many enquiries arrived, how many have no next action and how many are overdue;
3. the Owner can add, re-role and deactivate a member of staff without a developer;
4. an independent security and role-authorization review has passed;
5. the next checkpoint is selected from evidence rather than infrastructure momentum.

The immediate next action is **PR 1 — public contact-context repair**, which carries no schema change and is independently valuable whether or not the rest of Slice 1 ever ships. Studio production readiness remains a separate open Owner decision; no rollout action is authorized by this document. **Coralina Publication Readiness** remains a separate product checkpoint, followed by a focused pilot catalogue of 5–8 commercially important real projects. That sequence may change if external feedback provides stronger evidence.

If adoption fails — no authenticated CRM session in any 14-day window after release — the recorded response is a smaller surface, not more features.
