# Forever Roadmap

## Document role

This document defines development and business phases, dependencies, sequencing, and review gates. It is not the active task board. The active stage is maintained in `docs/CURRENT_STAGE.md`; non-sequenced ideas belong in `docs/BACKLOG.md`.

The strategic direction is governed by `docs/FOREVER_STRATEGIC_NORTH_STAR.md`.

The Owner-approved catalogue operating policy is governed by `docs/FOREVER_OWNER_DIRECT_PUBLICATION_POLICY.md`. The Owner-approved post-purchase and exit direction is governed by `docs/FOREVER_EXIT_001.md`.

## Current phase

**Forever Studio — Production Preflight and Owner Rollout Decision**

FOREVER-TRUTH-001A repository implementation is completed and canonical after PR #94. Fabricated public claims and optimistic evidence defaults are removed or fail closed. The prepared production cleanup plan remains unexecuted and Owner-gated; PR #94 performed no production inventory or cleanup.

The active product checkpoint is **FOREVER-STUDIO-001 production readiness**.

PR #95 merged the implementation at `7963ceeb3e49f932153dd92afde0e5cb446b57f5`. The read-only production database preflight passed its identity, TLS, history, catalogue, and no-drift checks, with seven Studio migrations pending in the exact committed order. The configuration-and-identity checkpoint completed the Auth portion: exactly one confirmed Owner exists, public signup is disabled, and email/password sign-in remains enabled. End-to-end rollout is still **BLOCKED** under Cloudflare verdict E because authenticated inventory remains technically unreadable; the authoritative target, repo/revision identity, and four required server environment names/scopes cannot be verified. Cloudflare Workers/Nitro is the preferred canonical production direction; Lovable remains design/prototyping absent contrary authoritative deployment evidence. The roadmap therefore retains the six Owner gates documented in `docs/FOREVER_STUDIO_PRODUCTION_PREFLIGHT_REPORT.md`: migration approval, server environment, Owner Auth, exact-revision deployment, controlled synthetic smoke, then a separately authorized first real publication. Gate C's identity provisioning is complete, and any provider-coupled environment/version activation must combine Gate B and Gate D under one later explicit exact-SHA Owner authorization.

TG-WATCH-001A is canonical as a bounded manual offline capability. Live Telegram transport and broad channel scaling are deferred until catalogue freshness becomes a measured operating bottleneck.

Partner Demo v1 remains canonical and pending presentation in parallel.

Coralina remains an unpublished draft. Rainpalm remains unimported and unpublished. Factory remains A0 — Propose only.

The direct-publication policy supersedes any interpretation that 5–8 projects are a permission gate. The first 5–8 remain an operating batch for measuring Studio speed and friction; catalogue growth continues toward the Owner objective of **100+ commercially relevant projects**.

FOREVER-EXIT-001 is an approved parallel strategic direction. Its non-code ownership register, mandate preparation, manual transaction pilot, legal review, privacy operating work and demand log may begin without displacing Studio stabilization or fast catalogue onboarding. Product code begins only after ordinary Studio publication is stable and the manual workflow has produced evidence.

## Strategic sequencing

Forever's approved sequence is:

