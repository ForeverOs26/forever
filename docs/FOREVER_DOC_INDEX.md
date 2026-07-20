# Forever Documentation Index

Task ID: FF-004

Status: Canonical documentation index

## Purpose

This index defines the canonical documentation paths that Codex tasks should use before working in the Forever repository. It exists to prevent path drift and duplicate document names from causing future tasks to miss required context.

## Required Pre-Task Reading

Every Codex task must read these documents first:

1. `docs/FOREVER_DOC_INDEX.md`
2. `docs/factory/FOREVER_FACTORY_INDEX.md`
3. `docs/CODEX_OPERATING_MANUAL.md`
4. `docs/FOREVER_BLUEPRINT.md`
5. `docs/CURRENT_STAGE.md`
6. `docs/FOREVER_STATUS.md`
7. `docs/ROADMAP.md`
8. `docs/DATA_STANDARD.md`

For every Factory-governed task, also read the approved Task Packet and the relevant routing and gate sections. Read the complete `docs/FOREVER_FACTORY_CONSTITUTION.md` when the task involves Factory architecture, routing policy, autonomy, security, R2 or R3 work, shared contracts, constitutional interpretation, external side effects, production access, browser automation, or legal, financial, or privileged actions. For an isolated ordinary product task, the Factory Index and relevant task-specific documents are sufficient unless the Task Packet requires the complete Constitution.

If a task involves project understanding, architecture, intelligence, Passport, Import Engine direction, or source-backed data policy, Codex must also read:

6. `docs/CODEX_PROJECT_UNDERSTANDING.md`

If any required document is missing at the exact path, Codex must report the missing path before proceeding.

## Canonical Documentation Paths

| Path                                             | Purpose                                                                                                                                                                                                                                           | Required first read |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `docs/FOREVER_DOC_INDEX.md`                      | Canonical index for documentation paths, duplicate names, and new-doc rules.                                                                                                                                                                      | Yes                 |
| `docs/factory/FOREVER_FACTORY_INDEX.md`          | Cold-clone start point for Forever Factory authority, state, routing, gates, Task Packets, recovery, and A0 operation.                                                                                                                            | Yes                 |
| `docs/CODEX_OPERATING_MANUAL.md`                 | Operating rules for Codex work in Forever, including scope, quality, git, data, and communication rules.                                                                                                                                          | Yes                 |
| `docs/FOREVER_BLUEPRINT.md`                      | Main constitutional and architectural document for Forever.                                                                                                                                                                                       | Yes                 |
| `docs/FOREVER_FACTORY_CONSTITUTION.md`           | Ratified development-system Constitution; full reading is required for Factory architecture, policy, autonomy, security, R2/R3, shared-contract, constitutional, external, production, browser, legal, financial, or privileged work.             | Conditional         |
| `docs/CURRENT_STAGE.md`                          | Canonical active-stage document: objective, scope, owners, acceptance criteria, definition of done, blockers, and next stage.                                                                                                                     | Yes                 |
| `docs/FOREVER_STATUS.md`                         | Current repository, product, database, website, and milestone status. Active-stage execution details belong in `docs/CURRENT_STAGE.md`.                                                                                                           | Yes                 |
| `docs/ROADMAP.md`                                | Forward-looking development phases, dependencies, sequencing, and future milestones.                                                                                                                                                              | Yes                 |
| `docs/PARTNER_DEMO_V1.md`                        | Canonical Partner Demo v1 presentation runbook: objective, persona, timed script, routes, safe no-write lead demo mode, fallbacks, checklist, shutdown, and honest limitations.                                                                   | Conditional         |
| `docs/FAST_INTAKE_PILOT_01_RAINPALM.md`          | Immutable measured record for the Rainpalm Villas Fast Intake v1 structured-input pilot: source integrity, timings, generated draft, validation, warnings, limitations, and next checkpoint.                                                      | Conditional         |
| `docs/STRUCTURED_INPUT_PREPARATION_DESIGN_V1.md` | Approved canonical Structured Input Preparation Design v1: evidence-backed boundary, unchanged input/output contracts, SIP-001 scope, review policy, anti-fabrication controls, pilot prerequisite, acceptance criteria, and SIP-001A checkpoint. | Conditional         |
| `docs/SIP_001A_IMPLEMENTATION_REPORT.md`         | Canonical SIP-001A implementation and independent-audit record: hardened local text-PDF extraction, real Windows Rainpalm execution, deterministic artifacts, oracle metrics, and unchanged Fast Intake compatibility.                            | Conditional         |
| `docs/AI_WORKFLOW.md`                            | Canonical ChatGPT, Claude, Codex, and development pipeline rules.                                                                                                                                                                                 | Conditional         |
| `docs/DECISIONS.md`                              | Short log of approved durable architecture, workflow, source-of-truth, and stage-boundary decisions.                                                                                                                                              | Conditional         |
| `docs/BACKLOG.md`                                | Future tasks and ideas that are not active current-stage scope.                                                                                                                                                                                   | Conditional         |
| `docs/DATA_STANDARD.md`                          | Canonical data, import, validation, Intelligence, and Passport standards.                                                                                                                                                                         | Yes                 |
| `docs/CODEX_PROJECT_UNDERSTANDING.md`            | Canonical project understanding, architecture summary, current milestone context, risks, and recommendations.                                                                                                                                     | Conditional         |
| `docs/FOREVER_BRAIN_V1.md`                       | Official top-level architecture specification for the Forever platform, including engine boundaries, source-to-interface flow, single-source-of-truth rules, and RC4-RC8 evolution.                                                               | Conditional         |
| `docs/factory/OWNER_QUEUE.md`                    | Evidence-backed queue of actions that only the Owner may resolve.                                                                                                                                                                                 | Conditional         |
| `docs/factory/TASK_PACKET_TEMPLATE.md`           | Canonical atomic-work template for one finished result, branch, and PR.                                                                                                                                                                           | Conditional         |
| `docs/factory/FACTORY_ROUTING_POLICY.md`         | Operational role tiers, current model mapping, routing floors, separation, and escalation.                                                                                                                                                        | Conditional         |
| `docs/factory/FACTORY_GATE_PROFILES.md`          | R0–R3 gate requirements, distinguishing active Operator controls from planned/manual controls.                                                                                                                                                    | Conditional         |
| `docs/factory/CONTINUE_FOREVER_PROTOCOL.md`      | Exact A0 meaning of “Continue Forever” / “Продолжай Forever”.                                                                                                                                                                                     | Conditional         |
| `docs/FOREVER_OPERATOR_V0_1.md`                  | Operator v0.1 architecture, safety boundaries, validation evidence, limitations, and prerequisites.                                                                                                                                               | Conditional         |
| `docs/IMPORT_ENGINE_ARCHITECTURE.md`             | Import Engine architecture, folder structure, interfaces, pipeline, validation, rollback, and state machine.                                                                                                                                      | Conditional         |
| `docs/IMPORT_ENGINE_QA_AUDIT.md`                 | RC3-006 QA audit of the Import Engine after RC3-005, including dry-run results, warnings, blockers, risks, and next-stage recommendation.                                                                                                         | No                  |
| `docs/RC5_1_PROJECT_KNOWLEDGE_PLATFORM.md`       | RC5.1 architectural report: the project-agnostic Project Knowledge engine over the RC4.4–RC4.9 foundation chain, the Coralina re-statement, and the Modeva onboarding.                                                                            | No                  |
| `docs/FOREVER_DEVELOPMENT_ROADMAP.md`            | Compatibility pointer for tasks that request this historical path. The canonical roadmap is `docs/ROADMAP.md`.                                                                                                                                    | No                  |
| `docs/KNOWLEDGE_MODEL.md`                        | Compatibility pointer for tasks that request this historical path. The canonical knowledge and data model docs are `docs/DATA_STANDARD.md` and `docs/CODEX_PROJECT_UNDERSTANDING.md`.                                                             | No                  |

