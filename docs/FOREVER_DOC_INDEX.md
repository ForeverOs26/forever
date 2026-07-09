# Forever Documentation Index

Task ID: FF-004

Status: Canonical documentation index

## Purpose

This index defines the canonical documentation paths that Codex tasks should use before working in the Forever repository. It exists to prevent path drift and duplicate document names from causing future tasks to miss required context.

## Required Pre-Task Reading

Every Codex task must read these documents first:

1. `docs/FOREVER_DOC_INDEX.md`
2. `docs/CODEX_OPERATING_MANUAL.md`
3. `docs/FOREVER_STATUS.md`
4. `docs/ROADMAP.md`
5. `docs/DATA_STANDARD.md`

If a task involves project understanding, architecture, intelligence, Passport, Import Engine direction, or source-backed data policy, Codex must also read:

6. `docs/CODEX_PROJECT_UNDERSTANDING.md`

If any required document is missing at the exact path, Codex must report the missing path before proceeding.

## Canonical Documentation Paths

| Path                                  | Purpose                                                                                                                                                                               | Required first read |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `docs/FOREVER_DOC_INDEX.md`           | Canonical index for documentation paths, duplicate names, and new-doc rules.                                                                                                          | Yes                 |
| `docs/CODEX_OPERATING_MANUAL.md`      | Operating rules for Codex work in Forever, including scope, quality, git, data, and communication rules.                                                                              | Yes                 |
| `docs/FOREVER_STATUS.md`              | Current repository, product, database, website, and milestone status. This is the source of truth for current state.                                                                  | Yes                 |
| `docs/ROADMAP.md`                     | Forward-looking development phases, upcoming work, and future milestones.                                                                                                             | Yes                 |
| `docs/DATA_STANDARD.md`               | Canonical data, import, validation, Intelligence, and Passport standards.                                                                                                             | Yes                 |
| `docs/CODEX_PROJECT_UNDERSTANDING.md` | Canonical project understanding, architecture summary, current milestone context, risks, and recommendations.                                                                         | Conditional         |
| `docs/IMPORT_ENGINE_ARCHITECTURE.md`  | Import Engine architecture, folder structure, interfaces, pipeline, validation, rollback, and state machine.                                                                          | Conditional         |
| `docs/IMPORT_ENGINE_QA_AUDIT.md`      | RC3-006 QA audit of the Import Engine after RC3-005, including dry-run results, warnings, blockers, risks, and next-stage recommendation.                                             | No                  |
| `docs/FOREVER_DEVELOPMENT_ROADMAP.md` | Compatibility pointer for tasks that request this historical path. The canonical roadmap is `docs/ROADMAP.md`.                                                                        | No                  |
| `docs/KNOWLEDGE_MODEL.md`             | Compatibility pointer for tasks that request this historical path. The canonical knowledge and data model docs are `docs/DATA_STANDARD.md` and `docs/CODEX_PROJECT_UNDERSTANDING.md`. | No                  |

## Deprecated or Duplicate Documentation Names

| Deprecated or duplicate name          | Canonical replacement                                             | Rule                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/FOREVER_DEVELOPMENT_ROADMAP.md` | `docs/ROADMAP.md`                                                 | Keep only as a compatibility pointer unless a future task explicitly redefines it. Do not duplicate roadmap content here.                        |
| `docs/KNOWLEDGE_MODEL.md`             | `docs/DATA_STANDARD.md` and `docs/CODEX_PROJECT_UNDERSTANDING.md` | Keep only as a compatibility pointer unless a future task explicitly creates a full knowledge model. Do not duplicate canonical data rules here. |

## Rules for Adding New Docs

- Add a new document only when it has a clear owner and purpose that is not already covered by an existing canonical document.
- Prefer updating a canonical document over creating a duplicate status, roadmap, architecture, or data-standard document.
- When adding a new durable document, update this index in the same change.
- Keep `docs/FOREVER_STATUS.md` focused on current truth, not historical logs.
- Keep `docs/ROADMAP.md` focused on future phases and milestones.
- Keep validation reports and import run logs factual and immutable, with supersession notes when a later run changes readiness.
- Do not create compatibility documents by copying full canonical content. Use short pointers to the canonical path.
