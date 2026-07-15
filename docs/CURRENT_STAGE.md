# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-15

## Stage name

RC5.5 Coralina safe execution, current bounded slice RC5.5C Transactional Execution and Rollback Preparation.

## Objective

Prepare — without enabling — transaction-backed import execution: a single-transaction boundary that applies one approved plan atomically, verifies every persisted row against the shared persistence projections before commit, rolls back automatically on any failure, and returns a deterministic sanitized execution receipt. RC5.5B is closed as Completed, merged, and locally proven: the Owner's read-only proving run against the reconciled canonical local target reported Coralina as 405 `absent` operations (1 project, 8 buildings, 198 units, 198 price-history rows) with zero collisions, duplicates, identity conflicts, or inspection errors.

## Current authorization

RC5.5C is authorized for code, hermetic tests, and canonical documentation only: a narrow typed transaction/mutation abstraction, an Owner execution-approval artifact contract (explicit scope, short-lived, single-use, fail-closed), deterministic transaction ordering and in-transaction verification, automatic rollback semantics, a typed execution receipt, and an explicit `--execute-approved-import` CLI mode that fails closed before any transaction, database client, network access, or approval consumption when anything is missing or mismatched.

This slice does not authorize any real database execution. The live transaction runner is structurally defined but fails closed (`live_execution_disabled`) before reading any credential or creating any client. No migration runs, no real import occurs, and real database writes remain zero. The first real Coralina import remains a separate explicit Owner checkpoint with its own approval artifact and credential boundary.

Production is blocked unconditionally. Staging remains blocked until an approved non-secret project identity is configured. Only the approved local identity passes preflight in hermetic tests. Dry-run and collision inspection behavior are unchanged.

## Active tasks

| Task                                                                      | Owner             | Slice   | Status                             |
| ------------------------------------------------------------------------- | ----------------- | ------- | ---------------------------------- |
| Read-only collision inspection (reader, inspector, CLI, hermetic proof)   | Claude            | RC5.5B  | Completed and merged               |
| Real local read-only proving run against the approved local target        | Owner             | RC5.5B  | Completed (405 absent, 0 blockers) |
| Transaction boundary, approval contract, receipt, rollback, CLI mode      | Claude            | RC5.5C  | Implemented — pending Owner review |
| Owner / Architect review and integration of the RC5.5C preparation slice  | Owner / Architect | RC5.5C  | Pending                            |
| First real Coralina import (live adapter, credentials, approval issuance) | Owner             | RC5.5C+ | Pending (separate checkpoint)      |

## Acceptance criteria

- One transaction per approved plan; all operations apply inside it in canonical order (dependencies read first, then project, buildings, units, price history); commit only after in-transaction verification succeeds; any failure rolls back; partial success is impossible.
- Execution requires an explicit `--execute-approved-import` request plus target, fresh plan hash, confirmation, successful RC5.5A preflight, a fresh unblocked all-`absent` RC5.5B collision report, and a valid Owner approval artifact bound to project slug, target identity, plan hash, operation count, collision-report fingerprint, issue/expiry timestamps, and a one-time-use id.
- Approval artifacts are fail-closed when missing, malformed, expired, not yet valid, over-lifetime, reused, out of scope, or schema-unsupported. Single use is enforced atomically at the execution-attempt boundary through the asynchronous, durable-ready `consumeIfUnused` compare-and-set — of any number of concurrent attempts exactly one confirmed CAS winner can proceed; requests rejected earlier never consume, a rolled-back winner remains consumed, and a registry infrastructure failure is contained (`approval_registry_unavailable`: runner never invoked, raw error discarded, approval truthfully unconsumed). The in-memory registry is hermetic test infrastructure only; any future live implementation requires a durable atomic backing store. The raw approval id is used internally for atomic consumption only and never appears in a receipt or log: every external surface carries only a deterministic domain-separated SHA-256 digest (`forever-import-approval:v1`), or null when no format-safe id existed.
- Runner-level failures never escape and are never misclassified: any runner-level throw or malformed runner outcome — before or after the work callback, since a runner may begin a transaction before invoking work — yields the truthful `failed_rollback_unconfirmed` outcome with neither commit nor rollback confirmed and `writesPerformed: null` (the receipt never claims zero writes when the transaction outcome is unknown); `rejected_before_transaction` is reserved exclusively for executor gates that fail before the runner is invoked. All rollback reason codes come from a closed stable-code whitelist; anything else collapses to `adapter_failure`.
- Repeat execution fails closed: any non-`absent` target state (`exact_match`, `update_required`, mixed) is rejected before the transaction, and in-transaction state drift after inspection rolls back (`target_state_changed`).
- The mutation surface is typed and entity-specific — no generic table access, raw SQL, generic RPC, or delete — and the write path reuses the shared RC5.5B persistence projections, preserving undefined/null `building_id` semantics and persistence-key contracts (`sourceRow` excluded).
- Receipts and rollback reasons are deterministic, sanitized stable codes; no provider message, credential, URL, SQL text, or raw row data can appear in a receipt or the logger.
- Dry-run remains client-, read-, network-, and write-free; collision inspection remains select-only; no service-role key is read anywhere in this slice.

## Out of scope

- Live transaction adapter implementation, execution credentials, and real approval issuance/storage.
- Any real import, migration, schema change, production or staging access.
- Repeat-import/update execution contracts (a future separately approved slice).
- Operator, Factory autonomy, public website, and UI work.

## Next slices and checkpoints

The first real Coralina import requires a separate Owner checkpoint: live adapter enablement with an isolated explicit credential boundary, a real approval artifact, and a fresh collision inspection immediately before execution. A staging rehearsal remains a later explicit Owner checkpoint. Factory autonomy remains A0 — Propose only; A1-numbered Factory components exist, but no autonomy promotion has been authorized.

## Definition of done

RC5.5C preparation is complete only after focused and regression tests, TypeScript, changed-file lint, formatting, build, security/privacy/hygiene checks, human review, and integration. Completion does not authorize live execution, the first permanent write, staging rehearsal, or any later slice.
