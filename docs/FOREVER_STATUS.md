# Forever Status

## Document role

This document records current repository, product, database, website, and milestone status. The canonical active-stage plan, owners, acceptance criteria, and definition of done are maintained in `docs/CURRENT_STAGE.md`.

## Factory Activation

Forever Factory Constitution RC1 is active at A0 - Propose only. The bounded Factory routing, execution-connector, and Continue Forever foundations are deterministic decision-support and execution mechanics; they do not select project priorities, authorize consequential actions, or permit automatic merge. Product development remains the primary priority.

## Current Milestone

Structured Input Preparation Design v1 and SIP-001A are independently audited, real-Windows validated, Owner approved, and canonical. SIP-001A established local deterministic extraction from the authorized Rainpalm qualified text-PDF, with reviewed artifacts, repeatability, and unchanged Fast Intake compatibility. The active development checkpoint is SIP-001B: validate the canonical text-PDF extractor against one additional real authorized qualified price-list PDF before adding another source format. Partner Demo v1 remains canonical and presentation-ready, pending partner scheduling in parallel; it does not block SIP-001B. Coralina remains unpublished, Rainpalm remains unimported and unpublished, and Factory autonomy remains A0. See `docs/SIP_001A_IMPLEMENTATION_REPORT.md`.

A shared Forever Navigator with two presentation shells — website (`/navigator`) and Booth Mode (`/booth`) — over a single Navigator Core is canonical on `main`. NAV-001 remains the shared Navigator source of truth; its approved Screens 00–08 questions, order, DecisionProfile, Forever Story, RecommendationPath, advisor invitation, and confirmation/edit behavior are preserved unchanged. The website and Booth shells consume the same core question definitions, DecisionProfile derivation, Forever Story generation, RecommendationPath, and one deterministic project-match evaluator with sentinel/unavailable-value guards, so identical answers produce identical results in either mode. Booth Mode is a presentation/employee workflow shell, not a second product: it reuses ProjectService, the universal `/projects/<slug>` Project Detail route, and the existing lead-service contract, and introduces no schema, migration, RLS, or new backend. Booth is intentionally not linked from normal public navigation. The local website preview is completed; Coralina remains unpublished and is excluded from the production client bundle, appearing only through the existing local development demo preview.

Coralina's production draft import is completed as a draft only: 1 project, 8 buildings, 198 units, 198 prices, 6 warnings, and 1 ingestion batch. Coralina remains unpublished; publication is a separate, later action. Fast Intake v1 with a 15-minute draft target is implemented, independently Windows-validated, and canonical on `main`; Coralina remains unpublished and Factory autonomy remains A0.

Fast Intake v1 is a bounded, local, owner-only preparation-and-validation tool. The local owner command is `npm.cmd run intake -- ...` in Windows PowerShell and `cmd.exe`, and `npm run intake -- ...` in Bash, Linux, and macOS. It prepares and validates a deterministic, unpublished Progressive draft payload for the ordinary generic draft importer. Transactional output, journaled recovery, hardened ZIP safety, per-project locking, importer-compatibility validation, and anti-fabrication protections are canonical. It creates no database client, makes no production connection or network request, executes no database import, creates no lead, performs no publication or production write, and adds no schema, migration, RPC, RLS, grant, backend service, or UI. Its only writes are local managed artifacts and a gitignored temporary workspace.

Scope honesty: Fast Intake v1 consumes only already-structured artifacts (extracted price-list JSON and `project-facts.json`); raw PDFs, Excel files, images, and videos are inventoried and classified only. It does not yet transform an ordinary raw developer dossier into structured units/prices by itself — the 15-minute target applies when compatible structured artifacts already exist. Raw-document extraction/OCR/spreadsheet parsing is a later Fast Intake stage. See `docs/FAST_INTAKE_V1.md`.

The ordinary new-project persistence path is simplified to one generic Progressive draft importer. Its normal workflow is payload validation → duplicate check → one atomic Progressive RPC transaction → exact graph verification → `COMMIT` → short post-commit verification.

RC5.5D remains completed, canonically applied, and verified, but is historical or exceptional maintenance capability rather than the ordinary import workflow. Schema, migration, RPC, RLS, grant, existing-data mutation, and partial-state recovery work use that separate maintenance path.

The Coralina production draft import through the generic importer is completed: 1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch. Coralina remains an unpublished draft; publication remains a later separate action. Factory autonomy remains A0.

RC5.5D Live Execution Boundary Preparation is completed, reviewed, integrated, canonically applied, and verified.

