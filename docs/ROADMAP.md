# Forever Roadmap

## Document role

This document defines development and business phases, dependencies, sequencing, and review gates. It is not the active task board. The active stage is maintained in `docs/CURRENT_STAGE.md`; non-sequenced ideas belong in `docs/BACKLOG.md`.

The strategic direction is governed by `docs/FOREVER_STRATEGIC_NORTH_STAR.md`.

## Current phase

**Forever Studio — Production Preflight and Owner Rollout Decision**

FOREVER-TRUTH-001A repository implementation is completed and canonical after PR #94. Fabricated public claims and optimistic evidence defaults are removed or fail closed. The prepared production cleanup plan remains unexecuted and Owner-gated; PR #94 performed no production inventory or cleanup.

The active product checkpoint is **FOREVER-STUDIO-001 production readiness**.

PR #95 merged the implementation at `7963ceeb3e49f932153dd92afde0e5cb446b57f5`. The read-only production database preflight passed its identity, TLS, history, catalogue, and no-drift checks, with seven Studio migrations pending in the exact committed order. The configuration-and-identity checkpoint completed the Auth portion: exactly one confirmed Owner exists, public signup is disabled, and email/password sign-in remains enabled. End-to-end rollout is still **BLOCKED** under Cloudflare verdict E because authenticated inventory remains technically unreadable; the authoritative target, repo/revision identity, and four required server environment names/scopes cannot be verified. Cloudflare Workers/Nitro is the preferred canonical production direction; Lovable remains design/prototyping absent contrary authoritative deployment evidence. The roadmap therefore retains the six Owner gates documented in `docs/FOREVER_STUDIO_PRODUCTION_PREFLIGHT_REPORT.md`: migration approval, server environment, Owner Auth, exact-revision deployment, controlled synthetic smoke, then a separately authorized first real publication. Gate C's identity provisioning is complete, and any provider-coupled environment/version activation must combine Gate B and Gate D under one later explicit exact-SHA Owner authorization.

TG-WATCH-001A is canonical as a bounded manual offline capability. Live Telegram transport and broad channel scaling are deferred until catalogue freshness becomes a measured operating bottleneck.

Partner Demo v1 remains canonical and pending presentation in parallel.

Coralina remains an unpublished draft. Rainpalm remains unimported and unpublished. Factory remains A0 — Propose only.

## Strategic sequencing

Forever's approved sequence is:

```text
truthful public surface
→ real partner and guest feedback
→ Coralina publication readiness
→ 5–8 commercially important real projects
→ fast advisor and lead workflow
→ measured reservations and transactions
→ controlled catalogue expansion
→ developer partnerships and market intelligence
```

Do not default to:

```text
more foundations
→ more governance
→ more automation
→ market contact later
```

## Completed repository checkpoint — FOREVER-TRUTH-001A

### Objective

The repository implementation now provides a source-honest, fail-closed public boundary. Its prepared production cleanup is still unexecuted and Owner-gated.

### Product and commercial outcomes

- zero known fictitious or unsupported public claims;
- missing evidence fails closed in public UI and services;
- one real partner presentation when scheduling permits;
- at least five real guest, former-client, advisor, or trusted-user walkthroughs;
- first-response and funnel baselines established;
- TG-WATCH-001A remains bounded offline tooling with no live-transport expansion.

### Work

- FOREVER-TRUTH-001A public inventory and cleanup;
- review public project, developer, media, offer, review, area, count, score, badge, verdict, image, freshness, and inspection behavior;
- replace optimistic defaults with `false`, `null`, `Not available`, or hidden claims;
- add public-route and bundle regression tests;
- present Partner Demo and record structured feedback;
- define a simple lead-alert and response measurement process if it can be implemented without distracting from truth cleanup;
- establish minimal repeatable CI or equivalent validation when justified.

### Not in this phase

- Coralina publication;
- live Telegram login or recurring monitoring;
- additional ingestion formats;
- new scoring or Decision Engine;
- CRM platform purchase;
- Factory expansion;
- marketplace, mobile app, or international expansion.

### Exit criteria

- public truth acceptance criteria in `docs/CURRENT_STAGE.md` pass;
- external feedback exists and has been reviewed;
- the next product checkpoint is selected from evidence.

## Phase 1 — Coralina and the focused real catalogue

### Objective

Create a small catalogue that is useful in real advisory conversations.

### Sequence

1. complete **Coralina Publication Readiness**;
2. reconcile the unpublished draft with the latest approved source package;
3. confirm media and price-publication policy;
4. prepare the exact production change set;
5. obtain separate Owner authorization before production update or publication;
6. select 5–8 commercially important projects;
7. produce Passport-light records with visible gaps and source freshness;
8. measure actual Owner time and correction rate per project.

### Project selection criteria

Prioritize projects using:

