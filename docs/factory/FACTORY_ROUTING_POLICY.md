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

## Mapping review

Review the model mapping quarterly and whenever a model, vendor, price, account boundary, or measured quality profile changes. Updating the mapping does not amend permanent constitutional roles or authority.
