# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-15

## Stage name

RC5.5 Coralina safe execution, current bounded slice RC5.5B Read-Only Target Collision Inspection.

## Objective

Add a safe, deterministic, read-only collision-inspection boundary between the RC5.5A plan fingerprint / target preflight and any future write. An explicitly requested inspection reads only the rows required to compare the approved Import Plan with the existing target, produces a deterministic collision report, proves zero writes, and terminates at the existing execute-disabled boundary. RC5.5A is closed as Completed and merged: deterministic plan fingerprints, typed dry-run receipts, and pure fail-closed preflight guards are present; Coralina's dry-run remains 405 operations (1 project, 8 buildings, 198 units, and 198 price-history rows).

## Current authorization

RC5.5B is authorized for code, hermetic tests, a read-only reader interface, an optional read-only Supabase adapter, CLI/importer integration, and canonical documentation only. It may build the same approved plan, re-run the RC5.5A preflight, and — only on an explicit `--inspect-collisions` request against the approved local identity — issue bounded select-only queries to classify each planned operation against the target. It may not create a Supabase client during dry-run, insert, upsert, update, delete, run a mutation RPC, change schema, run a transaction or rollback, or enable execute mode.

This packet does not authorize supplying or reading real credentials in the Claude Web environment, running a real database inspection from Claude Web, or any production or staging access. A real local read-only proving run is a separate Owner checkpoint after RC5.5B is reviewed and merged.

Production is blocked unconditionally. Staging remains blocked until an approved non-secret project identity is configured. Local preflight and inspection require the committed local-only identity. A successful collision inspection still terminates before any mutation and never enables execute mode.

## Active tasks

| Task                                                                    | Owner             | Slice  | Status                                    |
| ----------------------------------------------------------------------- | ----------------- | ------ | ----------------------------------------- |
| Deterministic operation-plan SHA-256 fingerprint and dry-run receipt    | Codex             | RC5.5A | Completed and merged                      |
| Explicit local, staging, and production target model                    | Codex             | RC5.5A | Completed and merged                      |
| Pure fail-closed preflight and CLI/importer integration                 | Codex             | RC5.5A | Completed and merged                      |
| Read-only `CollisionInspectionReader` and Supabase read adapter         | Claude            | RC5.5B | Implemented — pending Owner review        |
| Deterministic collision inspector, report, and CLI/importer integration | Claude            | RC5.5B | Implemented — pending Owner review        |
| Owner / Architect review and merge of the RC5.5B read-only boundary     | Owner / Architect | RC5.5B | Pending                                   |
| Real local read-only proving run against the approved local target      | Owner             | RC5.5B | Pending (separate checkpoint after merge) |

## Acceptance criteria

- Dry-run behavior is unchanged: it creates no Supabase client, makes no network request, and performs no database read or write.
- `--inspect-collisions` requires the full RC5.5A target/hash/confirmation boundary, performs only approved read queries, and stops successfully or with a structured inspection blocker.
- Ambiguous or incompatible combinations fail closed: `--dry-run` with `--inspect-collisions`, inspection without target/hash/confirmation, production, unconfigured staging, and invalid local identity.
- The inspector reads only the entities present in the plan, using bounded/batched reads and no unbounded table scans.
- Findings are deterministic and stable regardless of target-row return order and are classified as `absent`, `exact_match`, `update_required`, `duplicate_target_rows`, `identity_conflict`, or `inspection_error`.
- Multiple rows for a unique natural key, parent/identity mismatch, malformed rows, and read errors fail closed; `update_required` findings never authorize the update.
- Every report states `readOnlyConfirmed: true`, `executeEnabled: false`, and `writesPerformed: 0`; a successful inspection never enters write execution.
- No insert, upsert, update, delete, mutation RPC, schema change, or dependency change occurs, and no reader mutation method is reachable.

## Out of scope

- Owner approval-token validation, approval-record expiry, and permanent-write approval.
- Any mutation, transaction, migration change, rollback execution, repeat-import execution, or permanent write (RC5.5C, separately gated).
- Production or staging credentials, and any real database connection from Claude Web.
- Operator, Factory autonomy, router, connector, Continue Forever, public website, and UI work.

## Next slices and checkpoints

RC5.5C migration and transaction-backed execution/rollback require separate approval. A staging rehearsal and the first permanent Coralina write remain later explicit Owner checkpoints. Factory autonomy remains A0 — Propose only; A1-numbered Factory components exist, but no autonomy promotion has been authorized. Factory work does not block product work.

## Definition of done

RC5.5B is complete only after focused and regression tests, TypeScript, changed-file lint, formatting, build, security/privacy/hygiene checks, human review, and integration. Completion does not authorize merge on its own, a real database inspection, execute mode, RC5.5C, staging rehearsal, or a permanent write.