- Migration `20260715120000` is recorded exactly once; canonical migration history contains 12 rows total.
- The canonical RC5.5D inventory contains 2 roles, 2 schemas, 2 boundary tables, 6 routines, and 10 dedicated policies.
- Ownership, grants, role attributes, and exact policy definitions passed.
- Effective `postgres` membership in `forever_import_execution_owner` passed with `MEMBER=true`, `USAGE=true`, and `SET=true`.
- The manual logical backup was completed and verified before application.
- No migration retry, repair, `GRANT`, or `REVOKE` is required.

The retained RC5.5D boundary remains disabled for ordinary imports; it exists for exceptional maintenance only. Coralina is imported as an unpublished draft and Factory autonomy remains A0.

## Completed Milestones

- FDB-001 through FDB-003 established and proved the Forever Core Database and Import Engine v1, including the Modeva import and idempotency validation.
- RC2.4-RC2.8 completed the evidence-only Advisory layer.
- RC3-001-RC3-005 completed the staged Import Engine planning foundation.
- RC4.4-RC4.9 completed the deterministic intake foundation chain: source registry, extraction pipeline, canonical project database, cross-source validation, knowledge graph, and readiness.
- RC5.0-RC5.1 proved the generic Project Knowledge Platform on Coralina and Modeva through internal `noindex` inspection routes.
- RC5.3 preserved Coralina's source gaps honestly; RC5.4 later resolved them from official sources and produced the deterministic 405-operation dry-run.
- RC5.5A completed deterministic plan fingerprints and fail-closed target preflight.
- RC5.5B completed read-only collision inspection and was locally proven with 405 `absent` Coralina operations at that time.
- RC5.5C completed the hermetic transaction and rollback preparation while keeping live execution disabled.
- RC5.5D completed the server-side/live-boundary implementation, review, integration, canonical application, and post-application verification described above.

## Current Tasks and Authorization Boundary

The Owner-authorized Coralina draft import through the generic importer is completed as a draft only; publication remains separately authorized. Shared Navigator (website + Booth Mode), Fast Intake v1, Partner Demo v1, Structured Input Preparation Design v1, and SIP-001A are canonical on `main`. The active product-development checkpoint is SIP-001B: validate the canonical text-PDF extractor against one additional real authorized qualified price-list PDF before adding another source format. Existing local-only execution, source-reference, repeatability, Fast Intake compatibility, no-import/no-publication, and Factory A0 boundaries remain unchanged. Partner Demo v1 presentation remains pending in parallel and does not block SIP-001B.

Ordinary imports must not trigger platform recertification, a production rollback rehearsal, strict RC5.5D approval/receipt flow, `pg_stat_ssl`, project-specific production launchers, or repeated preflight/postflight infrastructure audits.

The retained RC5.5D approval and execution controls apply only when exceptional maintenance scope requires them. They are not prerequisites to the ordinary generic draft importer.

## Blockers and Gates

- Coralina has no knowledge-readiness blocker; RC5.4 resolved `developer` and `country` from official sources.
- Coralina is imported as a draft; it awaits a separate Owner publication decision and remains excluded from production behavior.
- Modeva's Project Knowledge Platform readiness remains separately blocked by the absence of a committed developer package, even though Modeva itself is already live from FDB-003C.
- Future project onboarding requires committed source material under `forever-data/projects/{project_slug}/`.
- SIP-001A's real Rainpalm validation is complete; Rainpalm remains unimported and unpublished. SIP-001B requires one additional real authorized qualified text-PDF validation before any source-format expansion.

## Database Status

Modeva remains imported and validated with 7 buildings, 289 units, and 289 unit price-history rows. RC5.5D migration `20260715120000` exists exactly once in the canonical database as part of the exceptional-maintenance boundary. Coralina is imported as an unpublished draft: 1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch.

## Website and Architecture Status

The public website remains on the reusable Project Detail Engine, Forever Passport, deterministic Forever Intelligence, and Import Engine stack. The shared Navigator website route is implemented at `/navigator`; employee-guided Booth Mode is implemented at `/booth` but remains unlinked from normal public navigation. Both use one NAV-001 Navigator Core. The RC4.4-RC5.1 knowledge chain remains exposed only through internal, unlinked, `noindex` inspection routes and is not a public product surface. Architecture continues toward One Engine, Many Interfaces.

## AI Status

No AI implementation is active in the product. Intelligence and project-knowledge logic remain deterministic and explainable.

## Validation Status

The generic importer focused tests, disposable PostgreSQL 17.6 import/duplicate/rollback checks, Progressive Ingestion focused tests, TypeScript check, and production build passed during simplification. The final R2 integration also requires Ledger/reference consistency, diff hygiene, and changed-diff secret scanning.

RC5.5D canonical application verification remains historical evidence for exceptional maintenance. Documentation consistency and Git hygiene govern this R2 integration.

## Last Updated

2026-07-20
