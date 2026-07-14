# Forever Factory Routing Policy

Status: Ratified operational policy
Current autonomy: A0 — Propose only
Last reviewed: 2026-07-13

## Principle

Roles are permanent policy concepts; model mappings are replaceable operational configuration. Do not embed model names into constitutional logic.

Route to the highest tier required by:

```text
max(
  risk floor,
  ambiguity floor,
  evidence sensitivity,
  gate blindness
)
```

High ambiguity caused by a mis-specified objective is not solved by spending a stronger model: park the packet and obtain clarification.

## Current role-to-model mapping

| Role tier                   | Current model     | Operational use                                                                                                                                             |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drafting tier               | Claude Sonnet 5.0 | Mechanical R0 work, documentation drafts, formatting, translations, and bounded test scaffolding                                                            |
| Engineering tier            | Claude Opus 4.8   | Default R1 engineering, multi-file implementation, specifications, and most reviews                                                                         |
| Repository integration tier | Codex             | Git-aware integration, repository-wide work, validation, migrations, Factory tooling, and branch/commit/PR mechanics                                        |
| Judgment tier               | Claude Fable 5.0  | Limited strategic judgment: architecture, constitutional work, high-impact security, R2/R3 adversarial review, arbitration, and gates-blind critical audits |

## Risk floors

| Risk | Minimum routing floor                                                                                              | Required review posture                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| R0   | Drafting                                                                                                           | Deterministic gates; reviewer may be lightweight when the packet does not assert product truth     |
| R1   | Engineering                                                                                                        | Engineering author with deterministic product gates; independent review where gates are incomplete |
| R2   | Engineering author; Repository integration when shared/repo-wide; Judgment review when evidence or gates are blind | Different author and reviewer, adversarial review, Owner approval before merge                     |
| R3   | Judgment for the privileged/constitutional decision and Repository integration for repository mechanics            | Different model family or independent adversarial instance; Owner approval and Owner merge         |

The floor is a minimum. Ambiguity, evidence sensitivity, or gate blindness may route higher.

## Selection rules

- **Sonnet is appropriate** for reversible, well-specified R0 work where deterministic review can see the result and no product truth is being asserted.
- **Opus is the default** for R1 product work, medium-complexity implementation, specifications, multi-file work, and reviews that require engineering judgment.
- **Codex is justified** for repository-wide reconciliation, complex Git history, cross-file integration, migrations, applying or validating patches, Factory tooling, and branch/commit/PR/CI mechanics. It is not the routine product-coding default.
- **Fable is justified** only where strategic judgment is materially necessary: architecture, constitutional or high-impact security work, gates-blind R2/R3 review, system-wide arbitration, or qualifying twice-failed capability work. Every use must record the reason ordinary engineering and deterministic gates are insufficient.

## Separation and escalation

- R2 and R3 authors may not approve their own work. The reviewer must inspect the actual PR diff, changed files, tests, gates, and Ledger changes; a narrative report is not authoritative.
- A worker gets at most two gate cycles. After two failures, a genuine capability failure may escalate one tier once.
- Mis-specification or unresolved ambiguity parks immediately instead of escalating.
- Security or scope failure stops the run.
- Autonomous Fable usage is disabled at A0.

## Deterministic router implementation (v0.1)

A deterministic, tested implementation of this policy lives in `src/factory/`:

- `src/factory/routing-table.ts` — the replaceable tier-to-model mapping (`drafting` → Claude Sonnet 5.0, `engineering` → Claude Opus 4.8, `judgment` → Claude Fable 5.0), coarse usage states (`available`, `restricted`, `exhausted`, `unknown`), and the ordered effort levels (`low`, `medium`, `high`, `xhigh`, `max`) with the automatic effort cap. The repository integration tier (Codex) is not a router target; integration mechanics remain the Operator's domain.
- `src/factory/model-router.ts` — `routeTaskPacket` maps explicit Task Packet classification metadata (risk class, task complexity, ambiguity, evidence sensitivity, gate blindness, architectural impact, canonical-data impact, affected subsystems, expected files, estimated duration, correctness criticality, prior model attempts, Fable authorization, max authorization, requested effort, usage states) to a routed tier **and effort level**, or a coded stop. It routes to the maximum applicable floor, grants one bounded retry after a single diagnosable gate failure, escalates one tier after a second gate failure or a capability failure, parks mis-specification and high ambiguity, stops on prior security or scope failures, and parks canonical-data work classified below R2 as misclassified.

### Effort routing

