# Forever Status

## Document role

This document records current repository, product, database, website, and milestone status. The canonical active-stage plan, owners, acceptance criteria, and definition of done are maintained in `docs/CURRENT_STAGE.md`.

## Factory Activation

Forever Factory Constitution RC1 is active at A0 — Propose only. Operator v0.1 has completed its first isolated proving cycle: documentation-only `validate-only` reached `validated`, and the separate `dry-run` reached `dry-run-complete`. Security, TypeScript, product tests, lint, build, and Git diff gates passed while the primary `main` worktree remained unchanged. No commit, push, pull request, merge, autonomy promotion, Night Shift, browser automation, or automatic model invocation occurred. The Factory foundation is proven for bounded A0 use; Forever product development remains the primary priority, and future Factory improvements are bounded backlog work that must not delay product delivery.

A deterministic model-routing library (`src/factory/`) now implements the ratified routing policy as a first step from A0 toward A1: it maps approved Task Packet classification metadata to the Sonnet/Opus/Fable worker tiers **and to a reasoning-effort level** (`low`/`medium`/`high`/`xhigh`/`max`), enforces the bounded-retry and one-tier escalation rules, double-gates Fable behind explicit Owner authorization plus declared budget, never selects `max` effort without an explicit Owner authorization record, only emits `xhigh` with a recorded justification, and emits a handoff artifact carrying the selected model, effort, and reasons whose embedded task matches the existing Operator v0.1 contract exactly (hermetically proven against `.forever-factory/task.schema.json`; the Operator contract is unchanged, effort lives only in the outer artifact). It is decision support only: it invokes no model, autonomy remains A0, and no Operator behavior changed. See `docs/factory/FACTORY_ROUTING_POLICY.md` and `docs/factory/tasks/FACTORY-A1-001.md`.

A deterministic Execution Connector (`src/factory/execution-connector/`, FACTORY-A1-002) now automates the transport and execution mechanics on top of that router: it accepts one approved Task Packet, uses the exact router decision, runs the selected Claude Code execution through a supported adapter (a hermetic fake for tests, or the officially supported `claude --print` interface, confirmed available with model/effort/JSON-output/permission controls and host-managed authentication), captures the result in a deterministic artifact, and converts a successful execution into the unchanged Operator v0.1 handoff. It passes the exact selected model and effort to the adapter, fails closed on unsupported model or effort and on every Fable/max stop state, prevents duplicate execution through deterministic run identity, redacts secrets and never surfaces the provider session id, and keeps automatic merge impossible. It invokes no project priorities and never selects the next task; autonomy remains A0 and the Operator remains the mechanical integration authority. Hermetic end-to-end tests pass and one documentation-only live smoke proved the real interface. See `docs/factory/tasks/FACTORY-A1-002.md`.

A deterministic Continue Forever command (`src/factory/continue-forever/`, FACTORY-A1-003) now chains the router and connector into one owner-invocable command, `npm run factory:continue`. It resolves exactly one already-approved current Task Packet from its canonical source `.forever-factory/CONTINUE_TASK.json` — an explicitly distinct file from the Operator canonical `.forever-factory/CURRENT_TASK.json`, reconciled by Task Packet id so the two can never silently disagree (`CURRENT_TASK_STATE_CONFLICT` otherwise) — fails closed unless a single executable current task exists (coded stops for no/unapproved/multiple/superseded/completed/running/invalid current tasks), routes it through the unchanged FACTORY-A1-001 router, executes it through the unchanged FACTORY-A1-002 connector with the exact selected model and effort, prepares the unchanged Operator-compatible handoff, and produces one owner-visible final report before stopping. It runs the **real** Claude Code adapter by default; `--fake` selects the hermetic TEST_ONLY adapter (never the silent default; its reports are stamped `HERMETIC_TEST`), and there is no automatic live-to-fake fallback. Binary availability and authentication are distinct: the preflight verifies only that the binary is resolvable, and a launch or recognized auth/login failure at runtime maps to `LIVE_EXECUTION_UNAVAILABLE` rather than simulating success. The Operator canonical state is reconciled strictly (`CURRENT_TASK_STATE_CONFLICT` / `CURRENT_TASK_STATE_INVALID`, never a silent skip). Duplicate execution is prevented by an **atomic cross-process lock** (a per-run lock directory created atomically; terminal state written via temp-file + rename), proven by a real two-process concurrency test to yield exactly one execution and one already-running; elapsed time never authorizes a duplicate, and a running claim of uncertain ownership parks with `STALE_RUN_REQUIRES_OWNER_RECOVERY` pending explicit Owner recovery. A completed run replays, a failed run re-runs only on explicit retry, and a corrupt durable lock fails closed (`CORRUPT_RUN_STATE`, parked, never auto-repaired). Publishing is never inferred from the command name (`OWNER_APPROVAL_REQUIRED` otherwise), automatic merge stays structurally impossible, and no next Task Packet is ever started. Autonomy remains A0; the user-facing workflow is complete only once a real approved Task Packet has passed through the live command. See `docs/factory/tasks/FACTORY-A1-003.md`.