```text
truthful public surface
→ stable Owner-direct Studio publication
→ Coralina recovery and first live project
→ fast project onboarding
→ 20 → 50 → 100+ commercially relevant projects
→ advisor and lead conversion workflow
→ manual Forever Exit proof and buyer↔unit continuity
→ measured reservations, assignments, resales and transactions
→ controlled partnerships and market intelligence
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

## Phase 1 — Coralina and catalogue-scale direct publication

### Objective

Create a commercially useful catalogue quickly, then continue growing without waiting for secondary content approval.

### Sequence

1. complete **Coralina Publication Readiness** and recover/publish the existing approved job through separately authorized production actions;
2. prove the ordinary R2 and Owner-direct publication path;
3. implement `FOREVER-STUDIO-FAST-PROJECT-ONBOARDING-001`;
4. require only the minimum data needed for a useful, identifiable project;
5. publish official developer materials and Owner-selected amenities without a secondary factual or readiness queue;
6. use the first 5–8 projects as an operating batch for measuring time, failure rate and Studio friction;
7. continue through 20 projects, then 50, then 100+ Owner-selected projects;
8. publish first and enrich prices, units, payment structures, Passport and Intelligence later;
9. measure actual Owner time and correction rate per project.

### Project selection criteria

Prioritize projects using:

- real guest demand;
- commission and transaction opportunity;
- access to source material;
- developer relationship;
- construction and sales relevance;
- fit with common guest profiles;
- ability to maintain current data honestly.

The first 5–8 projects are not a permission gate. Continue publication when the Studio flow is safe; remove friction as it is measured rather than stopping catalogue growth for another approval cycle.

### Exit criteria

- Coralina is safely published through a separately approved production action or remains explicitly blocked by a documented production fact;
- ordinary Owner-direct project publication works repeatedly;
- median Owner interaction is moving toward the ≤15-minute target;
- 20 projects are live or their exact blockers are documented;
- the path to 50 and 100+ projects is operational rather than theoretical;
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

## Parallel Phase E — Forever Ownership & Exit (FOREVER-EXIT-001)

### Objective

Give existing and future clients a credible way to exit an off-plan or completed property, turn post-purchase continuity into new seller and buyer leads, and make liquidity visible inside projects Forever already covers.

### Product rule

Forever Exit is not a listing marketplace. The unit of public authority is a signed mandate for a specific unit.

```text
no valid mandate
→ no public exit offer
```

This mandate is not a secondary factual review of an Owner-selected developer project. Project publication remains governed by the Owner Direct Publication Policy. Mandates apply only when Forever markets a third party's specific unit.

### Track A — starts without product code

1. create and maintain the internal buyer↔unit register for past and future Forever transactions;
2. prepare a Thai-lawyer-reviewed mandate;
3. select one existing client/unit and run one assignment or resale workflow manually;
4. record operational and document friction as implementation evidence;
5. begin a private demand log by project and unit profile;
6. confirm DPO, RoPA and notice-and-takedown operating records.

This work may run in parallel only when it does not delay Coralina recovery, fast onboarding or the 100+ project catalogue.

### Dependencies before Exit v1 code

- ordinary Studio publication is stable;
- the first manual transaction has closed or produced a documented legally viable workflow;
- at least one signed mandate exists;
- Thai legal advice confirms the operating structure and mandate boundary;
- no product decision delays the active catalogue-scale objective.

### Exit v1 sequence

1. persist buyer↔unit relationships;
2. support private Exit Intent without a public listing;
3. persist mandate authority and validity;
4. extend listing type to `resale` and `assignment`;
5. attach an exit offer to a canonical unit, with a minimal unit stub allowed when full unit inventory is not yet loaded;
6. keep owner identity, mandate, SPA, proof of payment, FET, title and similar evidence private;
7. expose only safe derived fields and explicitly public media;
8. show the initial exit lane on sold-out/developer-unavailable units;
9. add project CTAs: `I own a unit in this project` and `Notify me about investor exits`;
10. implement deterministic demand matching;
11. provide a direct assignment/resale share page;
12. add freshness, expiry, audit and correction workflows;
13. provide Exit Check and later Exit Passport.

### Exit criteria

- 100% of public exit offers have a valid mandate;
- 0 sensitive legal/personal owner files are publicly exposed;
- at least one existing client has completed the manual or digital workflow;
- at least one qualified buyer demand record has matched an owner exit;
- exactly one canonical project/unit identity is used per offer;
- no re-upload or duplicated disconnected listing is required when Forever already holds the unit relationship;
- the first assignment/resale transaction is attributed to Forever or the remaining commercial blocker is documented.

### Not in this phase

- public owner registration;
- open marketplace;
- public Assignments section before active inventory justifies it;
- full owner portal;
- lead sale or lead auction;
- platform escrow or client-money custody;
- iBuying;
- paid verification badge;
- transaction-price index;
- automated public tax calculator before authoritative legal confirmation;
- mandatory co-broker network;
- owner-paid visibility model without a new strategic review.

### Review triggers

- first manual exit closes;
- first owner refuses a mandate;
- developer objects to exit presentation;
- legal advice conflicts with the operating model;
- 10 active Exit Intents;
- 2 Forever-attributed exits;
- owner portal, paid visibility or public owner registration is proposed;
- 30 verified exit transactions;
- six months without review.

## Phase 3 — Controlled coverage and partnerships

### Objective

Scale only after commercial and operating proof.

### Candidate work

- continue catalogue growth toward 100+ while measuring useful demand coverage;
- pilot additional Telegram channels only for already covered projects;
- formalize developer partnerships with independence rules;
- produce useful project-change and market-intelligence content;
- test Booth commercially when the catalogue can support varied guest needs;
- consider partner-agent access and qualified referral workflows;
- expand Forever Exit partner handling only after Forever has valid mandates, controlled inventory and clear attribution.

### Independence rule

Developer payment, promotion, or access must never alter source facts, risk status, missing-data treatment, or recommendation logic. Any paid placement must be visibly marked and separated from evidence status.

## Later horizons

Only after measured proof:

- wider project coverage and ongoing enrichment;
- Forever Exit owner portal and repeat/referral workflows;
- rental and property-management extensions;
- Phuket market-intelligence and verified comparable products;
- agent or developer subscriptions;
- additional Thai markets;
- public grounded AI assistance;
- selected Factory autonomy promotion;
- potential B2B commercialization of internal tools.

Marketplace, international expansion, live AI guest advice, public owner self-registration, owner-paid listing visibility, and Factory commercialization each require a new strategic review.

## Work-in-progress policy

Forever should normally run no more than:

- one guest/product/commercial task; and
- one data/operations task.

FOREVER-EXIT-001 Track A is permitted as a lightweight business-validation stream only when it does not displace the active product task or the data/operations task.

Technical merge is not enough to close a phase. Every major phase needs an external signal such as guest feedback, partner feedback, a developer decision, a viewing, a reservation, a closed deal, an assignment/resale mandate, or a measured operating improvement.

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
- Factory autonomy — trigger: bounded automation has a sustained low-incident record and measurable ROI;
- full Forever Exit owner portal — trigger: at least 10 active Exit Intents or 2 closed exits;
- public Assignments section — trigger: enough current mandated offers to avoid an empty marketplace;
- public owner self-registration — trigger: legal, identity, support and abuse boundaries are independently approved;
- automated exit-tax calculator — trigger: Thai legal/accounting confirmation resolves the transfer/SBT basis;
- verified transaction-price index — trigger: at least 30 closed evidence-backed exit transactions.

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
- percentage of projects published within 15 minutes of Owner interaction;
- catalogue freshness;
- Owner hours per project onboarding;
- correction rate after publication;
- buyer↔unit records captured;
- private Exit Intents;
- signed exit mandates;
- time from mandate to first qualified match;
- existing clients re-engaged;
- closed assignment/resale transactions;
- percentage of public exit offers with a valid mandate — target 100%;
- percentage of sensitive owner evidence exposed publicly — target 0%;
- Forever-attributed commission or revenue.

Commits, tests, modules, documents, agents, and catalogue size without demand are not primary business metrics.

## Backlog boundary

Items that are not sequenced into a roadmap phase belong in `docs/BACKLOG.md`. Moving backlog work into this roadmap or into `docs/CURRENT_STAGE.md` requires Architect Review and reconciliation with `docs/FOREVER_STRATEGIC_NORTH_STAR.md`.