- real guest demand;
- commission and transaction opportunity;
- access to source material;
- developer relationship;
- construction and sales relevance;
- fit with common guest profiles;
- ability to maintain current data honestly.

Do not target 25–40 projects before the 5–8 project pilot proves onboarding economics and guest value.

### Exit criteria

- Coralina is either safely published through a separately approved action or remains explicitly blocked by a documented business decision;
- 5–8 real project records are usable in advisory;
- Owner time per project and correction rate are measured;
- Navigator produces supported reasons for a meaningful portion of real sessions.

## Phase 2 — Advisor conversion system

### Objective

Turn interest into qualified conversations, viewings, reservations, and closed deals.

### Candidate work

- lead alert;
- Navigator profile attached to a lead;
- simple advisor queue and statuses;
- RU/EN first-response templates;
- comparison and advisor report workflow;
- measurable stages: new → contacted → qualified → viewing → reserved → closed/lost;
- response-time and funnel analytics.

Use the existing Supabase lead boundary and Advisory foundations before buying or building a large CRM.

### Exit criteria

- median response time is measured and improving;
- contact-to-viewing baseline exists;
- at least one reservation or transaction is attributed to Forever-assisted work;
- the report and advisor workflow save measurable time or improve conversion.

## Phase 3 — Controlled coverage and partnerships

### Objective

Scale only after commercial and operating proof.

### Candidate work

- expand from 5–8 toward 10–15 projects;
- decide from evidence whether 20–30 is justified;
- pilot additional Telegram channels only for already covered projects;
- formalize developer partnerships with independence rules;
- produce useful project-change and market-intelligence content;
- test Booth commercially when the catalogue can support varied guest needs;
- consider partner-agent access and qualified referral workflows.

### Independence rule

Developer payment, promotion, or access must never alter source facts, risk status, missing-data treatment, or recommendation logic. Any paid placement must be visibly marked and separated from evidence status.

## Later horizons

Only after measured proof:

- wider project coverage;
- resale and rental extensions;
- Phuket market-intelligence products;
- agent or developer subscriptions;
- additional Thai markets;
- public grounded AI assistance;
- selected Factory autonomy promotion;
- potential B2B commercialization of internal tools.

Marketplace, international expansion, live AI guest advice, and Factory commercialization each require a new strategic review.

## Work-in-progress policy

Forever should normally run no more than:

- one guest/product/commercial task; and
- one data/operations task.

Technical merge is not enough to close a phase. Every major phase needs an external signal such as guest feedback, partner feedback, a developer decision, a viewing, a reservation, a closed deal, or a measured operating improvement.

## Completed foundations retained

The following foundations remain available and should be reused rather than rebuilt:

- Forever Blueprint and canonical documentation;
- Project Detail Engine;
- deterministic Intelligence and Passport foundations;
- Discovery and project cards;
- Advisory, comparison, recommendation, report, and client-strategy foundations;
- shared Navigator and Booth Mode;
- Supabase project database and Modeva import;
- one generic Progressive draft importer;
- Project Knowledge Platform foundations and internal inspection routes;
- Fast Intake v1;
- Structured Input Preparation Design v1;
- SIP-001A Rainpalm validation;
- SIP-001B Coralina validation and version diff;
- Partner Demo v1;
- canonical TG-WATCH-001A offline watcher;
- Factory RC1 at A0.

These are capabilities, not automatic priorities.

## Deferred until a real trigger

- TG-WATCH-001B live Telegram transport — trigger: manual freshness work is a measured recurring bottleneck;
- XLSX/CSV parser — trigger: a commercially important project is blocked by a real spreadsheet;
- OCR/scanned-PDF/image extraction — trigger: a commercially important project cannot be onboarded otherwise;
- new scoring — trigger: sufficient verified data and guest validation support a rule;
- Knowledge persistence RC6/RC7 — trigger: Git artifacts or current storage prevent required operations;
- Booth hardware — trigger: catalogue and partner distribution justify a measured pilot;
- external CRM — trigger: lead volume exceeds the simple internal workflow;
- Factory autonomy — trigger: bounded automation has a sustained low-incident record and measurable ROI.

## Metrics

### North Star

Reservations or closed transactions in which Forever materially influenced the guest's decision.

### Operating metrics

- qualified conversations;
- median first-response time;
- Navigator completion to contact;
- contact to viewing;
- viewing to reservation;
- source-backed projects published;
- catalogue freshness;
- Owner hours per project onboarding;
- correction rate after publication;
- Forever-attributed commission or revenue.

Commits, tests, modules, documents, agents, and catalogue size without demand are not primary business metrics.

## Backlog boundary

Items that are not sequenced into a roadmap phase belong in `docs/BACKLOG.md`. Moving backlog work into this roadmap or into `docs/CURRENT_STAGE.md` requires Architect Review and reconciliation with `docs/FOREVER_STRATEGIC_NORTH_STAR.md`.
