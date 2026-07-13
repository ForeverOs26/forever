# Forever Factory Index

Status: Cold-clone start here
Current autonomy: A0 — Propose only
Current Operator maturity: v0.1 implemented; first isolated documentation-only proving cycle completed for bounded A0 use

## What Forever Factory is

Forever Factory is the Git-recoverable operating system for building and maintaining Forever. It connects written authority to durable state, one bounded Task Packet, implementation, deterministic gates, review, integration, and an updated Ledger.

It is not the Forever product, an autonomous Supervisor agent, a hidden memory service, a second product roadmap, an AI source of truth, or permission to make external or production changes.

## Required reading order

Always read for a Factory-governed task:

1. This Factory Index.
2. `docs/FOREVER_DOC_INDEX.md`, `docs/CODEX_OPERATING_MANUAL.md`, and the product reading required there, including `docs/FOREVER_BLUEPRINT.md` and `docs/DATA_STANDARD.md`.
3. `docs/CURRENT_STAGE.md` and `docs/FOREVER_STATUS.md`.
4. The approved Task Packet.
5. The relevant sections of `docs/factory/FACTORY_ROUTING_POLICY.md` and `docs/factory/FACTORY_GATE_PROFILES.md`.
6. `docs/FOREVER_OPERATOR_V0_1.md` and `scripts/forever-operator/README.md` before using Operator.

Read the complete `docs/FOREVER_FACTORY_CONSTITUTION.md` when the task involves Factory architecture, routing policy, autonomy, security, R2 or R3 work, shared contracts, constitutional interpretation, external side effects, production access, browser automation, or legal, financial, or privileged actions. For isolated ordinary product tasks, this Index plus relevant task-specific documents is sufficient unless the Task Packet requires the complete Constitution.

## Canonical locations

| Need                             | Location                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Product Constitution             | `docs/FOREVER_BLUEPRINT.md`                                                                                          |
| Factory Constitution             | `docs/FOREVER_FACTORY_CONSTITUTION.md`                                                                               |
| Current stage and status         | `docs/CURRENT_STAGE.md`, then `docs/FOREVER_STATUS.md`                                                               |
| Roadmap and backlog              | `docs/ROADMAP.md`, `docs/BACKLOG.md`                                                                                 |
| Decisions                        | `docs/DECISIONS.md`                                                                                                  |
| Owner-only blockers              | `docs/factory/OWNER_QUEUE.md`                                                                                        |
| Routing and gates                | `docs/factory/FACTORY_ROUTING_POLICY.md`, `docs/factory/FACTORY_GATE_PROFILES.md`                                    |
| Task Packet template             | `docs/factory/TASK_PACKET_TEMPLATE.md`                                                                               |
| Durable approved Task Packets    | `docs/factory/tasks/<task-id>.md` when created                                                                       |
| Durable run reports              | `docs/factory/runs/<task-id>.md` when a packet requires retention                                                    |
| Transient Operator state/reports | `.forever-factory/state/` and `.forever-factory/reports/` (local, generated, ignored; never the sole durable record) |
| Operator runbook                 | `scripts/forever-operator/README.md`                                                                                 |

Do not create empty task or run artifacts. Create them only for approved work and commit any record required for durable recovery.

## Recover an interrupted run

1. Fetch and inspect the authoritative Git state without rewriting history.
2. Read the product Constitution and Ledger documents in the order above, plus the complete Factory Constitution when the recovery work meets the full-reading policy.
3. Inspect active Task Packets, branches, PRs, durable run reports, and Operator state.
4. Match packet, branch, commit, PR, gates, and Ledger state.
5. Treat unmatched or half-finished work as parked; do not infer completion from chat or a report.
6. Reconcile with the PR diff as authoritative, then issue an approved resume/correction packet or one Owner request.

## Start Continue Forever at A0

Invoke **Continue Forever** or **Продолжай Forever**, then follow `docs/factory/CONTINUE_FOREVER_PROTOCOL.md`. The Dispatcher proposes exactly one packet or Owner request and waits for Owner packet approval. Execution begins only after that approval.

## Current boundaries

- Autonomy is A0. No unattended task origination, night execution, automatic model invocation, browser control, or automatic merge is enabled.
- Operator v0.1 can validate bounded patches locally in disposable worktrees. Its first isolated documentation-only `validate-only` and `dry-run` proving cycle completed successfully, establishing bounded A0 use without enabling production autonomy or resolving every known limitation. Auto-merge remains disabled.
- GitHub CI enforcement, native R0–R3 gate profiles, Ledger synchronization, shared-contract locking, author/reviewer identity enforcement, semantic data gates, and approval verification remain `PLANNED` unless separately implemented and activated.
- Until approved repository CI workflows are active, bootstrap relies on local Operator validation, manual diff review, and Owner merge authorization. Planned gates are never described as passed; once a gate is active and required, absence or failure blocks merge.
- R2 and R3 always remain human-in-the-loop; R3 is Owner-merged.

## Permanent exclusions

The Factory never autonomously owns product truth, source evidence, strategy, business commitments, legal or financial decisions, paid subscriptions, credentials, production deployment or writes, external publishing, client communications, constitutional self-amendment, or R2/R3 merge authority. Browser automation and Night Shift remain deferred until measured bottlenecks and approved security boundaries justify them.
