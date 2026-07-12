# Forever Status

## Document role

This document records current repository, product, database, website, and milestone status. The canonical active-stage plan, owners, acceptance criteria, and definition of done are maintained in `docs/CURRENT_STAGE.md`.

## Current Milestone

Coralina source-backed intake completion, using the completed RC4.4–RC5.1 Project Knowledge Platform. See `docs/CURRENT_STAGE.md`.

RC4.4–RC4.9 completed a full, tested, architecture-only intake foundation chain (source registry → extraction pipeline → canonical project database → cross-source validation → knowledge graph → readiness). RC5.0 ran real, committed Coralina source data through that entire chain and exposed the result at an internal-only route. RC5.1 generalized that vertical slice into a project-agnostic engine and onboarded a second real project, Modeva, purely from committed repository artifacts.

## Completed Milestones

- Universal Project Detail Engine foundation and route integration.
- Forever Intelligence Core MVP.
- Forever Intelligence Report UI.
- Forever Passport Architecture and Passport UI MVP.
- Premium Hero, Passport, Intelligence, Project Card, and Discovery refinements.
- RC0 trust cleanup for public-facing copy, contact identity, CTAs, and encoding.
- FDB-001 Forever Core Database foundation.
- FDB-002 Modeva extraction, unit import prerequisites, import migration, and validation.
- FDB-003A Forever Import Engine v1 created.
- FDB-003B Modeva Import Engine dry-run passed.
- FDB-003C Modeva real import/idempotency test passed.
- RC3-001 Import Engine architecture skeleton and safety hardening.
- RC3-002 first Project-only import stage and Coralina blocked dry-run validation.
- RC3-003 Buildings-only Import Engine stage after Project, with Modeva dry-run planning Project + 7 Buildings and Coralina still blocked by readiness validation.
- RC3-004 Canonical Unit Import dry-run stage after Buildings, with Modeva dry-run planning Project + 7 Buildings + 289 Units + 0 Prices and Coralina still blocked by readiness validation.
- RC3-005 Price History dry-run stage after Units, with Modeva dry-run planning Project + 7 Buildings + 289 Units + 289 Price History rows and Coralina still blocked by readiness validation.
- FDM-001 Modeva source material folder structure.
- FDM-002 Forever project import manifest standard.
- RC2.4–RC2.8 Advisory layer: Passport, Project Summary, Project Comparison, Project Recommendations, and the print-ready Advisor Report, all evidence-only compositions of already-derived data with no new scoring engine.
- RC4.4 Forever Source Registry Foundation: the canonical, architecture-only catalogue of every source document that enters the Forever ecosystem, with a deterministic in-memory registry and a never-throwing validation pipeline (`src/features/forever-project-sources`).
- RC4.5 Forever Extraction Pipeline Foundation: the architecture-only description of how a registered source produces structured, evidence-backed extraction facts, with confidence, provenance, and conflict handling that never silently resolves (`src/features/forever-extraction-pipeline`).
- RC4.6 Forever Canonical Project Database Foundation: the canonical destination of the intake chain — versioned fields, append-only revisions, snapshots, and merge description, still architecture only, with no persistence (`src/features/forever-project-database`).
- RC4.7 Forever Cross-Source Validation Foundation: deterministically examines extracted facts against registered sources and describes agreement, conflict, and admissibility without ever resolving a disagreement (`src/features/forever-cross-validation`).
- RC4.8 Forever Project Knowledge Graph Foundation: describes the knowledge graph a project's sources, facts, canonical record, and validation findings add up to, with uncertainty preserved and full traceability (`src/features/forever-knowledge-graph`).
- RC4.9 Forever Project Readiness Foundation: judges — never approves — whether a project's accumulated knowledge satisfies caller-stated requirements, formalizing the readiness audits the repository previously kept by hand (`src/features/forever-project-readiness`).
- RC5.0 Coralina End-to-End Vertical Slice: real, committed Coralina source data run through the complete RC4.4–RC4.9 chain, exposed at the internal-only route `/internal/coralina` (`noindex`, not linked, dynamically imported). Readiness is honestly `blocked` on the same two real gaps (`developer`, `country`) already tracked in the Coralina manifest.
- RC5.1 Project Knowledge Platform: the RC5.0 slice generalized into a project-agnostic engine, `src/features/forever-project-knowledge`. Coralina restated as a declarative definition with all 61 RC5.0 tests passing unchanged; Modeva onboarded as a second real project purely from committed artifacts, with an honestly `blocked` readiness verdict (no committed developer brochure). One generic internal inspection route, `/internal/projects/$slug`, now serves every catalogued project. See `docs/RC5_1_PROJECT_KNOWLEDGE_PLATFORM.md`.
- RC5.3 Coralina Evidence Audit: re-checked every committed Coralina artifact for `developer` and `country` evidence; found none new since RC5.0, so no fact was added for either blocker. The declared gap reasons were extended with the exact source-acquisition requirement for each field so `/internal/coralina` states precisely what evidence is still needed. Readiness standing is unchanged: `blocked`. See `docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md`.

