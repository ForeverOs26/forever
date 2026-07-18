# Forever Roadmap

## Document role

This document defines development phases, dependencies, and sequencing. It is not the active task board. The active stage is maintained in `docs/CURRENT_STAGE.md`; future unsequenced tasks and ideas are maintained in `docs/BACKLOG.md`.

## Current Development Phase

Ordinary new-project persistence now uses the generic Progressive draft importer. See `docs/CURRENT_STAGE.md`.

RC5.5D is completed, reviewed, integrated, canonically applied, and verified as exceptional maintenance capability. Ordinary imports no longer use its approval/receipt workflow or repeated platform certification. The normal sequence is payload validation → duplicate check → one atomic Progressive RPC transaction → exact graph verification → `COMMIT` → short post-commit verification. The next checkpoint is Owner-authorized Coralina draft import through that generic importer; Coralina has not yet been imported, no production connection occurred during simplification, publication is separate, and Factory remains A0.

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

Ordinary new-project import is R2 pending independent review and Owner approval: one generic Progressive draft importer and visible Windows launcher perform validation, duplicate protection, one atomic RPC transaction, exact graph verification, commit, and a short post-commit check. Ordinary imports do not require `pg_stat_ssl`, platform recertification, rollback rehearsal, strict RC5.5D approval/receipt flow, project-specific launchers, or repeated infrastructure audits. The next checkpoint is Owner-authorized Coralina draft import through the generic importer. Coralina has not been imported; publication remains later and separate; Factory remains A0.

- RC5.5 Coralina safe execution
  - RC5.5A (completed, merged): deterministic plan hashing, explicit local/staging/production targets, pure preflight guards, and a non-persistent dry-run receipt. Production is blocked; staging is unconfigured; no database access occurs.
  - RC5.5B (completed, merged, locally proven): explicitly requested, read-only target collision inspection with proven-complete paginated reads. The Owner's local proving run against the reconciled canonical local target reported Coralina as 405 `absent` operations with no collisions, duplicates, identity conflicts, or inspection errors.
  - RC5.5C (completed, reviewed, integrated, and merged): transaction-backed execution and rollback preparation — a single-transaction boundary, Owner approval-artifact contract, deterministic ordering, in-transaction verification, automatic rollback, sanitized receipts, and an explicit `--execute-approved-import` mode. The live adapter stays disabled; no real import has occurred; real database writes remain zero.
  - RC5.5D (completed, reviewed, integrated, canonically applied, and verified): migration `20260715120000` is recorded exactly once. The complete canonical boundary and security state passed, including the exact ownership and capability allowlists, 10 dedicated policy definitions, and effective `postgres` membership capabilities. The pre-application manual logical backup was completed and verified. No retry, repair, `GRANT`, or `REVOKE` is required.
  - Historical execution preparation is retained only for exceptional maintenance. The ordinary next checkpoint is Owner-authorized Coralina draft import through the generic importer; Coralina has not been imported, publication remains separate, and Factory stays A0.

## Upcoming Phases

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

- Tablet Booth Mode.
- CRM integration.
- PDF and investor report generation.
- Import Engine v2 for richer documents, media, and intelligence ingestion.
- Admin/project data management.
- Mobile app interface.
- Bridging the RC4.4–RC5.1 Project Knowledge Platform's canonical record to a persistence layer (the FOREVER_BRAIN RC6/RC7 track).
- Exposing approved project knowledge to the public product, once source-backed blockers are resolved for at least one project.

## Backlog boundary

Items that are not sequenced into a roadmap phase belong in `docs/BACKLOG.md`. Moving backlog work into this roadmap or into `docs/CURRENT_STAGE.md` requires Architect Review.
