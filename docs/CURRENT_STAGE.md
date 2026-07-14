# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-13

## Stage name

RC5.5 Coralina safe execution, current bounded slice RC5.5A Target and Preflight Guards.

## Objective

Establish deterministic operation-plan fingerprinting, explicit import targets, and pure fail-closed preflight guards before any database access is authorized. RC5.4 is closed as Completed: Coralina is source-verified, readiness is `ready`, and its dry-run remains 405 operations (1 project, 8 buildings, 198 units, and 198 price-history rows).

## Current authorization

RC5.5A is authorized for code, tests, CLI/importer integration, and canonical documentation only. It may build and validate an in-memory plan, calculate its SHA-256 fingerprint, return a non-persistent dry-run receipt, and evaluate non-secret target identity. It may not create a Supabase client, read a service-role key, make a network request, query a database, or write a database.

Production is blocked unconditionally. Staging remains blocked until an approved non-secret project identity is configured. Local preflight requires the committed local-only identity. A successful preflight still terminates at the existing execute-disabled boundary.

## Active tasks

| Task                                                                 | Owner             | Slice  | Status    |
| -------------------------------------------------------------------- | ----------------- | ------ | --------- |
| Deterministic operation-plan SHA-256 fingerprint and dry-run receipt | Codex             | RC5.5A | In review |
| Explicit local, staging, and production target model                 | Codex             | RC5.5A | In review |
| Pure fail-closed preflight and CLI/importer integration              | Codex             | RC5.5A | In review |
| Owner / Architect review of the R2 safety boundary                   | Owner / Architect | RC5.5A | Pending   |

## Acceptance criteria

- Equivalent write operations produce the same plan hash regardless of dry-run/execute mode, runtime timestamps, rollback notes, or object-key insertion order.
- Operation payload, natural key, action, dependency, source version, count, or operation order changes alter or fail validation against the fingerprint contract.
- Missing or unknown targets fail closed; production is always blocked; staging is unconfigured; local requires its local-safe identity.
- Coralina remains ready with exactly 405 operations and a receipt whose `executeEnabled` value is `false`.
- No database client, connection, query, write, schema change, dependency change, or network call occurs.
- Execute mode remains disabled after every preflight check.

## Out of scope

- Owner approval-token validation, approval-record expiry, dry-run freshness, and permanent-write approval.
- Existing-record or collision queries.
- Transactions, migration changes, rollback execution, repeat-import execution, and permanent writes.
- Production or staging credentials.
- Operator, Factory autonomy, public website, and UI work.

## Next slices and checkpoints

RC5.5B is the next separately approved, read-only collision-inspection slice. RC5.5C migration and transactional execution require separate approval. A staging rehearsal and the first permanent Coralina write remain later explicit Owner checkpoints. Factory remains at A0 and does not block product work.

## Definition of done

RC5.5A is complete only after focused and regression tests, TypeScript, lint, formatting, build, security/privacy/hygiene checks, human review, and a draft PR. Completion does not authorize merge, database access, execute mode, RC5.5B, RC5.5C, staging rehearsal, or a permanent write.
