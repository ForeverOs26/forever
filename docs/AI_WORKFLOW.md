# Forever AI Workflow

Status: Canonical AI and development workflow
Last updated: 2026-07-13

## Purpose

This document defines how ChatGPT, Claude, Codex, and Constantin collaborate in Forever without creating competing sources of truth or expanding scope beyond the active stage.

GitHub remains the source of truth for code and version-controlled documentation. Durable decisions must be recorded in repository documents, not left only in chat threads.

Factory execution is governed by `docs/FOREVER_FACTORY_CONSTITUTION.md`. Operational routing, gates, Task Packets, Owner-only work, and the A0 entry protocol live under `docs/factory/`. This workflow summarizes collaboration roles; it does not grant authority beyond those policies.

For every Factory-governed task, Codex reads `docs/factory/FOREVER_FACTORY_INDEX.md`, current stage/status documents, the approved Task Packet, and the relevant routing and gate sections. The complete Factory Constitution is required for Factory architecture, routing policy, autonomy, security, R2 or R3 work, shared contracts, constitutional interpretation, external side effects, production access, browser automation, or legal, financial, or privileged actions. Isolated ordinary product tasks may use the Factory Index and relevant task-specific documents unless the Task Packet requires the complete Constitution. Product Blueprint and Data Standard reading requirements remain unchanged.

## Role boundaries

### ChatGPT — Chief Architect / Technical Director

- Defines product and architecture objectives.
- Sets acceptance criteria and stage boundaries.
- Reviews tradeoffs, scope changes, and risks.
- Approves movement between stages.
- Decides when an idea belongs in the current stage, roadmap, backlog, or future parking lot.

### Claude — Specifications, UX, copy, audits, isolated components, tests, and code drafts

- Prepares specifications, copy, UX flows, audits, test plans, and isolated implementation drafts when appropriate.
- Helps clarify acceptance criteria and edge cases.
- Does not become the repository source of truth unless its output is reviewed and committed through GitHub.

### Codex — Repository-aware implementation, integration, validation, commits, and pull requests

- Reads the repository before changing it.
- Makes repository-aware changes across files when approved.
- Performs migrations only when explicitly required and approved.
- Integrates cross-file changes, validates formatting/types/tests/builds where applicable, commits changes, and opens pull requests.
- Does not merge its own pull requests.
- Acts as the repository integration tier when justified by `docs/factory/FACTORY_ROUTING_POLICY.md`; it does not choose product priority.

### Constantin — Project owner and source-material provider

- Provides project source materials, business priorities, approvals, and operational constraints.
- Confirms paid-tool decisions, dependency tradeoffs, and external commitments.
- Supplies missing source-backed facts when validation blocks progress.

## Development pipeline

1. Architect defines the objective and acceptance criteria.
2. Claude prepares specification, audit, UX, tests, or isolated draft when appropriate.
3. Codex performs repository-aware implementation.
4. Validate formatting, types, tests, and build where applicable.
5. Commit changes on a dedicated branch.
6. Open a Draft Pull Request.
7. Perform self-review.
8. Architect Review.
9. Mark Ready.
10. Merge only after approval.

## Scope control rules

- Every task must belong to the current stage, roadmap, backlog, or an explicitly recorded decision.
- If a new request does not support the current stage, record it in `docs/BACKLOG.md` or `docs/ROADMAP.md` instead of starting it immediately.
- Product constitutional changes belong in `docs/FOREVER_BLUEPRINT.md`; development-system constitutional changes belong in `docs/FOREVER_FACTORY_CONSTITUTION.md`. Either requires its applicable ratification process.
- Important decisions belong in `docs/DECISIONS.md`.
- Current-stage work belongs in `docs/CURRENT_STAGE.md`.

## Current Factory autonomy

Forever Factory is at A0 — Propose only. “Continue Forever” produces exactly one proposed Task Packet or one Owner request, then waits for Owner packet approval. No unattended task origination, automatic model invocation, browser control, Night Shift, or automatic merge is enabled.

## Automation rule

Before each stage, ask:

> Is there a small automation that will accelerate this stage and later stages?

If the automation is useful now and reduces manual work immediately, it may be considered for the current stage. If it is not needed now, record it in the roadmap or backlog and do not let it delay product progress.

## Paid-tool rule

Paid tools are purchased only after confirming:

- the concrete need;
- expected ROI;
- available alternatives;
- lock-in or dependency risk;
- whether the tool accelerates the current stage or only a future possibility.
