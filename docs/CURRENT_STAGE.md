# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-23

## Stage name

**Forever Studio — Publisher Direct Upload**

Forever has completed the core product, data, import, intake, PDF-extraction, Navigator, Booth, Partner Demo, and bounded offline source-watcher foundations needed for the next phase.

The project now moves from infrastructure-first development to market-facing proof.

The active product checkpoint is:

**FOREVER-STUDIO-001 — Authenticated Mobile Owner and Trusted Publisher Direct Upload**

FOREVER-TRUTH-001A repository implementation is completed and canonical after PR #94. Fabricated public claims and optimistic evidence defaults are removed or fail closed. The prepared production cleanup plan remains unexecuted and Owner-gated; PR #94 performed no production inventory or cleanup.

TG-WATCH-001A is completed and canonical as a bounded offline internal tool. Live Telegram authentication, recurring monitoring, and multi-channel expansion are deferred until project freshness is a measured operating bottleneck.

The strategic direction is defined in `docs/FOREVER_STRATEGIC_NORTH_STAR.md` and is mandatory context for stage and task selection.

## Stage objective

Enable an authenticated Owner or Trusted Publisher to publish a useful project update directly from phone, tablet, or desktop, without manual JSON, SQL, or terminal work.

This stage must:

1. treat an Owner or Trusted Publisher upload as direct publication authorization;
2. never add a separate readiness, verification, review, or publication-approval step;
3. allow incomplete business data without blocking publication, while displaying all useful available information and leaving missing fields absent or neutral;
4. support new developments, project updates, price updates, construction media, and resale;
5. provide a usable phone, tablet, and desktop interface;
6. target 2–5 minutes of publisher interaction and a usable public result within 15 minutes.

FOREVER-STUDIO-001 is implemented and canonical after PR #95 merged at `7963ceeb3e49f932153dd92afde0e5cb446b57f5` (report: `docs/FOREVER_STUDIO_001_IMPLEMENTATION_REPORT.md`; runbook: `docs/FOREVER_STUDIO_OWNER_RUNBOOK.md`). The production preflight is now the active checkpoint. A read-only, TLS-verified inspection found the production schema healthy and all seven Studio migrations pending in their expected order, but production rollout is **BLOCKED**: the deployed Lovable revision and production secret presence are not verifiable, the public production URL returns 404, there is no confirmed Owner Auth user, and public email signup is enabled. No production migration, Auth mutation, deployment, publication, or other write was performed. See `docs/FOREVER_STUDIO_PRODUCTION_PREFLIGHT_REPORT.md`.

## Canonical foundations retained

The following remain canonical and unchanged:

- shared Navigator at `/navigator` and Booth Mode at `/booth` over one NAV-001 core;
- universal Project Detail and Forever Passport foundations;
- evidence-only Advisory, comparison, recommendation, and report foundations;
- Supabase project data and one generic Progressive draft importer;
- Coralina imported as an unpublished draft: 1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch;
- Fast Intake v1;
- Structured Input Preparation Design v1;
- SIP-001A real Rainpalm text-PDF validation;
- SIP-001B real Coralina 2026-07-17 validation;
- Partner Demo v1;
- Forever Factory RC1 at A0 — Propose only.

Coralina remains unpublished. Rainpalm remains unimported and unpublished.

## Current business and product reality

Forever has a strong technical foundation but insufficient external validation.

The current constraints are:

- the repository public-truth boundary is canonical, but no production inventory or cleanup was performed by PR #94; the prepared cleanup plan remains separately Owner-gated;
- the published real catalogue is too small to prove the full Navigator and Passport value proposition;
- Partner Demo is ready but has not yet produced structured partner feedback;
- guest funnel, response time, viewing, reservation, and transaction metrics are not yet established;
- further infrastructure work has lower priority than truth, external feedback, and commercial proof.

## Active tasks

| Task                                                          | Owner                  | Status                                                                                    |
| ------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| TG-WATCH-001A offline watcher core and real Coralina pilot    | Codex / Owner          | Completed and canonical offline tooling; no live transport expansion                      |
| FOREVER-TRUTH-001A public truth audit and fail-closed cleanup | Claude / Codex / Owner | Repository implementation completed and canonical; production cleanup remains Owner-gated |
| FOREVER-STUDIO-001 direct publisher upload                    | Owner / Architect      | PR #95 merged; production preflight blocked pending deployment/config/Auth readiness      |
| Present Partner Demo v1 and collect structured feedback       | Owner                  | Parallel pending business checkpoint                                                      |
| Establish lead-response and guest-feedback baseline           | Owner / Architect      | Starts during this stage                                                                  |
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
- median first-response time;
- Navigator completion to contact;
- contact to viewing;
- guest comprehension and trust findings;
- Owner time spent preparing a project record;
- errors or corrections discovered after public review.

The strategic North Star metric remains reservations or closed transactions in which Forever materially influenced the guest's decision. Early stage metrics are proxies until that evidence exists.

## In scope

- truth audit and public cleanup;
- fail-closed display defaults;
- public-route and production-bundle regression tests;
- use of TG-WATCH-001A only as bounded offline tooling;
- Partner Demo presentation and structured feedback;
- simple lead-response measurement and alert design where it provides immediate value;
- documentation alignment with the Strategic North Star.

## Out of scope

- publishing Coralina;
- updating or upserting Coralina production data;
- TG-WATCH-001B live Telegram authentication or recurring monitoring;
- scaling Telegram monitoring to many channels;
- a new Decision Engine;
- new scoring systems;
- OCR, XLSX, scanned-PDF, image, or AI extraction;
- large CRM integration;
- mobile app;
- marketplace or international expansion;
- Factory autonomy expansion;
- new architecture-only foundations without a measured current-stage need.

## Acceptance criteria

- the public surface contains no known fictitious review, offer, project, developer, or unsupported verification claim;
- missing data fails closed throughout the affected public surfaces;
- the actual production/public inventory is documented from read-only evidence;
- affected tests, type checks, build, bundle scans, and security checks pass;
- TG-WATCH-001A remains bounded offline tooling with no live-transport expansion;
- Partner Demo or guest testing produces at least one external feedback record;
- no unauthorized import, publication, lead mutation, or production write occurs;
- Coralina remains unpublished and Rainpalm remains unimported/unpublished throughout this stage unless a later separately approved checkpoint changes that state;
- Factory remains A0.

## Definition of done

This stage is complete when:

1. Forever's public surface is source-honest and fail-closed;
2. external partner or guest feedback has been collected and reviewed;
3. the next checkpoint is selected from evidence rather than infrastructure momentum.

The immediate checkpoint is an Owner decision on the blocked Studio production-readiness gates. No rollout action is authorized by this document. **Coralina Publication Readiness** remains the next separate product checkpoint after a safe Studio decision, followed by a focused pilot catalogue of 5–8 commercially important real projects. That sequence may change if external feedback provides stronger evidence.