## Current Milestone

RC5.5 Coralina safe execution, currently bounded to RC5.5A Target and Preflight Guards. RC5.4 is closed as Completed. See `docs/CURRENT_STAGE.md`.

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
- RC5.3 Coralina Evidence Audit: correctly found no sufficient committed local evidence and preserved both blockers.
- RC5.4 Coralina Official-Source Evidence: official Rhom Bho Property corporate history, corporate disclosures, and a Thailand SEC-hosted filing verify `Rhom Bho Property Public Company Limited`, `The Title Coralina Kamala`, and `Kamala, Phuket, Thailand`; official shareholder materials define AssetWise as an indirect major shareholder. Knowledge readiness is `ready`, and the Import Engine dry-run plans 405 operations with zero writes.
- RC5.4 currency completion: Coralina's 198 selling prices use `THB` as a transparent `inferred_default` from source-verified country Thailand under rule `project_country_default_currency` v1.0.0. This is not direct price-list verification. Explicit currencies override defaults, conflicts remain unresolved, and execute-time null-to-THB coercion has been removed.
- RC5.4 data preparation is complete with zero database writes. Execute mode has not run; the first permanent Coralina import is a separate approval checkpoint.

## Active Tasks

See `docs/CURRENT_STAGE.md` for the canonical active-task table, owners, scope boundaries, acceptance criteria, and definition of done.

Current factual task summary:

- Review RC5.5A deterministic plan hashing and pure fail-closed target preflight.
- Keep production blocked, staging unconfigured, local identity explicit, and execute mode disabled.
- Preserve zero database access and zero writes; RC5.5B collision inspection remains a separate read-only slice.

## Blockers

- No current Modeva database-import blocker (Modeva has been live in the production database since FDB-003C).
- Coralina has no knowledge-readiness blocker: RC5.4 resolved `developer` and `country` from official sources and produced a successful 405-operation dry-run. RC5.5A does not authorize database access; execute mode remains disabled.
- Modeva's Project Knowledge Platform readiness report is separately `blocked`: no developer package (brochure) was ever committed under `forever-data/projects/modeva/`, so its committed knowledge package cannot pass the intake bar even though the project itself is live.
- Future project imports and knowledge onboarding require source materials to be placed under `forever-data/projects/{project_slug}/`; `rainpalm` and `gardens-of-eden` currently have only blank `database/projects/*/README.md` templates and no committed source package.

## Next Milestone

Within RC5.5, RC5.5B is the next separately approved read-only collision-inspection slice. RC5.5C migration and transactional execution require another separate approval. Staging rehearsal and the first permanent Coralina write remain later explicit Owner checkpoints.

## Architecture Status

The website continues to use a reusable Project Detail Engine, Forever Passport layer, deterministic Forever Intelligence module, and a reusable Import Engine for source-driven project ingestion, as before. Alongside that public-facing stack, RC4.4–RC5.1 completed a separate, tested, architecture-only intake foundation chain — source registry, extraction pipeline, canonical project database, cross-source validation, knowledge graph, and readiness — culminating in the generic Project Knowledge Platform (`src/features/forever-project-knowledge`). This chain is proven end to end on two real projects and is exposed only through internal, `noindex` inspection routes (`/internal/coralina`, `/internal/projects/$slug`); it has no persistence layer and is not wired into any public route, the database, or the Import Engine's execute mode. Architecture continues toward One Engine, Many Interfaces.

## Database Status

FDB-001 is complete as additive, backward-compatible Supabase migrations. Modeva has been imported and validated with 7 buildings, 289 units, and 289 unit price history rows. FDB-003 Import Engine v1 is approved after dry-run and real idempotency validation. RC5.5A adds only in-memory fingerprint and preflight controls: it creates no Supabase client, reads no service-role key, performs no database query or write, and changes no schema. Permanent Coralina writes remain disabled.

## Website Status

RC0 is safe for guided real-client testing. Remaining RC1 work includes compare completion, deeper mobile QA, loading states, and Project Detail story-flow refinement. The public website is unaffected by the RC4.4–RC5.1 chain; the only new surfaces are the internal, `noindex`, unlinked inspection routes used for architecture verification.

## AI Status

No AI implementation is active. Current intelligence logic is deterministic and explainable. The RC4.4–RC5.1 knowledge chain is likewise fully deterministic and rules-based, with no AI or LLM involvement.

## Test Suite Status

232 test files / 1,746 tests (`npx vitest run`), including the 2 Factory router test files / 48 tests (model tier and effort routing) and the full pre-existing website, Intelligence, Passport, Coralina, Modeva, and Import Engine regressions. Known environment dependency: the 3 RC5.5A importer integration tests in `src/import/importer-preflight.test.ts` require the Coralina brochure and price-list documents under `forever-data/projects/coralina/source/*/*`, which are deliberately gitignored; in a fresh clone without those local documents they fail with `required_files_missing` (readiness honestly reports `blocked`). They were recorded passing on 2026-07-13 on a working copy holding the local source documents. All other tests pass in a fresh clone.

## Last Updated

2026-07-14
