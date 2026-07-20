# Forever Roadmap

## Document role

This document defines development phases, dependencies, and sequencing. It is not the active task board. The active stage is maintained in `docs/CURRENT_STAGE.md`; future unsequenced tasks and ideas are maintained in `docs/BACKLOG.md`.

## Current Development Phase

Structured Input Preparation Design v1, SIP-001A, and SIP-001B are independently reviewed, real-Windows validated, Owner-approved, and canonical. The active development checkpoint is **TG-WATCH-001 — Universal Read-Only Telegram Source Watcher Design and Safe Pilot**. It defines one universal local watcher, one protected Telegram user session, and a registry mapping channels to developers and project slugs; its pilot is `@coralinakamala` plus one additional authorized Title channel selected during the task. It will read new posts and attachments only, apply local quarantine and SHA-256 duplicate protection, classify source types, retain per-channel cursor and last-processed-message state, and produce Owner-review output. It does not authorize automatic database import, publication, or Factory autonomy expansion. Partner Demo v1 remains canonical and ready for presentation, pending scheduling as a parallel business checkpoint; it does not block TG-WATCH-001. Coralina remains unpublished, Rainpalm remains unimported and unpublished, and Factory remains A0. See `docs/SIP_001B_CORALINA_20260717_REPORT.md`, `docs/PARTNER_DEMO_V1.md`, and `docs/CURRENT_STAGE.md`.

A shared Forever Navigator over two shells — the website Navigator (`/navigator`) and Booth Mode (`/booth`) — is canonical on `main`. Both shells consume a single Navigator Core, NAV-001 remains the shared source of truth, and Booth Mode is a presentation/employee workflow shell rather than a second product. Booth is intentionally not linked from normal public navigation. See `docs/CURRENT_STAGE.md`.

Coralina's production draft import is completed as an unpublished draft (1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch); the local website preview is completed and Coralina stays unpublished and excluded from the production client bundle. Fast Intake v1 with a 15-minute draft target is implemented, independently Windows-validated, and canonical on `main`; Coralina remains unpublished and Factory remains A0. Rainpalm Fast Intake Pilot 01 completed from two manually prepared compatible structured JSON inputs in 39.834 seconds (`target_met=true`), yielding an unpublished validated partial draft (0 buildings, 21 units, 14 prices, 12 warnings). It did not import or publish Rainpalm. Fast Intake v1 prepares and validates an unpublished Progressive draft, writes local managed artifacts only, and consumes compatible already-structured extracted price-list JSON and `project-facts.json`. Raw PDFs, Excel files, images, and videos are inventoried and classified only; raw-document extraction, OCR, spreadsheet parsing, and computer vision are a later stage. The 15-minute target applies when compatible structured artifacts already exist.

Ordinary new-project persistence uses the generic Progressive draft importer. See `docs/CURRENT_STAGE.md`.

RC5.5D is completed, reviewed, integrated, canonically applied, and verified as exceptional maintenance capability. Ordinary imports no longer use its approval/receipt workflow or repeated platform certification. The normal sequence is payload validation → duplicate check → one atomic Progressive RPC transaction → exact graph verification → `COMMIT` → short post-commit verification. The Coralina production draft import through that generic importer is completed (1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch); Coralina remains an unpublished draft, publication is separate, and Factory remains A0. Fast Intake v1, Structured Input Preparation Design v1, SIP-001A, and SIP-001B are canonical. The immediate development checkpoint is TG-WATCH-001, while Partner Demo v1 presentation and its structured feedback remain pending in parallel.

## Completed Phases

- Product foundation
  - Forever Blueprint.
  - Product Specification.
  - Design Master Prompt.

- Project Detail foundation
  - Universal Project Detail Engine.
  - Reusable project sections.
  - Supabase-backed Project Detail Service.

- Intelligence foundation
  - Deterministic Forever Intelligence Core.
  - Explainable scoring and evidence outputs.
  - Forever Intelligence Report UI.

- Passport foundation
  - Forever Passport data model.
  - Passport mapper and serializer.
  - Forever Passport Card UI.

- Discovery and RC0 polish
  - Premium Project Card.
  - Functional Discovery filters, search, and sorting.
  - RC0 brand, copy, identity, and trust cleanup.

