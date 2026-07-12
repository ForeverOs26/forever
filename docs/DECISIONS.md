# Forever Decisions

Status: Canonical decision log
Last updated: 2026-07-12

## Purpose

This document records approved durable decisions that affect architecture, workflow, source-of-truth policy, or stage boundaries. It is intentionally brief. Full architecture remains in `docs/FOREVER_BLUEPRINT.md`.

## Decision format

Each decision should include:

- Date
- Decision
- Context
- Consequence
- Review trigger, if any

## Approved decisions

### 2026-07-11 — GitHub and Supabase source-of-truth boundary

- **Decision:** GitHub is the source of truth for code and version-controlled documentation. Supabase is the source of truth for structured operational data.
- **Context:** Documentation and implementation tasks must not rely on chat history as the only record of important project state.
- **Consequence:** Durable documentation changes are committed to GitHub. Structured project, lead, and operational records belong in Supabase when implemented through approved schema and workflow.
- **Review trigger:** Revisit if a future admin system changes how version-controlled documentation is edited or published.

### 2026-07-11 — Forever Blueprint remains the constitution

- **Decision:** `docs/FOREVER_BLUEPRINT.md` remains the main architectural and constitutional document.
- **Context:** Several architecture and status documents exist. Creating a competing constitution would increase ambiguity.
- **Consequence:** Supporting documents may summarize workflow, current stage, roadmap, backlog, or decisions, but they must not override the Blueprint.
- **Review trigger:** Revisit only through Architect Review.

### 2026-07-11 — One Finished Result operating model

- **Decision:** Work is organized around one finished, validated result at a time.
- **Context:** Roadmap items, future ideas, and active tasks were mixed across documents.
- **Consequence:** The active stage is tracked in `docs/CURRENT_STAGE.md`; future work is tracked in `docs/ROADMAP.md` or `docs/BACKLOG.md`.
- **Review trigger:** Revisit when the team introduces parallel delivery lanes.

### 2026-07-11 — Incremental Forever Factory automation

- **Decision:** Automation is introduced only when it accelerates the current stage or immediately reduces recurring manual work.
- **Context:** Future AI orchestration and automation ideas can distract from product delivery.
- **Consequence:** Automation ideas that are not needed now are recorded for later and do not block the current stage.
- **Review trigger:** Revisit when repetitive manual work becomes measurable and recurring.

### 2026-07-12 — RC4.4–RC5.1 documentation reconciliation and next-stage selection

- **Decision:** `docs/CURRENT_STAGE.md`, `docs/FOREVER_STATUS.md`, `docs/ROADMAP.md`, `docs/FOREVER_BLUEPRINT.md`, and `docs/FOREVER_BRAIN_V1.md` are updated to reflect the completed RC4.4–RC5.1 Project Knowledge Platform chain (source registry, extraction pipeline, canonical project database, cross-source validation, knowledge graph, readiness, and the generic engine proven on Coralina and Modeva). The next active stage is resolving Coralina's two remaining source-backed blockers (`developer`, `country`), not a new foundation, a third project, or public exposure.
- **Context:** RC4.4–RC5.1 shipped six commits of tested architecture (`docs/RC5_1_PROJECT_KNOWLEDGE_PLATFORM.md`'s own governance note flagged this) without the canonical stage/status/roadmap documents being updated, leaving them describing a pre-RC4.4 state. A third project cannot be onboarded through data only because `rainpalm` and `gardens-of-eden` have no committed source material; bridging the canonical record to persistence and exposing project knowledge publicly are both larger, riskier steps that are premature while both catalogued projects report a `blocked` readiness verdict.
- **Consequence:** Documentation now distinguishes architecture foundations (RC4.4–RC5.1, internal only) from internal inspection routes (`/internal/coralina`, `/internal/projects/$slug`, both `noindex`) from public product readiness (unchanged, still RC0/RC1). The recommended next stage is Coralina blocker resolution; persistence bridging (FOREVER_BRAIN RC6/RC7) and public exposure remain explicitly deferred until that resolves.
- **Review trigger:** Revisit once Coralina's `developer` and `country` facts are source-backed, or if a third project's source material is committed.

### 2026-07-12 — RC5.3 Coralina evidence audit: no fact added

- **Decision:** RC5.3 re-audited Coralina's `developer` and `country` blockers against every committed source artifact and added no fact for either — neither has sufficient committed evidence. The gap reasons in `src/features/coralina-knowledge/facts.ts` were extended with the exact source-acquisition requirement for each, and a standalone audit record was committed (`docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md`). No readiness rule, foundation, or engine code changed.
- **Context:** `docs/CURRENT_STAGE.md` framed this stage as resolving the two blockers. Re-checking `manifest.json`, `import-status.json`, `classification-log.json`, all six extracted JSON datasets, and every `source/*` folder (via `git ls-files`, the committed/tracked state — not the raw filesystem, since `.gitignore` deliberately excludes everything under `source/*/*` but `.gitkeep`, so a local working copy may legitimately hold real, uncommitted documents on disk) found no new committed document since RC5.0 and no dataset states either fact. Converting the branding evidence (`The Title`/`AssetWise`/`Rhom Bho`) or the location evidence (`Kamala`/`Phuket`) into a developer or country fact would be fabrication, which `docs/DATA_STANDARD.md` forbids.
- **Consequence:** Coralina's Project Knowledge Platform readiness standing remains `blocked` for the same two reasons. The unit-type dispute (`units.unitTypes`) remains unresolved, as before. This decision does not close the current stage; it records why it could not close this cycle.
- **Review trigger:** Revisit when a Coralina-specific document explicitly naming the developer or stating the country is committed under `forever-data/projects/coralina/source/`.

### 2026-07-11 — AI roles are separated

- **Decision:** ChatGPT acts as Chief Architect / Technical Director; Claude supports specifications, UX, copy, audits, isolated components, tests, and code drafts; Codex performs repository-aware implementation, validation, commits, and pull requests.
- **Context:** AI tools need clear boundaries so outputs do not conflict or bypass repository review.
- **Consequence:** Repository changes still flow through GitHub, validation, and Pull Requests.
- **Review trigger:** Revisit if tool capabilities or team responsibilities materially change.
