# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-11

## Stage name

Coralina source intake readiness and Import Engine v1 operationalization.

## Objective

Prepare the next verified project intake using the existing manifest, extraction, validation, and Import Engine pipeline without changing application code, database schema, public routes, UI components, or business logic.

## Why it matters now

Forever has a validated Modeva import path and an Import Engine v1 foundation. The next valuable result is to prove that the same source-backed workflow can prepare another project safely, while keeping incomplete source material blocked before any real import.

## In scope

- Resolve source-backed Coralina readiness blockers for required project facts.
- Keep source materials under `forever-data/projects/{project_slug}/`.
- Maintain manifest, import-status, extracted datasets, and validation reports.
- Use Import Engine dry-run validation before any real import.
- Keep Import Engine usage documented for future projects.
- Preserve the existing website, Project Detail Engine, Intelligence, Passport, and database behavior.

## Out of scope

- Supabase schema changes unless a future approved task explicitly requires an additive migration.
- Real database import for Coralina before readiness blockers are resolved and dry-run validation passes.
- Website UI redesigns, route changes, component rewrites, or business-logic changes.
- New AI orchestration, agent automation, or AI-driven scoring.
- Tablet Booth Mode, CRM workflows, mobile app, PDF automation, and Knowledge Engine implementation.
- Starting the next stage before this stage reaches its definition of done.

## Dependencies

- Canonical project data standards in `docs/DATA_STANDARD.md`.
- Current status facts in `docs/FOREVER_STATUS.md`.
- Import Engine architecture and validation reports.
- Source material availability for Coralina.
- Architect approval before any scope expansion or database write.

## Active tasks

| Task                                                                         | Owner             | Stage   | Status                 |
| ---------------------------------------------------------------------------- | ----------------- | ------- | ---------------------- |
| Resolve Coralina `developer` source-backed blocker.                          | Constantin        | Current | Active                 |
| Resolve Coralina `country` source-backed blocker.                            | Constantin        | Current | Active                 |
| Re-run package validation after blockers are resolved.                       | Codex             | Current | Pending source updates |
| Run Import Engine dry-run before any real import.                            | Codex             | Current | Pending validation     |
| Review whether documentation remains aligned after intake readiness changes. | Architect / Codex | Current | Ongoing                |

## Acceptance criteria

- Coralina required source-backed project facts are present or explicitly documented as blockers.
- Validation reports clearly distinguish passed checks, warnings, and blockers.
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

- Coralina `developer` is blocked until source-backed evidence is available.
- Coralina `country` is blocked until source-backed evidence is available.

## Next stage

RC1 architecture and product hardening: canonical media flow, Intelligence persistence strategy, overlap between display fields and normalized tables, Discovery Compare scope, loading and empty states, mobile QA, and Project Detail story-flow refinement.

Do not start this stage until the current stage is reviewed and closed by the Architect.