- Database foundation
  - FDB-001 additive Supabase Core Database migrations.
  - FDB-002 Modeva extraction, prerequisites, import migration, and validation.
  - FDB-003A Forever Import Engine v1.
  - FDB-003B Modeva dry-run validation.
  - FDB-003C real import/idempotency validation.
  - FDM-001 Modeva source folder structure.
  - FDM-002 Forever project import manifest standard.

- Advisory layer (RC2.4–RC2.8)
  - Forever Passport, Project Summary, Project Comparison, Project Recommendations, and the print-ready Advisor Report — evidence-only compositions of already-derived data, no new scoring engine.

- Shared Navigator
  - NAV-001 remains the shared source of truth for one Navigator Core.
  - Website Navigator is implemented at `/navigator` and employee-guided Booth Mode at `/booth`.
  - Booth remains unlinked from normal public navigation; both shells use the same real ProjectService catalogue, deterministic evaluator, runtime-slug Project Detail route, and existing lead-service contract.

- Project Knowledge Platform foundation chain (RC4.4–RC5.1)
  - RC4.4 Forever Source Registry Foundation.
  - RC4.5 Forever Extraction Pipeline Foundation.
  - RC4.6 Forever Canonical Project Database Foundation.
  - RC4.7 Forever Cross-Source Validation Foundation.
  - RC4.8 Forever Project Knowledge Graph Foundation.
  - RC4.9 Forever Project Readiness Foundation.
  - RC5.0 Coralina end-to-end vertical slice through the full chain, exposed at the internal `/internal/coralina` route.
  - RC5.1 generalisation into the project-agnostic `forever-project-knowledge` engine; Modeva onboarded as a second real project; generic internal route `/internal/projects/$slug`.
  - Architecture only: no persistence layer, no public route, no database write. RC5.4 later advanced Coralina to `ready`; Modeva remains honestly `blocked`.

## Completed source-verification phase

- Coralina source-backed blocker resolution
  - Locate and register source-backed evidence for `developer` and `country`.
  - Re-run cross-source validation and readiness through the RC4.4–RC5.1 chain.
  - Run Import Engine dry-run before any real import.
  - RC5.3 re-audited committed Coralina artifacts and correctly preserved both gaps. See `docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md`.
  - RC5.4 resolved both blockers using official corporate and government-hosted evidence, registered full provenance, regenerated the canonical record, and passed the 405-operation Import Engine dry-run. Execute mode remains disabled.
  - RC5.4 completed currency preparation with a deterministic Thailand-to-THB `inferred_default` policy. The source-verified Thailand evidence, price-list absence, rule id/version, and confidence remain auditable; no database write occurred.

## Active safe-execution phase

RC5.5C and RC5.5D are completed historical and exceptional maintenance capabilities for schema, migration, RPC, RLS, grant, existing-data mutation, or partial-state recovery work. They are not the ordinary new-project import workflow.

Ordinary new-project import is completed and proven: one generic Progressive draft importer and visible Windows launcher perform validation, duplicate protection, one atomic RPC transaction, exact graph verification, commit, and a short post-commit check. Ordinary imports do not require `pg_stat_ssl`, platform recertification, rollback rehearsal, strict RC5.5D approval/receipt flow, project-specific launchers, or repeated infrastructure audits. The Owner-authorized Coralina draft import through the generic importer is completed (1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch). Coralina remains an unpublished draft; publication remains later and separate; Factory remains A0. Fast Intake v1 is canonical; Rainpalm Pilot 01 completed as a measured, local, non-importing, non-publishing structured-input proof, and its evidence now supports the structured-input preparation design checkpoint.

- RC5.5 Coralina safe execution
  - RC5.5A (completed, merged): deterministic plan hashing, explicit local/staging/production targets, pure preflight guards, and a non-persistent dry-run receipt. Production is blocked; staging is unconfigured; no database access occurs.
  - RC5.5B (completed, merged, locally proven): explicitly requested, read-only target collision inspection with proven-complete paginated reads. The Owner's local proving run against the reconciled canonical local target reported Coralina as 405 `absent` operations with no collisions, duplicates, identity conflicts, or inspection errors.
  - RC5.5C (completed, reviewed, integrated, and merged): transaction-backed execution and rollback preparation — a single-transaction boundary, Owner approval-artifact contract, deterministic ordering, in-transaction verification, automatic rollback, sanitized receipts, and an explicit `--execute-approved-import` mode. The live adapter stays disabled; no real import has occurred; real database writes remain zero.
  - RC5.5D (completed, reviewed, integrated, canonically applied, and verified): migration `20260715120000` is recorded exactly once. The complete canonical boundary and security state passed, including the exact ownership and capability allowlists, 10 dedicated policy definitions, and effective `postgres` membership capabilities. The pre-application manual logical backup was completed and verified. No retry, repair, `GRANT`, or `REVOKE` is required.
  - Historical execution preparation is retained only for exceptional maintenance. The Coralina draft import through the generic importer is completed as an unpublished draft; publication remains separate, and Factory stays A0. Fast Intake v1 and Structured Input Preparation Design v1 are canonical; Rainpalm Pilot 01 is completed and its evidence supports the active SIP-001A checkpoint.