## Active Tasks

See `docs/CURRENT_STAGE.md` for the canonical active-task table, owners, scope boundaries, acceptance criteria, and definition of done.

Current factual task summary:

- Resolve Coralina source-backed blockers for `developer` and `country` before any Project import can proceed.
- Keep Import Engine usage documented for future projects.

## Blockers

- No current Modeva database-import blocker (Modeva has been live in the production database since FDB-003C).
- Coralina's `developer` and `country` facts remain unresolved; its Project Knowledge Platform readiness report is `blocked` for those two reasons. RC5.3 re-audited both against every committed artifact and confirmed no new evidence exists (`docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md`).
- Modeva's Project Knowledge Platform readiness report is separately `blocked`: no developer package (brochure) was ever committed under `forever-data/projects/modeva/`, so its committed knowledge package cannot pass the intake bar even though the project itself is live.
- Future project imports and knowledge onboarding require source materials to be placed under `forever-data/projects/{project_slug}/`; `rainpalm` and `gardens-of-eden` currently have only blank `database/projects/*/README.md` templates and no committed source package.

## Next Milestone

Resolve Coralina's two source-backed blockers using the completed RC4.4–RC5.1 chain, then re-run cross-source validation, readiness, and an Import Engine dry-run. See `docs/CURRENT_STAGE.md` for the recommended stage after that.

## Architecture Status

The website continues to use a reusable Project Detail Engine, Forever Passport layer, deterministic Forever Intelligence module, and a reusable Import Engine for source-driven project ingestion, as before. Alongside that public-facing stack, RC4.4–RC5.1 completed a separate, tested, architecture-only intake foundation chain — source registry, extraction pipeline, canonical project database, cross-source validation, knowledge graph, and readiness — culminating in the generic Project Knowledge Platform (`src/features/forever-project-knowledge`). This chain is proven end to end on two real projects and is exposed only through internal, `noindex` inspection routes (`/internal/coralina`, `/internal/projects/$slug`); it has no persistence layer and is not wired into any public route, the database, or the Import Engine's execute mode. Architecture continues toward One Engine, Many Interfaces.

## Database Status

FDB-001 is complete as additive, backward-compatible Supabase migrations. Modeva has been imported and validated with 7 buildings, 289 units, and 289 unit price history rows. FDB-003 Import Engine v1 is approved after dry-run and real idempotency validation. The RC4.4–RC5.1 knowledge chain is separate from this database layer: it runs over committed repository artifacts and produces an in-memory canonical record and readiness report, not a Supabase write. Bridging that canonical record to persistence is future work (see `docs/CURRENT_STAGE.md`, "Next stage").

## Website Status

RC0 is safe for guided real-client testing. Remaining RC1 work includes compare completion, deeper mobile QA, loading states, and Project Detail story-flow refinement. The public website is unaffected by the RC4.4–RC5.1 chain; the only new surfaces are the internal, `noindex`, unlinked inspection routes used for architecture verification.

## AI Status

No AI implementation is active. Current intelligence logic is deterministic and explainable. The RC4.4–RC5.1 knowledge chain is likewise fully deterministic and rules-based, with no AI or LLM involvement.

## Test Suite Status

225 test files / 1,661 tests passing (`npx vitest run`), including the full RC4.4–RC5.1 suite and the pre-existing website, Intelligence, Passport, and Import Engine suites.

## Last Updated

2026-07-12
