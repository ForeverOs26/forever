# Forever Decisions

Status: Canonical decision log
Last updated: 2026-07-15

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

### 2026-07-15 — Close RC5.5B as locally proven and authorize RC5.5C transaction preparation only

- **Decision:** With RC5.5B merged and the Owner's local read-only proving run completed — Coralina reported as 405 `absent` operations against the reconciled canonical local target with zero collisions, duplicates, identity conflicts, or inspection errors — the Owner / Architect closes RC5.5B as Completed and authorizes RC5.5C as a preparation-only slice: a transaction-capable execution abstraction, an Owner execution-approval artifact contract (explicit scope, short-lived, single-use, fail-closed), deterministic transaction ordering, in-transaction verification against the shared persistence projections, automatic rollback with sanitized reason codes, a typed deterministic execution receipt, an explicit `--execute-approved-import` CLI mode, hermetic tests, and canonical documentation.
- **Context:** Before the first permanent Coralina import can be considered, the repository needs the full execution safety chain implemented and proven hermetically: atomicity, verification-before-commit, fail-closed authorization, single-use approvals, and a strict repeat-execution boundary — all without touching a real database.
- **Consequence:** The live transaction runner is structurally defined but fails closed (`live_execution_disabled`) before reading any credential or creating any client; no migration runs; no real import occurs; real database writes remain zero. Execution requires an explicit request plus fresh preflight, a fresh unblocked all-`absent` collision report, and a valid scope-bound single-use Owner approval; any non-fresh target state fails closed, and in-transaction state drift rolls back. Production stays blocked unconditionally; staging stays unconfigured; dry-run and collision inspection are unchanged; Factory autonomy remains A0 — Propose only. The first real Coralina import remains a separate Owner checkpoint requiring live-adapter enablement with an isolated explicit credential boundary and a real approval artifact.
- **Review trigger:** Owner / Architect review of the RC5.5C preparation slice, followed by a separate decision before live-adapter enablement, the first permanent Coralina write, staging rehearsal, or any repeat-import contract.

### 2026-07-15 — Authorize RC5.5B read-only collision inspection and hermetic validation only

- **Decision:** With RC5.5A completed and merged, the Owner / Architect authorizes RC5.5B. Implementation authority is limited to a read-only target collision-inspection boundary: a narrow, select-only `CollisionInspectionReader` interface, an optional minimal read-only Supabase adapter, a deterministic collision inspector and `CollisionInspectionReport`, an explicit `--inspect-collisions` CLI/importer mode, hermetic tests, and canonical documentation.
- **Context:** RC5.5A produces a stable plan fingerprint and a fail-closed, non-networked target preflight, but the repository still cannot see how the approved plan relates to existing target rows. A read-only inspection that classifies each planned operation against the target — without any write — is the safe next boundary before transactional execution can be considered.
- **Consequence:** RC5.5B creates no Supabase client during dry-run, issues only bounded select queries, and never inserts, upserts, updates, deletes, runs a mutation RPC, changes schema, runs a transaction or rollback, or enables execute mode. Every report states `readOnlyConfirmed: true`, `executeEnabled: false`, and `writesPerformed: 0`; `update_required` findings never authorize the update. Production stays blocked unconditionally; staging stays unconfigured; local requires the committed `forever-local` identity. This packet does not authorize supplying or reading real credentials in the Claude Web environment or running a real database inspection from Claude Web — a real local read-only proving run is a separate Owner checkpoint after RC5.5B is reviewed and merged. RC5.5C migration/transactional execution remains separately gated, and the first permanent Coralina write remains a later Owner checkpoint.
- **Review trigger:** Owner / Architect review of the RC5.5B change, followed by a separate decision before the real local proving run, RC5.5C, staging rehearsal, or any permanent database write.

### 2026-07-13 — Close RC5.4 and authorize RC5.5A without database access

- **Decision:** The Owner / Architect closes RC5.4 as Completed and authorizes RC5.5. Current implementation authority is limited to RC5.5A deterministic plan fingerprinting, explicit target modelling, pure fail-closed preflight guards, a non-persistent dry-run receipt, minimal CLI/importer integration, tests, and canonical documentation.
- **Context:** Coralina's official-source intake is resolved and its validated dry-run contains 405 operations. Before any target inspection or write can be considered, the repository needs a stable representation of write intent and an explicit fail-closed target boundary.
- **Consequence:** RC5.5A creates no Supabase client, reads no service-role key, makes no network or database request, and keeps execute mode disabled even after successful preflight. Production is blocked unconditionally; staging is blocked until an approved non-secret identity is separately configured; local requires its committed local-only identity. RC5.5B read-only collision inspection and RC5.5C migration/transactional execution each require separate approval. Staging rehearsal and the first permanent write remain later Owner checkpoints. Factory remains A0 and does not block product work.
- **Review trigger:** Owner / Architect review of the RC5.5A draft PR, followed by a separate decision before RC5.5B, RC5.5C, staging rehearsal, or any permanent database write.

### 2026-07-13 — Ratify Forever Factory Constitution RC1

- **Decision:** Ratify `docs/FOREVER_FACTORY_CONSTITUTION.md` as Forever Factory Constitution RC1.
- **Owner:** Constantin.
- **Core architecture:** Constitution → Ledger → Dispatcher → Workshop → Gates → Integration.
- **Key decisions:**
  - No persistent autonomous Supervisor agent is authorized. “Forever Supervisor” may remain the user-facing name for the complete management function.
  - Durable Factory state lives in Git. The Dispatcher is stateless and proposal-only.
  - Operator executes repository mechanics and deterministic validation but never owns architecture or priority.
  - Routing uses the maximum of risk floor, ambiguity floor, evidence sensitivity, and gate blindness. Role names remain separate from replaceable model mappings.
  - The current mapping is Claude Sonnet 5.0 for drafting/mechanical work, Claude Opus 4.8 as the default engineering tier, Codex for repository integration, Git, validation, Factory tooling, and repository-wide work, and Claude Fable 5.0 as a limited strategic-judgment resource.
  - Autonomy begins at A0 — Propose only. R2 and R3 always remain human-in-the-loop.
  - Product development remains higher priority than Factory infrastructure. Browser automation and Night Shift remain deferred until measured bottlenecks justify them.
- **Context:** Reduce Owner mechanics while preserving human ownership of strategy, evidence, money, legal matters, production effects, and constitutional authority.
- **Implementation note:** RC5.4 merged before Factory RC1. Its evidence resolved the original OQ-001/OQ-002 before Factory activation. Until an approved GitHub CI workflow is active, bootstrap uses local validation, manual diff review, and Owner merge authorization; planned gates are not treated as passed.
- **Consequence:** Operator v0.1 is implemented in the Factory RC1 branch and its deterministic local checks become active after merge and local setup. The next operating phase is the Paper Factory at A0. “Continue Forever” is the common entry protocol but is not yet fully autonomous.
- **Review trigger:** Any constitutional amendment; any proposed autonomy promotion; the quarterly model-mapping review; or evidence that Factory overhead is not improving product throughput or safety.

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