## Upcoming Phases

- Rainpalm Fast Intake Pilot 01 (completed)
  - Measured local structured-input preparation and validation: 39.834 seconds, target met.
  - Unpublished validated partial draft only; no database import, publication, or production write.
  - See `docs/FAST_INTAKE_PILOT_01_RAINPALM.md` for source integrity, warnings, and gaps.

- Structured Input Preparation Design v1 (completed and canonical)
  - Independently reviewed and Owner approved with existing Fast Intake contracts and safety boundaries unchanged.
  - Selects local Poppler text output plus deterministic TypeScript for SIP-001 and leaves no Owner-policy decision unresolved.

- SIP-001A supported text-PDF extraction (completed and canonical)
  - Independently audited and real-Windows validated against the authorized Rainpalm qualified text-PDF; reviewed artifacts, deterministic repeat, and unchanged Fast Intake compatibility are retained.
  - Rainpalm remains unimported and unpublished; Coralina remains unpublished; Factory remains A0.

- SIP-001B Coralina 2026-07-17 validation (completed and canonical)
  - Retained result: 198 accepted rows; 197 shared unchanged units; `CKD508` newly present; `CKF406` only `missing_from_latest_price_list`; zero price, price-per-sqm, availability-text, or attribute changes; THB `inferred_default`; sinking fund 850 THB/sqm; common fee 85 THB/sqm/month; seven-page visual Master Plan companion; no spatial interpretation.
  - Coralina remains unpublished, Rainpalm remains unimported and unpublished, Partner Demo remains canonical, and Factory remains A0.

- TG-WATCH-001 — Universal Read-Only Telegram Source Watcher Design and Safe Pilot (active development checkpoint)
  - Design one universal local watcher, rather than one agent per channel, using one protected Telegram user session and a configuration registry mapping channels to developers and project slugs.
  - Pilot `@coralinakamala` and one additional authorized Title channel selected during the task; read new posts and attachments only, quarantine locally with SHA-256 duplicate protection, classify canonical price tables, visual Master Plans, construction photos/videos, and other documents, retain per-channel cursor and last-processed-message state, and produce Owner-review output.
  - No automatic database import or publication, and no Factory autonomy expansion.

- Partner Demo v1 presentation (parallel pending business checkpoint)
  - Present Forever Partner Demo v1 from `docs/PARTNER_DEMO_V1.md` when partner scheduling permits.
  - Collect structured partner feedback and classify it as demo blocker, product improvement, future roadmap idea, or commercial/partnership decision.
  - This presentation does not block TG-WATCH-001.

- Broader raw-document extraction stages (later, separate)
  - XLSX/CSV, OCR, scanned-PDF, image, floor-plan, AI, or other extraction modes require later separately approved checkpoints.

- RC1 architecture hardening
  - Clarify canonical media flow.
  - Define project intelligence persistence strategy.
  - Resolve overlap between display fields and normalized tables.

- RC1 product hardening
  - Complete or remove Discovery Compare.
  - Improve loading and empty states.
  - Perform real-device mobile QA.
  - Refine Project Detail story flow.

## Future Milestones

- CRM integration.
- PDF and investor report generation.
- Import Engine v2 for richer documents, media, and intelligence ingestion.
- Admin/project data management.
- Mobile app interface.
- Bridging the RC4.4–RC5.1 Project Knowledge Platform's canonical record to a persistence layer (the FOREVER_BRAIN RC6/RC7 track).
- Exposing approved project knowledge to the public product, once source-backed blockers are resolved for at least one project.

## Backlog boundary

Items that are not sequenced into a roadmap phase belong in `docs/BACKLOG.md`. Moving backlog work into this roadmap or into `docs/CURRENT_STAGE.md` requires Architect Review.
