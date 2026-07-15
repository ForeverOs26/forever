# Continue Forever Protocol

Status: Ratified A0 protocol
Current autonomy: A0 — Propose only

The commands **Continue Forever** and **Продолжай Forever** invoke the same protocol. They do not grant new authority or silently approve execution.

## A0 sequence

1. Reconcile Git and Ledger state: read the Factory Index, current stage/status, Task Packet, and relevant routing and gate sections; fetch authorized repository state where permitted; and inspect active branches, PRs, run reports, and parked work. Read the complete Factory Constitution when required by the Factory Index full-reading policy.
2. Inspect `docs/factory/OWNER_QUEUE.md`.
3. Identify the single highest-priority action already authorized by the current stage, roadmap, decision, or explicit Owner instruction.
4. Produce exactly one proposed Task Packet, or exactly one Owner request when progress depends on Owner-only action.
5. Show the exact **Derives From** authority.
6. Classify risk, ambiguity, evidence sensitivity, and gate blindness.
7. Propose an author tier and an independent reviewer where required.
8. Wait for the Owner to approve the packet.
9. Execute only after approval and only within the approved packet, branch, paths, budget, and gates.
10. Return one concise final report and stop.

At A0 this protocol is proposal-first, not fully autonomous. The true one-command execution experience begins at A1, after promotion criteria are earned and recorded. A0 never originates unattended work, invokes models automatically, runs at night, controls a browser, or merges automatically.

## Deterministic command entry point (FACTORY-A1-003)

A deterministic command implements the *execution* half of this protocol for one already-approved Task Packet: `npm run factory:continue` (`src/factory/continue-forever/`). It does not originate work, invent priority, choose the next RC, or approve a packet. It resolves exactly one already-approved current Task Packet, fails closed unless a single executable current task exists, runs it through the unchanged Router (FACTORY-A1-001) and Execution Connector (FACTORY-A1-002) with the exact selected model and effort, prepares the unchanged Operator-compatible handoff, and produces one owner-visible final report — then stops without starting any next task.

It runs the real Claude Code adapter by default; `--fake` selects a hermetic, TEST_ONLY adapter for tests and local checks only, never as a silent production default, and there is no automatic live-to-fake fallback. Binary availability and authentication are distinct: the live preflight (`claude --version`) confirms only that the binary is resolvable, while authentication is confirmed solely by a real execution — a launch failure or a recognized auth/login failure maps to `LIVE_EXECUTION_UNAVAILABLE`, never a simulated success. Its canonical source is `.forever-factory/CONTINUE_TASK.json`, an explicitly distinct file from the Operator canonical `.forever-factory/CURRENT_TASK.json`; the Operator state is reconciled strictly and fails closed with `CURRENT_TASK_STATE_CONFLICT` (differing id) or `CURRENT_TASK_STATE_INVALID` (unreadable/malformed/invalid) — never a silent skip — so there is one authoritative identity.

Duplicate execution is prevented by an **atomic cross-process lock**: the running claim is an atomically created per-run lock directory, so exactly one of two simultaneous processes may execute and the other reports already-running without any provider call; terminal state is written atomically (temp file + rename). Elapsed time alone never authorizes a duplicate — a long-running real execution is not reclaimed; a running claim of uncertain ownership parks with `STALE_RUN_REQUIRES_OWNER_RECOVERY` and is reclaimed only by an explicit Owner recovery. A completed run replays its stored result, a failed run re-runs only on explicit retry, and a corrupt durable lock file parks with `CORRUPT_RUN_STATE` (never auto-repaired). Publishing is never inferred from the command name — a packet that would commit, push, or open a pull request requires an explicit Owner publishing authorization record, and otherwise stops with `OWNER_APPROVAL_REQUIRED`; automatic merge stays permanently disabled. This command is an execution entry point only. It does not promote the Factory to unattended A1; promotion requires separate Owner approval and proving history, every packet it executes must already be Owner-approved, and the workflow is complete only once a real approved Task Packet has passed through the live command.

## Non-invention and stops

The protocol never invents product priority, evidence, facts, authority, acceptance criteria, or a missing business decision. It parks or creates one Owner request when required information is absent.

Stop for any business, evidence, legal, financial, production, constitutional, security, credential, external-publication, client-communication, paid-service, or scope-escalation decision. Also stop for conflicts, unavailable required gates, unauthorized paths, or R2/R3 merge authority.

Only unavailable gates already declared required and active are gate failures. Unimplemented or inactive gates are labelled `PLANNED`, never passed. Until approved repository CI workflows are active, bootstrap uses local Operator validation, manual diff review, and Owner merge authorization.

## Standard final report

```text
Result: <completed | parked | owner action required>
Task Packet: <ID and path, or none>
Derives From: <exact authority>
Risk / ambiguity: <classification>
Artifacts: <branch, commit, PR, reports>
Gates: <pass/fail/not available>
Ledger updates: <paths>
Decision required: <none or exact Owner decision>
Next action: <one recommendation>
```