Every successful routing decision selects a reasoning-effort level (`low`, `medium`, `high`, `xhigh`, `max`) deterministically from the tier and packet metadata:

- **Sonnet (drafting):** trivial mechanical → `low`; ordinary bounded → `medium`; complex but well-scoped → `high`.
- **Opus (engineering):** bounded or moderately complex → `medium`; architecture-sensitive, repository-wide (≥3 subsystems), Operator-touching, multi-file (≥5 files), or complex → `high`.
- **Fable (judgment):** strategic → `high`; large autonomous, multi-session → `xhigh` (with a concrete justification recorded in the reasons).

Adjustments: high correctness criticality and a bounded retry each raise automatic effort to `high` (the automatic cap). An Owner `requestedEffort` override may raise effort further but never lowers the deterministic baseline. `xhigh` is only emitted with a concrete justification in the reasons; `max` is never reached automatically and requires an explicit Owner `maxAuthorization` record — otherwise the router returns `stop_pending_max_approval`. A lower-tier usage exhaustion bumps the tier but never bypasses Fable authorization or max approval. Every successful decision reports `tier`, `model`, `effort`, `reasons`, and `boundedRetry`; every Operator handoff carries the selected model, selected effort, and selection reasons.
- `src/factory/operator-handoff.ts` — `buildOperatorHandoff` converts a routed, Owner-approved, completed execution into a handoff artifact carrying the selected model, selected effort, and selection reasons, whose embedded task is the exact Operator v0.1 contract (`.forever-factory/task.schema.json`), with `allowAutomaticMerge` permanently false and packet risk mapped to a conservative Operator risk floor (R1 → MEDIUM, R2/R3 → HIGH). The Operator task contract is unchanged; effort lives only in the outer handoff artifact.

Fable is double-gated: the router returns `stop_pending_fable_approval` unless the packet carries an explicit Owner authorization record, and `stop_fable_budget` unless the Owner has additionally declared the judgment tier `available` (it is `restricted` by default). Every Fable stop proposes decomposition, scope reduction, Opus execution, or an explicit Owner blocker. Usage states are honest coarse categories; the router never fabricates provider budget figures.

The router is a decision-support library only. It selects and records; it does not invoke any model, and autonomy remains A0 — every packet it routes must already be Owner-approved, and unattended execution remains disabled until A1 promotion criteria are earned and recorded.

## Execution Connector (FACTORY-A1-002)

A deterministic Execution Connector lives in `src/factory/execution-connector/`. It automates the transport and execution mechanics between one Owner-approved Task Packet and the existing Operator handoff, using this router as the single routing source of truth. It invents no project priorities and approves none of its own work.

The connector validates the packet (id, approval state, allowed scope, stop condition, risk class, required validation profile), invokes `routeTaskPacket`, and honors every router stop state (pending Fable approval, Fable budget, pending max approval, misclassification, security or scope block). It maps the router's model string 1:1 to a provider model id (`Claude Sonnet 5.0`→`claude-sonnet-5`, `Claude Opus 4.8`→`claude-opus-4-8`, `Claude Fable 5.0`→`claude-fable-5`) and passes the exact selected effort through unchanged; an unmapped model, an unsupported model, or an unsupported effort fails closed with a precise unsupported-capability block rather than silently substituting a different model or effort, and no provider fallback model is ever configured.

Execution runs through a minimal provider-neutral adapter interface. A hermetic fake adapter backs deterministic tests and the full proving cycle; a real Claude Code adapter targets the officially supported `claude --print` interface (confirmed available in-environment: model, effort, `--output-format json`, permission and tool controls) with a pure, unit-tested argument builder and an injected process runner. A deterministic run identity plus a run-state lifecycle (`approved → routed → blocked | running → succeeded | failed → handed_off`) prevents duplicate execution: an identical resubmission returns the stored result and an in-flight run fails closed. A successful, patch-producing execution is converted by the unchanged `buildOperatorHandoff`, so `allowAutomaticMerge` stays permanently false; the connector never merges, never opens a PR itself, and never starts another packet. Logs and artifacts are redacted of tokens, cookies, session URLs, environment secrets, and account identifiers, and the provider `session_id` is never surfaced (a provider-neutral execution id is used instead). See `docs/factory/tasks/FACTORY-A1-002.md`.

## Mapping review

Review the model mapping quarterly and whenever a model, vendor, price, account boundary, or measured quality profile changes. Updating the mapping does not amend permanent constitutional roles or authority.
