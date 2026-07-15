# FACTORY-A1-003 — Continue Forever command

## Identity and authority

- **Task ID:** FACTORY-A1-003
- **Title:** First deterministic Continue Forever command over one approved Task Packet
- **Status:** Implemented — pending Owner review and integration
- **Stage link:** Factory bootstrap (F4/F5 direction in Constitution §26), continuing the A0→A1 step begun by FACTORY-A1-001 and FACTORY-A1-002. Product stage RC5.5A is untouched.
- **Derives From citation:** Explicit Owner instruction of 2026-07-14 — "FOREVER FACTORY — FACTORY-A1-003 CONTINUE FOREVER COMMAND": create the first real Continue Forever command that removes the Owner from the manual execution-transfer loop for one already-approved Task Packet by chaining the existing Router, Execution Connector, and Operator-compatible handoff into one deterministic command that stops after the current packet.
- **Approval record:** Owner-issued packet, 2026-07-14. The instruction itself constitutes packet approval; execution occurred within its stated scope and stop conditions.
- **Completion record:** Implemented on branch `claude/continue-forever-command-4wtz4e` from base `9900107` (merge of PR #69, which carries FACTORY-A1-002). No push, PR, or merge occurred; Owner review and merge authorization remain pending.

## Result

- **Objective:** One deterministic repository command — `npm run factory:continue` (Continue Forever) — that resolves exactly one already-approved current Task Packet, validates it, runs it through the unchanged FACTORY-A1-001 router and FACTORY-A1-002 Execution Connector, prepares the existing Operator-compatible handoff, produces one owner-visible final report, and stops without starting any next task.
- **Finished-result definition:** A tested `src/factory/continue-forever/` module — provider/storage-neutral contracts (`contracts.ts`), a fail-closed current-task resolver and strict Operator-state reconciliation (`current-task-resolver.ts`), the run-lock contract plus a single-process in-memory store (`run-lock.ts`), the durable cross-process atomic lock (`atomic-lock.ts`), an owner-report builder (`report.ts`), the orchestrator (`continue-forever.ts`), and a thin filesystem CLI (`cli.ts`) — plus documentation describing only the implemented behavior.
- **In scope:** New `src/factory/continue-forever/` code and tests; a `factory:continue` package script; a `.forever-factory/CONTINUE_TASK.example.json` example and a `.gitignore` entry for the local `CONTINUE_TASK.json`; documentation rows in `docs/factory/FOREVER_FACTORY_INDEX.md`, a Continue Forever command subsection in `docs/factory/CONTINUE_FOREVER_PROTOCOL.md`, a Factory-status note in `docs/FOREVER_STATUS.md`, and this record.
- **Out of scope:** Any change to FACTORY-A1-001 routing logic, FACTORY-A1-002 adapter logic, the Operator implementation, or the Operator task contract; autonomous selection of new project work; a second command framework; autonomy promotion; automatic merge; publishing inference; multi-packet execution; product RC, canonical data, import, Supabase, or UI work.
- **Acceptance criteria:** One command represents Continue Forever; it accepts no arbitrary new objective; it resolves exactly one approved current packet; it invokes FACTORY-A1-001 routing and FACTORY-A1-002 execution with the exact selected model and effort preserved; it produces the existing Operator-compatible handoff; duplicate execution is prevented; publishing boundaries and the permanent no-auto-merge boundary hold; one final Owner report is produced; no next Task Packet starts; hermetic end-to-end proving passes; documentation describes only implemented behavior.
- **Expected artifacts:** `src/factory/continue-forever/` (14 files including tests), a package script, an example packet, documentation updates, this record.

## Classification and routing

- **Risk class:** R1 (internal Factory tooling behind deterministic gates; no product truth, schema, or write path touched). The command consumes the router, connector, and Operator task contract read-only and touches none of them.
- **Ambiguity level:** Low — the Owner instruction specifies the command interface, resolution rules, stop outcomes, locking states, report fields, publishing policy, and the exact 20-case test matrix.
- **Evidence sensitivity:** Low — no product or client evidence is asserted.
- **Gate blindness:** Low — TypeScript, tests, lint, and build see the entire change.
- **Selected worker tier:** Engineering (Operator-adjacent orchestration). The Owner instruction requested Claude Opus 4.8 at high effort; the remote Claude Code session executed on the platform-configured Claude model, recorded here for honest attribution.
- **Selected author:** Claude (remote Claude Code session on branch `claude/continue-forever-command-4wtz4e`).
- **Selected reviewer:** Owner (A0: every merge is Owner-reviewed and Owner-authorized).

## Scope boundaries

- **Allowed paths:** `src/factory/continue-forever/**` (including the new `atomic-lock.ts` and `atomic-lock.test.ts`), `package.json` (script only), `.forever-factory/CONTINUE_TASK.example.json`, `.gitignore`, `docs/factory/FOREVER_FACTORY_INDEX.md`, `docs/factory/CONTINUE_FOREVER_PROTOCOL.md`, `docs/factory/tasks/FACTORY-A1-003.md`, `docs/FOREVER_STATUS.md`.
- **Forbidden paths:** `src/factory/model-router.ts` / `routing-table.ts` / `operator-handoff.ts` / `execution-connector/**` (consumed unchanged), `scripts/forever-operator/**` (unchanged), `.forever-factory/task.schema.json` and `operator.config.json` (unchanged), `supabase/**`, `src/import/**`, product features, database, canonical data.
- **Shared contracts touched:** None. The router, the Execution Connector, and the Operator task contract are all consumed through their existing public surfaces; no existing contract was modified.

## Command interface

Following the repository's existing `jiti`-based CLI convention (`npm run import`):

- **Command:** `npm run factory:continue` → `jiti src/factory/continue-forever/cli.ts`. The production default is the **real** Claude Code adapter (live execution).
- **Source:** reads one current-task source file (default `.forever-factory/CONTINUE_TASK.json`; override with `--source=<path>`) containing one or more `CurrentTaskEnvelope` entries.
- **Flags:** `--fake` (hermetic, TEST_ONLY adapter — for tests only; never the silent production default), `--retry` (explicit Owner retry of a previously failed run — never automatic), `--recover` (explicit Owner recovery of a stale running claim — never automatic), `--json` (print the structured report), `--lock-file=<path>` (durable/atomic lock, default `.forever-factory/state/continue-forever-locks.json`).
- **Exit codes:** `0` for `handed_off`, `succeeded_report_only`, and `completed_replay`; `1` for any blocked, failed, or already-running outcome.

## Current-task resolution rules (fail closed)

The resolver returns the single approved current packet or a coded stop, in this order: `NO_CURRENT_TASK` (nothing marked current) → `MULTIPLE_CURRENT_TASKS` (more than one marked current) → `CURRENT_TASK_SUPERSEDED` → `CURRENT_TASK_ALREADY_COMPLETED` → `CURRENT_TASK_ALREADY_RUNNING` (approval state in-progress) → `CURRENT_TASK_NOT_APPROVED` → `CURRENT_TASK_INVALID` (missing/invalid id, title, risk class, allowed scope, stop condition, prompt, base commit, or gate profile). The resolver never approves, repairs, or replaces a packet.

Downstream stop outcomes preserved from the reused components: `ROUTER_BLOCKED` (any router stop, including `stop_pending_fable_approval`, `stop_fable_budget`, and `stop_pending_max_approval`, carried on the artifact), `EXECUTION_BLOCKED` (unsupported model/effort), `EXECUTION_FAILED` (structured provider failure), `OPERATOR_HANDOFF_BLOCKED` (a produced patch that fails the Operator task contract), `FAILED_REQUIRES_RETRY` (a prior failed run without explicit retry), and `OWNER_APPROVAL_REQUIRED` (publishing without explicit authorization). The corrective follow-ups add five more fail-closed stops: `CURRENT_TASK_STATE_CONFLICT` (the Continue source and a valid Operator canonical task disagree on the Task Packet id), `CURRENT_TASK_STATE_INVALID` (the Operator `CURRENT_TASK.json` is unreadable, malformed, or has a missing/invalid `taskId`/shape — never a silent skip), `CORRUPT_RUN_STATE` (the durable terminal lock file is unreadable, malformed, of an unsupported schema version, of invalid shape, or carries duplicate run ids), `LIVE_EXECUTION_UNAVAILABLE` (the real adapter is unavailable/unauthenticated), and `STALE_RUN_REQUIRES_OWNER_RECOVERY` (a running claim of uncertain ownership). A malformed/unreadable Continue source (`CONTINUE_TASK.json`) itself returns a structured `CURRENT_TASK_INVALID` through the normal report, not a top-level exception. None of these ever falls back to the fake adapter or simulates success.

## Execution mode (live default, fake TEST_ONLY)

The production command uses the **real** `ClaudeCodeAdapter` by default; `--fake` selects the hermetic `FakeClaudeAdapter`, which is available only for tests and explicit local checks and is never the silent production default. The mode is inferred from the adapter capability name when not passed explicitly (a `fake*` name → `fake`), and the CLI always passes it explicitly. The final report records `executionMode: live | fake`, and every fake-mode report is stamped `HERMETIC_TEST (TEST_ONLY — not a real Forever execution)` in both the `executionResult` and the rendered `Execution mode:` line, so a hermetic run can never be mistaken for a real one. There is no automatic fallback from live to fake.

Binary availability and authentication are treated as **distinct**. The live preflight probe (`claude --version`) confirms only that the binary is resolvable; it does not — and its reported reason says it does not — verify authentication. Authentication is confirmed solely by a real execution: a launch (environment) failure or a recognized authentication/login failure message at runtime is mapped to `LIVE_EXECUTION_UNAVAILABLE` (not generic `EXECUTION_FAILED`), without a second paid model request and without a fake fallback. Tests never require live Claude — they run the fake adapter (or an explicit `executionMode`) exclusively.

## One canonical current-task identity (strict, fail closed)

The Operator canonical task file is `.forever-factory/CURRENT_TASK.json` (the Operator v0.1 task schema — a single flat task). Continue Forever needs the richer routing + execution + handoff envelope, which that schema cannot represent, so it uses an explicitly distinct source, `.forever-factory/CONTINUE_TASK.json`, documented as **not** the Operator canonical task. To guarantee one authoritative Task Packet identity, `reconcileOperatorState` compares the Continue source packet id with the Operator `CURRENT_TASK.json` state whenever that file exists, strictly and before lock acquisition, routing, or any adapter call: `absent` is allowed (Continue may run before a handoff task is written); a `valid` matching id is allowed; a `valid` differing id fails closed with `CURRENT_TASK_STATE_CONFLICT`; and an unreadable, malformed, or shape-invalid Operator task fails closed with `CURRENT_TASK_STATE_INVALID` — the command never logs a warning and continues. No second file named `.forever-factory/current-task.json` is introduced.

## Corrupt run state fails closed

The durable terminal lock file is validated at load through the pure `parseLockPayload` (versioned `{ schemaVersion: "2", records }`). A missing file is a healthy empty state; a valid payload loads normally. An unreadable file, malformed JSON, a bare/legacy array, an unsupported schema version, an invalid record shape, or a duplicate run id is reported as unhealthy, and the command stops with `CORRUPT_RUN_STATE` **before** any provider execution — preventing the duplicate execution that silently treating corruption as empty would permit. The corrupt file is never overwritten, deleted, repaired, or ignored; the final report includes the exact lock-file path and the precise Owner action (park for Owner review and resolve manually), with no secrets exposed.

## Atomic cross-process execution lock

The running claim is acquired through an OS filesystem atomic primitive, not a read-then-write JSON sequence: `AtomicFileLockStore` creates a per-run lock **directory** with `mkdir` (an atomic exclusive create), so exactly one concurrent process can claim a given run id. The loser observes `EEXIST` and, without ever invoking the provider, returns `CURRENT_TASK_ALREADY_RUNNING` (a live owner) or `STALE_RUN_REQUIRES_OWNER_RECOVERY`. Terminal outcomes are written to the versioned durable file **atomically via a temporary file plus rename**, so a crash mid-write can never truncate or erase the previous state. No database, service, or external lock server is introduced.

Automatic time-based stale reclamation is removed — a real Claude execution may legitimately exceed 30 minutes, so elapsed time alone never authorizes a duplicate. Staleness is decided by ownership, not age: a running claim whose owner is on another host (uncertain) or is a dead pid on this host parks with `STALE_RUN_REQUIRES_OWNER_RECOVERY`; a live owner (even with a very old timestamp) stays `already_running` and is never reclaimed. Recovery requires an explicit Owner action (`--recover`); there is no hidden stale retry. A real two-process concurrency test proves that two simultaneous executions on the same run id and lock path yield exactly one `acquired` (one provider-eligible) and one `already_running`, with the durable state left valid.

## Execution and locking architecture

Deterministic flow: resolve the single current packet (fail closed on an unreadable/malformed source) → reconcile the strict Operator canonical state → fail closed on corrupt durable state → confirm live binary availability → derive the run id (`deriveRunId`, the connector's existing identity) → **atomically acquire** the run → run `runExecutionConnector` with the unchanged router decision → capture and classify the artifact → finalize (atomic durable write) or release the lock → build one final report → stop.

The run lock is a small, auditable state machine over the deterministic run id, decided by the atomic `acquire`: an unheld run is `acquired`; a live held run returns `already_running`; a stale held run returns `stale` (recoverable only with explicit `--recover`); a terminal success (`succeeded`/`handed_off`) replays its stored artifact without re-executing; a terminal `failed` stays locked and re-runs only on an explicit `--retry` (no hidden retry loop). A pre-execution block (router or capability) launches no provider run and releases the claim so the Owner can correct the packet and re-run cleanly. The default in-memory lock keeps a single process idempotent; the CLI's durable, atomic file lock keeps separate and concurrent invocations idempotent across processes.

## Publishing boundary behavior

Publishing is never inferred from the command name. A packet that requests no pull request is `prepare-only`. A packet that would publish (`createPullRequest: true`) requires an explicit Owner publishing authorization record on the envelope; without it the command reports `OWNER_APPROVAL_REQUIRED` and performs no Git action. Even with authorization, this command only prepares the Operator-compatible handoff — it performs no commit, push, PR, or merge itself, and `allowAutomaticMerge` is permanently `false` in every produced handoff. Automatic merge is structurally impossible: the report's `automaticMerge` field is the literal `false`.

## Owner-visible final report

One structured report per invocation, rendered concisely by `renderFinalReport`. Fields: Task Packet ID, mission title, final state (and stop code), selected model, selected effort, selected tier, model-selection reasons, execution result, Operator handoff status, validation/gate status, artifact location (branch/worktree/patch) when applicable, publishing state, blockers, the exact action requiring Owner approval, explicit confirmation that no next task started, and the permanent automatic-merge-disabled statement. Every free-text field is static command text or already-redacted connector output; credentials, tokens, cookies, private URLs, and the provider session id never appear (the connector uses a provider-neutral execution id).

## Records

### Validation record (2026-07-14 initial; corrective follow-ups 2026-07-15)

- Focused Continue Forever tests: 5 files / 78 tests passed — the fail-closed resolver plus strict Operator-state validation and reconciliation; the in-memory store atomic-acquire lifecycle plus `parseLockPayload` corruption cases; the durable `AtomicFileLockStore` (single-process lifecycle, atomic durable write with no temp left, stale-by-ownership never-by-time, dead-pid and other-host staleness, explicit `--recover`, corrupt terminal file untouched) and a **real two-process concurrency test** proving exactly one `acquired` + one `already_running` with valid durable state; the report builder/renderer with redaction and the `HERMETIC_TEST` marker; the 20-case orchestrator matrix; and the corrective cases (fake mode inferred/marked; `LIVE_EXECUTION_UNAVAILABLE` with no fallback; live environment and recognized auth/login failure → `LIVE_EXECUTION_UNAVAILABLE`; stale acquire → `STALE_RUN_REQUIRES_OWNER_RECOVERY`; `CORRUPT_RUN_STATE` never invokes the adapter; `CURRENT_TASK_STATE_CONFLICT` and `CURRENT_TASK_STATE_INVALID`; malformed source → structured `CURRENT_TASK_INVALID`; every invalid-state case invokes the adapter zero times).
- Existing Factory tests: FACTORY-A1-001 and FACTORY-A1-002 suites still pass unchanged; full `src/factory` run is 11 files / 164 tests passed.
- TypeScript `npx tsc --noEmit`: passed.
- Changed-file ESLint (`src/factory/continue-forever`): passed after Prettier formatting.
- Production build `npm run build`: passed.
- `git diff --check`: clean.
- Full suite `npx vitest run`: the pre-existing, environment-dependent RC5.5A importer integration tests under `src/import/importer-preflight.test.ts` remain failing on the base for the deliberately gitignored Coralina source documents; they are unrelated to and untouched by this task. Documented separately, not "all green."

### Live proving record

No new live Claude execution was required or performed; no repository write, commit, push, PR, merge, or session-data persistence occurred. Hermetic CLI smokes proved the corrected behavior end to end, all before any provider call except the fake one: (A) the **default** invocation reports `executionMode: live (real Claude Code adapter)` and stopped at `NO_CURRENT_TASK` with no source; (B) `--fake` ran the full cycle to `handed_off` stamped `HERMETIC_TEST`, and a second `--fake` replayed via the durable versioned (`schemaVersion: "2"`) terminal file (`completed_replay`); (C) a malformed terminal lock stopped at `CORRUPT_RUN_STATE` with the file left byte-for-byte unchanged; (D) a malformed Operator `CURRENT_TASK.json` stopped at `CURRENT_TASK_STATE_INVALID` (no silent skip); (E) a malformed Continue `CONTINUE_TASK.json` returned a structured `CURRENT_TASK_INVALID` rather than a top-level exception. The real cross-process atomicity is proven by the two-process concurrency test above. The real live-adapter path is the unchanged FACTORY-A1-002 adapter, already live-proven in that task; Continue Forever adds no new provider transport, and its live preflight verifies binary availability only (authentication is confirmed solely by a real execution, whose recognized auth/login failure maps to `LIVE_EXECUTION_UNAVAILABLE`). The user-facing workflow is **not** claimed complete: it is complete only once a real approved Task Packet has passed through the live command, which remains pending Owner review and integration.

### Completion record

Pending Owner review and integration. No push, PR, merge, database access, autonomy promotion, or external side effect was performed by this task. Autonomy remains A0; this command is a deterministic entry point and does not by itself promote the Factory to unattended A1.
