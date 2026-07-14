# FACTORY-A1-002 — Execution Connector

## Identity and authority

- **Task ID:** FACTORY-A1-002
- **Title:** Minimal supported Execution Connector from approved Task Packet to Operator-compatible handoff
- **Status:** Implemented — pending Owner review and integration
- **Stage link:** Factory bootstrap (F4/F5 direction in Constitution §26), continuing the A0→A1 step begun by FACTORY-A1-001. Product stage RC5.5A is untouched.
- **Derives From citation:** Explicit Owner instruction of 2026-07-14 — "FOREVER FACTORY — FACTORY-A1-002 EXECUTION CONNECTOR": remove the Owner from the manual transfer loop by adding the smallest supported connector that takes one approved Task Packet, uses the existing router decision, runs the selected Claude Code execution through a supported interface, captures the result, and produces an artifact compatible with the existing Forever Operator handoff.
- **Approval record:** Owner-issued packet, 2026-07-14. The instruction itself constitutes packet approval; execution occurred within its stated scope and stop conditions.
- **Completion record:** Implemented on branch `claude/forever-factory-connector-wvluqf` from base `e4ae6f4` (merge of PR #68, which carries FACTORY-A1-001). No push, PR, or merge occurred; Owner review and merge authorization remain pending.

## Result

- **Objective:** A deterministic Execution Connector that accepts one Owner-approved Task Packet, invokes the exact FACTORY-A1-001 routing decision, builds a deterministic execution request, runs it through a provider adapter (hermetic fake or the real Claude Code CLI), captures the result, and converts a successful execution into the existing Forever Operator v0.1 handoff artifact — automating transport and execution mechanics without inventing project priorities or approving its own work.
- **Finished-result definition:** A tested `src/factory/execution-connector/` module — provider-neutral contract (`contracts.ts`), deterministic run identity and idempotency store (`run-store.ts`), secret redaction (`redaction.ts`), the orchestrator (`connector.ts`), a hermetic fake adapter and the real Claude Code adapter (`adapters/`) — plus documentation updated to describe only the implemented capability.
- **In scope:** New `src/factory/execution-connector/` code and tests; documentation rows in `docs/factory/FOREVER_FACTORY_INDEX.md`, an Execution Connector subsection in `docs/factory/FACTORY_ROUTING_POLICY.md`, a Factory-status note in `docs/FOREVER_STATUS.md`, and this record.
- **Out of scope:** Any change to the FACTORY-A1-001 router logic, the Operator implementation, or the Operator task contract; a second Operator or agent platform; a parallel Forever-Agent folder; Windows users/ACLs/desktop-control agents; autonomy promotion; automatic merge; product RC work; canonical data, import, Supabase, UI, or migrations.
- **Acceptance criteria:** FACTORY-A1-001 is the routing source of truth; one approved packet can enter the connector; the exact selected model and effort reach the adapter unchanged; the result is captured in a deterministic artifact; a successful result becomes a valid, unchanged Operator v0.1 handoff; duplicate execution is prevented; Fable and max approval boundaries stay enforced; automatic merge stays impossible; hermetic end-to-end tests pass; documentation describes only implemented capability.
- **Expected artifacts:** `src/factory/execution-connector/` (12 files including tests), documentation updates, this record.

## Classification and routing

- **Risk class:** R1 (internal Factory tooling behind deterministic gates; no product truth, schema, or write path touched). The connector consumes the Operator task contract read-only and touches no Operator code.
- **Ambiguity level:** Low — the Owner instruction specifies responsibilities, stop states, idempotency states, security posture, and the exact test matrix.
- **Evidence sensitivity:** Low — no product or client evidence is asserted.
- **Gate blindness:** Low — TypeScript, tests, lint, and build see the entire change.
- **Selected worker tier:** Engineering (architecture-sensitive, Operator-adjacent integration). The Owner instruction requested Claude Opus 4.8 at high effort; the remote Claude Code session executed on the platform-configured Claude model, recorded here for honest attribution.
- **Selected author:** Claude (remote Claude Code session on branch `claude/forever-factory-connector-wvluqf`).
- **Selected reviewer:** Owner (A0: every merge is Owner-reviewed and Owner-authorized).

## Scope boundaries

- **Allowed paths:** `src/factory/execution-connector/**`, `docs/factory/FACTORY_ROUTING_POLICY.md`, `docs/factory/FOREVER_FACTORY_INDEX.md`, `docs/factory/tasks/FACTORY-A1-002.md`, `docs/FOREVER_STATUS.md`.
- **Forbidden paths:** `scripts/forever-operator/**` (unchanged), `.forever-factory/**` contracts (unchanged), `src/factory/model-router.ts` / `routing-table.ts` / `operator-handoff.ts` (consumed unchanged), `supabase/**`, `src/import/**`, product features.
- **Shared contracts touched:** None. The Operator task contract (`.forever-factory/task.schema.json`) is consumed read-only through the unchanged `buildOperatorHandoff`; the connector's produced task is hermetically validated against the committed schema.

## Supported Claude execution interface (first investigation)

Determined in-environment, without exposing credentials:

- **Installed interface:** Claude Code CLI `2.1.209`, non-interactive `--print` (`-p`) mode.
- **Programmatic invocation:** `claude --print` with `--input-format`/`--output-format` (`text`, `json`, `stream-json`) and `--json-schema` for structured output.
- **Model selection:** `--model` accepts aliases (`sonnet`, `opus`, `fable`) or full ids (`claude-sonnet-5`, `claude-opus-4-8`, `claude-fable-5`).
- **Effort selection:** `--effort` accepts `low | medium | high | xhigh | max` — a 1:1 match to the router's effort levels.
- **Permission controls:** `--permission-mode` (`plan`, `acceptEdits`, `bypassPermissions`, …), `--tools`, `--allowedTools`/`--disallowedTools`, `--add-dir`.
- **Exit/timeout:** exit code `0` on success and non-zero on failure; no built-in per-call timeout, so the node runner enforces a hard timeout and reports a structured timeout.
- **Authentication state category:** available (host-managed provider). Confirmed by one hermetic, tools-disabled, plan-mode smoke returning a `{"subtype":"success"}` envelope; no token, cookie, session URL, or account identifier was printed.

## Execution controls

- **Required gates:** Focused connector tests, existing Factory tests, full test suite, TypeScript, changed-file ESLint, production build, `git diff --check`.
- **Retry budget:** Standard two gate cycles; one was used (a fixture typing correction and a redaction-test input correction).
- **Token/cost budget:** Single session; one low-effort Sonnet live smoke.
- **Stop conditions:** Any Operator or router-logic rewrite, canonical-contract change, product RC work, autonomous task selection, or new Factory task — none occurred.
- **Required Ledger updates:** `docs/FOREVER_STATUS.md`, `docs/factory/FACTORY_ROUTING_POLICY.md`, `docs/factory/FOREVER_FACTORY_INDEX.md` — all in this change.

## Architecture

- **`contracts.ts`** — provider-neutral types: `ExecutionRequest` (Task Packet id, run id, selected model + provider model, tier, exact effort, prompt, working directory, allowed scope, forbidden actions, timeout, expected result format, stop condition), `ProviderAdapter` (a `capability` descriptor plus `execute`), `AdapterResult`, `ExecutionCapture`, `ConnectorArtifact`, `RunState`, and the fail-closed `resolveProviderModel` (router model string → provider model id; unknown never falls back).
- **`run-store.ts`** — `deriveRunId` computes a deterministic id (`<taskPacketId>-<FNV-1a hex>`) over the packet's identity and execution content; `InMemoryRunStore` and the `RunState` lifecycle (`approved → routed → blocked | running → succeeded | failed → handed_off`) provide idempotency.
- **`redaction.ts`** — ordered, deterministic rules strip URLs, bearer/authorization tokens, `sk-` keys, `key=value` secrets, cookies, UUID session/account identifiers, and long opaque blobs; evidence is bounded in size.
- **`adapters/fake-adapter.ts`** — hermetic, deterministic fake that records the exact request and returns a scripted outcome; used by all committed tests and the full proving cycle.
- **`adapters/claude-code-adapter.ts`** — real adapter with a pure, unit-tested `claude --print` argument builder (exact `--model`/`--effort`, `--output-format json`, scoped `--permission-mode`/`--tools`, no `--fallback-model`) and an injected process runner; parses the JSON envelope and captures a redacted, provider-neutral result.
- **`adapters/node-process-runner.ts`** — the only module touching `node:child_process`; argv-only (no shell), inherits host-managed auth, enforces the timeout, used solely for gated live proving.
- **`connector.ts`** — `runExecutionConnector` validates the packet, enforces idempotency, calls `routeTaskPacket`, honors every router stop state, fails closed on unsupported model/effort, builds the execution request, runs the adapter, captures the result, and converts success into the unchanged `buildOperatorHandoff` artifact.

## Model and effort propagation

The connector uses the exact FACTORY-A1-001 decision and never reinterprets the packet. The router's model string maps 1:1 to a provider model id (`Claude Sonnet 5.0`→`claude-sonnet-5`, `Claude Opus 4.8`→`claude-opus-4-8`, `Claude Fable 5.0`→`claude-fable-5`) and the effort passes through unchanged. Sonnet+effort and Opus+effort reach the adapter verbatim; Fable and max only reach it after the router's authorization and budget gates already passed (the connector adds no bypass). An unmapped model, an adapter that does not support the routed model, or an adapter that cannot apply the routed effort all fail closed with a precise unsupported-capability block instead of substituting a different model or pretending the effort was applied. No fallback model is ever configured.

## Idempotency and state

The run id is a deterministic function of the packet's identity and execution content, so an identical resubmission maps to the same id and returns the stored artifact without launching a second provider run; a genuine re-route (new prior-attempt history) is a new run. A run left in the `running` state fails closed as a duplicate-in-flight block. Terminal (`succeeded`/`failed`/`handed_off`) and `blocked` states replay their stored artifact.

## Security and redaction

Logs and artifacts exclude authentication tokens, cookies, private session URLs, environment secrets, credential-bearing command lines, and account identifiers. The real adapter derives a provider-neutral execution id (`claude-code-<runId>`) and never surfaces the provider `session_id`; all captured summaries and failure messages pass through the redactor, and evidence is length-bounded. The node runner passes an argv array (never a shell string) and constructs, logs, and stores no credential.

## Operator compatibility

A successful, patch-producing execution is converted by the unchanged `buildOperatorHandoff`; the embedded `operatorTask` is the exact `.forever-factory/task.schema.json` contract with `allowAutomaticMerge` permanently `false` and packet risk mapped to the conservative Operator floor. The connector never merges, never enables auto-merge, never opens a PR itself, and never starts another Task Packet.

## Records

### Validation record (2026-07-14, dependencies installed via `npm ci --ignore-scripts`)

- Focused connector tests: 4 files / 38 tests passed — covering approved packet → router → execution request; Sonnet and Opus model+effort reaching the adapter unchanged; Fable and max stop states preventing execution; unsupported model and unsupported effort failing closed; an unapproved packet blocked; duplicate execution prevented (single provider call across two submissions) and duplicate-in-flight failing closed; provider failure and timeout captured as structured failed results; a successful result converted into a schema-valid Operator handoff; automatic merge remaining impossible; secret redaction in the artifact; and the hermetic full proving cycle.
- Existing Factory tests: `model-router.test.ts` (41) and `operator-handoff.test.ts` (7) still pass unchanged (48 tests); full `src/factory` run is 6 files / 86 tests passed.
- TypeScript `npx tsc --noEmit`: passed.
- Changed-file ESLint (`src/factory/execution-connector`): passed after Prettier formatting.
- Production build `npm run build`: passed.
- `git diff --check`: clean.
- Full suite `npx vitest run`: pre-existing, environment-dependent RC5.5A importer integration tests remain failing on the base for the deliberately gitignored Coralina source documents; they are unrelated to and untouched by this task. Documented separately, not "all green."

### Live proving record

Permitted conditions were met (supported interface confirmed, authentication available, no credential exposed, hermetic and documentation-only, no commit/push/PR/merge/network side effect beyond the Claude service, scope unchanged). One live smoke ran the **real** `ClaudeCodeAdapter` + node runner through `runExecutionConnector` with a report-format, plan-mode, read-only, empty-working-directory packet: the router selected Sonnet at low effort, `claude --print --model claude-sonnet-5 --effort low` executed, and the connector captured `succeeded` with `providerExecutionId = claude-code-FACTORY-A1-002-LIVE-<hash>` (no session id), `resultSummary = "PROVEN"`, and `automaticMerge = false`. Report format produced no patch, so no side effect and no handoff — the transport, model, and effort propagation are proven live, while the success→handoff conversion is proven hermetically with the fake adapter. The proving script lived outside the repository and was not committed.

### Completion record

Pending Owner review and integration. No push, PR, merge, database access, or external side effect beyond the single Claude smoke was performed by this task.
