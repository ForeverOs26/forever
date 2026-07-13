# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-13

## Stage name

RC5.4 Coralina official-source intake validation and dry-run completion.

## Objective

Validate the newly source-verified Coralina developer and country facts through the existing RC4.4–RC5.1 foundation chain and Import Engine dry-run, while keeping execute mode and database writes disabled.

## RC5.4 official-source resolution (2026-07-13)

Official Rhom Bho Property corporate pages, official shareholder publications, and a Thailand SEC-hosted company filing resolve the two RC5.3 blockers. Canonical values are `Rhom Bho Property Public Company Limited` and `Thailand`; official project name is `The Title Coralina Kamala`. AssetWise is documented as an indirect major shareholder through 39 Estate, not the developer. Project Knowledge readiness is `ready`; Import Engine dry-run completes with 405 operations (1 project, 8 buildings, 198 units, 198 price-history rows) and zero writes. Execute mode remains disabled.

The Coralina selling-price tables do not print a currency. RC5.4 therefore applies `project_country_default_currency` v1.0.0: source-verified country `Thailand` yields `THB` with status `inferred_default` and medium confidence. Direct source currencies always override this default; conflicts remain unresolved. The execute layer no longer substitutes THB for null currency and persists the canonical decision and provenance in existing metadata JSON. No schema migration or database write was performed.

RC5.4 data preparation is complete. The first permanent Coralina import remains a separately approved checkpoint; execute mode has not been run and total database writes remain zero.

## RC5.3 evidence audit (2026-07-12)

RC5.3 re-audited both blockers against every committed Coralina artifact (manifest, import status, classification log, all six extracted JSON datasets, and every `source/*` folder). Finding: no new source document has been committed (git-tracked) since RC5.0 — `source/*` is `.gitignore`-excluded of everything but `.gitkeep`, checked via `git ls-files` rather than the raw filesystem, since a local working copy may legitimately hold real, uncommitted documents on disk — and no extracted dataset states either fact; both remain genuinely unresolved. Per the decision rule for "neither blocker has sufficient evidence," no fact was added or fabricated. The gap reasons in `src/features/coralina-knowledge/facts.ts` were extended with the exact source-acquisition requirement for each blocker, so `/internal/coralina` now shows precisely what evidence is still needed. Full audit: `docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md`. Readiness standing is unchanged: `blocked`.

## Why it matters now

RC4.4–RC5.1 completed the full intake foundation chain and proved it end to end on two real projects through the generic Project Knowledge Platform (`src/features/forever-project-knowledge`):

- Coralina (RC5.0, restated in RC5.1 and source-verified in RC5.4) has 19 project-level facts, a knowledge graph, and a `ready` readiness report after official evidence resolved `developer` and `country`.
- Modeva (RC5.1) has 18 facts built purely from committed repository artifacts (the FDB-001 seed migration, the FDB-002C reviewed price-list import, the FDB-003C real-run report) and is honestly `blocked` for a different reason: no developer package was ever committed under `forever-data/projects/modeva/`, so there is no brochure to satisfy the intake bar, even though Modeva is already live in the production database.

Both internal inspection routes (`/internal/coralina`, `/internal/projects/$slug`, both `noindex`/`nofollow` and not linked from the public site) render these findings today. RC5.4 resolves the evidence and deterministic preparation checkpoint; permanent persistence remains deferred.

## In scope

- Locate and register source-backed evidence for Coralina `developer` and `country` (a developer-branded document or a Coralina-specific statement; a country-identifying source).
- Update `forever-data/projects/coralina/manifest.json`, its `metadata_evidence`, and the extracted datasets accordingly.
- Re-run RC4.7 cross-source validation and RC4.9 readiness through the existing `forever-project-knowledge` chain so `/internal/coralina` reflects the resolved facts.
- Re-run Import Engine dry-run validation before any real import is proposed.
- Keep source materials under `forever-data/projects/{project_slug}/`.
- Preserve the existing website, Project Detail Engine, Intelligence, Passport, and database behavior.

## Out of scope

- Supabase schema changes unless a future approved task explicitly requires an additive migration.
- Real database import for Coralina before readiness blockers are resolved and dry-run validation passes.
- Onboarding a third project through data only: `rainpalm` and `gardens-of-eden` still have blank `database/projects/*/README.md` templates and no committed source package, so a knowledge definition for either would have to fabricate facts, which `docs/DATA_STANDARD.md` forbids.
- Bridging the canonical project record produced by the chain toward a persistence layer (the FOREVER_BRAIN RC6/RC7 track) — deferred until this stage closes; see "Next stage."
- Exposing project knowledge to the public product — outside this evidence-validation stage and still unsupported for Modeva's incomplete knowledge package.
- Website UI redesigns, route changes, component rewrites, or business-logic changes.
- New AI orchestration, agent automation, or AI-driven scoring.
- Tablet Booth Mode, CRM workflows, mobile app, PDF automation.
- Starting the next stage before this stage reaches its definition of done.

## Dependencies

- Canonical project data standards in `docs/DATA_STANDARD.md`.
- Current status facts in `docs/FOREVER_STATUS.md`.
- The completed RC4.4–RC5.1 foundation chain and `docs/RC5_1_PROJECT_KNOWLEDGE_PLATFORM.md`.
- Import Engine architecture and validation reports.
- Source material availability for Coralina.
- Architect approval before any scope expansion or database write.

## Active tasks

| Task                                                                                                              | Owner              | Stage   | Status                                    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------ | ------- | ----------------------------------------- |
| Resolve Coralina `developer` source-backed blocker.                                                               | Constantin / Codex | Current | Complete — verified from official sources |
| Resolve Coralina `country` source-backed blocker.                                                                 | Constantin / Codex | Current | Complete — verified from official sources |
| Re-state resolved facts through the `forever-project-knowledge` definition and re-run cross-validation/readiness. | Codex              | Current | Complete — readiness is `ready`           |
| Run Import Engine dry-run before any real import.                                                                 | Codex              | Current | Complete — 405 operations, zero writes    |
| Review whether documentation remains aligned after intake readiness changes.                                      | Architect / Codex  | Current | Ongoing                                   |

## Acceptance criteria

- Coralina required source-backed project facts are present or explicitly documented as blockers.
- The RC4.7 cross-source validation and RC4.9 readiness reports, as surfaced at `/internal/coralina`, clearly distinguish passed checks, warnings, and blockers.
- Import Engine dry-run is run before any real import attempt.
- No application code, UI, business logic, route, or database schema change is introduced by this stage unless separately approved.
- Current status, roadmap, and decisions are updated when a durable decision or stage change occurs.

## Definition of done

- Current blockers are either resolved with source-backed evidence or documented as still blocking.
- The active stage has a clear validation result and next recommendation.
- Architect has reviewed the stage outcome.
- If a real import is proposed, it is handled as a separate approved task with explicit database-write approval.
- The next stage is identified but not started inside this stage.

## Known blockers

- No Coralina readiness blocker remains. The two RC5.3 evidence gaps are resolved by the official sources registered in `forever-data/projects/coralina/evidence/rc5-4-evidence-review.json`.
- Modeva's knowledge package is blocked on a missing committed developer brochure; this is evidence for the platform's honesty posture, not an active task of this stage (Modeva is already live in the production database from its earlier FDB-002/FDB-003 import).

## Next stage

RC5.5 is the next separately approved checkpoint. It must address staging/local target guards, transaction-backed execution, rollback behavior, existing-record collision inspection, and repeat-import validation before any permanent Coralina write.

Do not start this stage until the current stage is reviewed and closed by the Architect.