## Deprecated or Duplicate Documentation Names

| Deprecated or duplicate name          | Canonical replacement                                             | Rule                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/FOREVER_DEVELOPMENT_ROADMAP.md` | `docs/ROADMAP.md`                                                 | Keep only as a compatibility pointer unless a future task explicitly redefines it. Do not duplicate roadmap content here.                        |
| `docs/KNOWLEDGE_MODEL.md`             | `docs/DATA_STANDARD.md` and `docs/CODEX_PROJECT_UNDERSTANDING.md` | Keep only as a compatibility pointer unless a future task explicitly creates a full knowledge model. Do not duplicate canonical data rules here. |
| `docs/PROJECT_STATUS.md`              | `docs/CURRENT_STAGE.md` and `docs/FOREVER_STATUS.md`              | Historical Navigator-era status. Do not use as the current-stage source of truth.                                                                |

## Rules for Adding New Docs

- Add a new document only when it has a clear owner and purpose that is not already covered by an existing canonical document.
- Prefer updating a canonical document over creating a duplicate status, roadmap, architecture, or data-standard document.
- When adding a new durable document, update this index in the same change.
- Keep `docs/FOREVER_BLUEPRINT.md` as the product architecture and constitutional source of truth; `docs/FOREVER_FACTORY_CONSTITUTION.md` separately governs the development system.
- Keep `docs/CURRENT_STAGE.md` focused on the active stage only.
- Keep `docs/FOREVER_STATUS.md` focused on current factual status, not historical logs or task-board detail.
- Keep `docs/ROADMAP.md` focused on sequenced future phases and milestones.
- Keep `docs/BACKLOG.md` focused on non-current future tasks and ideas.
- Record durable approved decisions in `docs/DECISIONS.md`.
- Keep validation reports and import run logs factual and immutable, with supersession notes when a later run changes readiness.
- Do not create compatibility documents by copying full canonical content. Use short pointers to the canonical path.
