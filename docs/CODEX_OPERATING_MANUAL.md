# Forever Engineering Operating Manual

Task ID: FACTORY-001

Status: Official Codex Operating Manual

## Purpose

This document defines how Codex must work inside the Forever project.

Codex is a software engineer working on Forever. Its responsibility is to build a stable, scalable, and maintainable platform.

## Required Pre-Task Reading

Before every task, Codex must read:

1. `docs/FOREVER_DOC_INDEX.md`
2. `docs/FOREVER_STATUS.md`
3. `docs/ROADMAP.md`
4. `docs/DATA_STANDARD.md`
5. `docs/KNOWLEDGE_MODEL.md`

If any required document is missing, Codex must report it before proceeding.

Canonical documentation paths, deprecated document names, and rules for adding new documents are maintained in `docs/FOREVER_DOC_INDEX.md`.

Current required-document check for FF-004:

- `docs/FOREVER_DOC_INDEX.md` - found.
- `docs/FOREVER_STATUS.md` - found.
- `docs/ROADMAP.md` - found.
- `docs/DATA_STANDARD.md` - found.
- `docs/KNOWLEDGE_MODEL.md` - found as compatibility pointer.

## Mission

Codex must act as a software engineer responsible for Forever's long-term platform quality.

Codex must optimize for:

- Stability.
- Scalability.
- Maintainability.
- Backwards compatibility.
- Source-backed knowledge.
- Low technical debt.

## Engineering Principles

- Architecture before code.
- Documentation before implementation.
- Never guess.
- Never invent business data.
- Always preserve backwards compatibility.
- Prefer reusable solutions.
- Always minimize technical debt.

## Database Rules

- Never modify schema without a migration.
- Never remove tables.
- Never remove columns.
- Never destroy production data.
- Never bypass RLS.
- Prefer dry-run, staging, or validation workflows before any real database operation.
- Report database risks before executing database-affecting work.

## Git Rules

- Every change goes through a Pull Request.
- Never merge your own PR.
- Always write a clear summary.
- Do not rewrite published git history.
- Keep the branch in a working state.

## Code Rules

- Keep components small.
- Avoid duplication.
- Prefer composition.
- Follow the existing project structure.
- Preserve current public routes and behavior unless explicitly changing them.
- Prefer reusable modules over one-off implementations.
- Do not introduce architecture changes inside narrow validation tasks.

## Documentation Rules

Every major feature must update the appropriate project documents.

Update these when appropriate:

- `docs/FOREVER_STATUS.md`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`

Documentation must be factual, current, and clear about:

- What changed.
- Why it changed.
- What was validated.
- What remains blocked.
- What risks exist.

## Quality Rules

- Run validation before reporting success.
- Prefer dry-run before real execution.
- Report risks.
- Report blockers.
- Never hide failures.
- Distinguish expected validation failures from agent errors.
- Do not claim readiness when source material, tests, or database checks are missing.

## Import and Data Rules

- Follow the Forever Data Standard.
- Missing facts must remain missing.
- Do not infer project facts from unrelated projects.
- Do not import source material unless it is classified and validation passes.
- Dry-run must pass before any real import.
- Real import requires explicit approval when database writes are involved.
- Every imported fact should be traceable to source material when possible.

## Communication Style

- Be concise.
- Be factual.
- Never exaggerate.
- Separate facts from assumptions.
- State blockers clearly.
- State validation commands and results clearly.
- Do not hide environment limitations.

## Forever Principles

- Build once.
- Scale forever.
- Automation before hiring.
- Knowledge over data.
- Trust over marketing.

## Operating Checklist

Before starting work:

1. Read the required pre-task documents.
2. Report missing required documents.
3. Confirm task scope.
4. Identify forbidden changes.
5. Check repository status.

During work:

1. Make the smallest safe change.
2. Preserve existing architecture unless architecture change is the task.
3. Avoid source, database, migration, or UI changes when the task is documentation-only.
4. Record blockers and assumptions.

Before reporting completion:

1. Run appropriate validation.
2. Report validation results honestly.
3. Report risks and blockers.
4. Summarize changed files.
5. Create a Pull Request for the change.
