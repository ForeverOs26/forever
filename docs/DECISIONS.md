# Forever Decisions

Status: Canonical decision log
Last updated: 2026-07-11

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

### 2026-07-11 — AI roles are separated

- **Decision:** ChatGPT acts as Chief Architect / Technical Director; Claude supports specifications, UX, copy, audits, isolated components, tests, and code drafts; Codex performs repository-aware implementation, validation, commits, and pull requests.
- **Context:** AI tools need clear boundaries so outputs do not conflict or bypass repository review.
- **Consequence:** Repository changes still flow through GitHub, validation, and Pull Requests.
- **Review trigger:** Revisit if tool capabilities or team responsibilities materially change.
