# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-12

## Stage name

Coralina source-backed intake completion, using the completed RC4.4–RC5.1 Project Knowledge Platform.

## Objective

Resolve the two remaining source-backed blockers for Coralina (`developer`, `country`) only when real committed Coralina source material supports it, using the existing RC4.4–RC5.1 foundation chain (source registry, extraction pipeline, canonical project database, cross-source validation, knowledge graph, readiness) and the Import Engine — without changing application code, database schema, public routes, UI components, business logic, or readiness rules.

## RC5.3 evidence audit (2026-07-12)

RC5.3 re-audited both blockers against every committed Coralina artifact (manifest, import status, classification log, all six extracted JSON datasets, and every `source/*` folder). Finding: no new source document has been committed (git-tracked) since RC5.0 — `source/*` is `.gitignore`-excluded of everything but `.gitkeep`, checked via `git ls-files` rather than the raw filesystem, since a local working copy may legitimately hold real, uncommitted documents on disk — and no extracted dataset states either fact; both remain genuinely unresolved. Per the decision rule for "neither blocker has sufficient evidence," no fact was added or fabricated. The gap reasons in `src/features/coralina-knowledge/facts.ts` were extended with the exact source-acquisition requirement for each blocker, so `/internal/coralina` now shows precisely what evidence is still needed. Full audit: `docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md`. Readiness standing is unchanged: `blocked`.

## Why it matters now

RC4.4–RC5.1 completed the full intake foundation chain and proved it end to end on two real projects through the generic Project Knowledge Platform (`src/features/forever-project-knowledge`):

- Coralina (RC5.0, restated as a definition in RC5.1; re-audited in RC5.3) has 17 project-level facts, a knowledge graph, and a readiness report that is `blocked` on exactly two real, source-backed gaps: `developer` and `country`.
- Modeva (RC5.1) has 18 facts built purely from committed repository artifacts (the FDB-001 seed migration, the FDB-002C reviewed price-list import, the FDB-003C real-run report) and is honestly `blocked` for a different reason: no developer package was ever committed under `forever-data/projects/modeva/`, so there is no brochure to satisfy the intake bar, even though Modeva is already live in the production database.

Both internal inspection routes (`/internal/coralina`, `/internal/projects/$slug`, both `noindex`/`nofollow` and not linked from the public site) render these findings today. The architecture is no longer the limiting factor for Coralina — real source evidence is. The highest-value next step is closing the one gap the chain was built to expose, not adding further architecture.

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
- Exposing project knowledge to the public product — premature while both catalogued projects report a `blocked` readiness verdict.
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

| Task                                                                         | Owner             | Stage   | Status                 |
| ----------------------------------------------------------------------------| ----------------- | ------- | ---------------------- |
| Resolve Coralina `developer` source-backed blocker.                         | Constantin        | Current | Blocked — RC5.3 audit found no new committed evidence |
| Resolve Coralina `country` source-backed blocker.                          | Constantin        | Current | Blocked — RC5.3 audit found no new committed evidence |
| Re-state resolved facts through the `forever-project-knowledge` definition and re-run cross-validation/readiness. | Codex | Current | Pending source updates |
| Run Import Engine dry-run before any real import.                          | Codex             | Current | Pending validation     |
| Review whether documentation remains aligned after intake readiness changes. | Architect / Codex | Current | Ongoing                |

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

- Coralina `developer` is blocked until source-backed evidence is available. RC5.3 re-audited and confirmed no new evidence exists in the committed repository (`docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md`).
- Coralina `country` is blocked until source-backed evidence is available. RC5.3 re-audited and confirmed no new evidence exists in the committed repository (`docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md`).
- Modeva's knowledge package is blocked on a missing committed developer brochure; this is evidence for the platform's honesty posture, not an active task of this stage (Modeva is already live in the production database from its earlier FDB-002/FDB-003 import).

## Next stage

Recommended: once Coralina's two blockers are resolved and its Import Engine dry-run passes, begin bridging the canonical project record the RC4.4–RC5.1 chain already produces toward a persistence layer (the FOREVER_BRAIN RC6/RC7 track), rather than adding a third foundation or a third project — no other project currently has committed source material to onboard, and exposing project knowledge to the public product is premature while both catalogued projects are blocked. This ordering, and the reasons a third project or public exposure are not yet viable, is recorded in `docs/RC5_1_PROJECT_KNOWLEDGE_PLATFORM.md`.

Do not start this stage until the current stage is reviewed and closed by the Architect.
