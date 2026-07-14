# FACTORY-A1-001 — Deterministic model router and Operator handoff

## Identity and authority

- **Task ID:** FACTORY-A1-001
- **Title:** Minimal A1 model router and Operator handoff
- **Status:** Implemented — pending Owner review and integration
- **Stage link:** Factory bootstrap (F4/F5 direction in Constitution §26); product stage RC5.5A is untouched.
- **Derives From citation:** Explicit Owner instruction of 2026-07-14 — "FOREVER FACTORY — MINIMAL A1 MODEL ROUTER AND OPERATOR HANDOFF": implement the smallest safe step that advances the existing Factory from A0 toward A1 by adding deterministic Claude model routing and a defined handoff into the existing Operator.
- **Approval record:** Owner-issued packet, 2026-07-14. The instruction itself constitutes packet approval; execution occurred within its stated scope and stop conditions.
- **Completion record:** Implemented on branch `claude/forever-factory-a1-router-xs1p7k` from base `8afc507` (merge of PR #67). No PR was created and no merge occurred; Owner review and merge authorization remain pending.

## Result

- **Objective:** Deterministic Claude model **and effort** routing from approved Task Packet metadata, plus a handoff artifact compatible with the existing Forever Operator v0.1.
- **Finished-result definition:** A tested `src/factory/` library — `routing-table.ts` (replaceable tier-to-model mapping, usage states, and effort levels), `model-router.ts` (`routeTaskPacket`, returning tier + model + effort), `operator-handoff.ts` (`buildOperatorHandoff`, `validateOperatorTask`, carrying selected model + effort + reasons) — with documentation updated to reflect only the implemented capability.
- **In scope:** New `src/factory/` code and tests; `docs/factory/FACTORY_ROUTING_POLICY.md` router and effort sections; `docs/factory/FOREVER_FACTORY_INDEX.md` location/boundary rows; `docs/FOREVER_STATUS.md` Factory and test-suite status; this record.
- **Out of scope:** Any Operator change, new orchestration platform, parallel agent framework, autonomy promotion, automatic model invocation, product RC work, canonical database or import contracts.
- **Acceptance criteria:** Routing follows `max(risk, ambiguity, evidence sensitivity, gate blindness)`; every decision selects tier, model, and effort; bounded retry and one-tier escalation per the two-strike rule; mis-specification and high ambiguity park; Fable is never selected without explicit Owner authorization plus declared available budget; `xhigh` always carries a recorded justification; `max` is never selected without an explicit Owner authorization record; the handoff's embedded task validates against `.forever-factory/task.schema.json`; `allowAutomaticMerge` can never be true; the Operator task contract is unchanged.
- **Expected artifacts:** `src/factory/` (5 files), documentation updates, this record.

## Classification and routing

- **Risk class:** R1 (internal Factory tooling behind deterministic gates; no product truth, schema, or write path touched)
- **Ambiguity level:** Low — the Owner instruction specifies routing rules, escalation, budget, and handoff content explicitly.
- **Evidence sensitivity:** Low — no product or client evidence is asserted.
- **Gate blindness:** Low — TypeScript, tests, lint, and build see the entire change.
- **Selected worker tier:** Engineering (the Owner instruction requested Claude Opus 4.8; the remote Claude Code session executed on the platform-configured Claude model, which the author could not switch — recorded for honest attribution).
- **Selected author:** Claude (remote Claude Code session on branch `claude/forever-factory-a1-router-xs1p7k`)
- **Selected reviewer:** Owner (A0: every merge is Owner-reviewed and Owner-authorized)

## Scope boundaries

- **Allowed paths:** `src/factory/**`, `docs/factory/**`, `docs/FOREVER_STATUS.md`
- **Forbidden paths:** `scripts/forever-operator/**` (unchanged), `.forever-factory/**` contracts (unchanged), `supabase/**`, `src/import/**`, product features.
- **Shared contracts touched:** None. The Operator task contract (`.forever-factory/task.schema.json`) is consumed read-only; the router mirrors it and is hermetically tested against the committed file.

## Execution controls

- **Required gates:** Focused tests, full test suite, TypeScript, changed-file ESLint, production build.
- **Retry budget:** Standard two gate cycles; one was used (initial lint/typecheck corrections).
- **Token/cost budget:** Single session.
- **Stop conditions:** Any Operator rewrite, canonical-contract change, product RC work, or new Factory task — none occurred.
- **Required Ledger updates:** `docs/FOREVER_STATUS.md`, `docs/factory/FACTORY_ROUTING_POLICY.md`, `docs/factory/FOREVER_FACTORY_INDEX.md` — all in this change.

## Records

### Validation record (2026-07-14, fresh clone)

- Focused Factory tests: 2 files / 48 tests passed, covering Sonnet low/medium/high, Opus medium and architecture-sensitive high, Opus xhigh with justification, Fable high and multi-session xhigh, Fable blocked without authorization, max blocked without Owner authorization, max allowed only with explicit authorization, tier exhaustion not bypassing max approval, effort included in the Operator handoff, deterministic model+effort output, and the hermetic proving test approved packet → model selection → handoff artifact → Operator-schema-valid input.
- TypeScript `npx tsc --noEmit`: passed.
- Changed-file ESLint: passed.
- Production build `npm run build`: passed.
- Full suite `npx vitest run`: 231 of 232 files passed (1,743 of 1,746 tests). The 3 failures are the pre-existing, environment-dependent RC5.5A importer integration tests, which require the deliberately gitignored Coralina source documents under `forever-data/projects/coralina/source/*/*`; verified failing identically on the clean base commit `8afc507` before this change. Not caused or touched by this task. The full suite is not "all green"; these three failures are confirmed pre-existing and environment-dependent.

### Completion record

Pending Owner review and integration. No push, PR, merge, database access, or external side effect was performed by this task.
