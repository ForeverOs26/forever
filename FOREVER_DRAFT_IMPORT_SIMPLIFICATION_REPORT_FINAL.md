# Forever draft-import simplification report

## Outcome

The ordinary import path is now one generic PowerShell importer:

- `scripts/import/Import-ForeverProjectDraft.ps1`
- `Import Forever Project Draft.cmd`

It accepts a project key or a payload path, validates the draft payload, uses
`PGSSLMODE=verify-full` plus the supplied official CA for normal use, invokes
`public.forever_progressive_ingest(jsonb)` once in one transaction, checks the
expected graph before its single commit, then performs a short post-commit
draft check. The payload is sent to `psql` over standard input rather than a
command-line argument. The interactive launcher obtains the password only with
`Read-Host -AsSecureString` in a visible PowerShell window.

No production or linked database connection was opened. No Coralina production
import was attempted.

## Disposable PostgreSQL 17.6 validation

The full repository migration chain was applied to a disposable local
PostgreSQL 17.6 container (with minimal local role/storage bootstrap). The
generic importer was exercised with
`forever-data/projects/coralina/progressive/payload.json`.

| Check | Result |
| --- | --- |
| Payload SHA-256 | `2d5613a35705b251f20208aa4273038c2d8001bebe5d2c5bab5e55cb653e6605` |
| Batch fingerprint | `9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c` |
| Atomic import | passed |
| Draft/public isolation | passed; `anon` saw zero Coralina rows |
| Graph | 1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 batch, 0 media, 0 documents |
| Duplicate execution | stopped before the RPC with `draft_import_duplicate_slug` |
| Forced post-RPC failure | rolled back; zero `rollback-check` project rows remained |
| Focused PostgreSQL regressions | RPC search-path and catalog array-aggregate checks passed |

## Removed tracked operational paths

- Coralina session generator, SQL template, and temporary-payload role test.
- The ordinary-import production verifier, its preflight/postflight/baseline/
  smoke/zero-residue scripts, and harness tests.
- The retired RC5.6P prerequisite SQL archive and test.
- Stale Coralina import-validation instructions.

The Coralina payload/source evidence, the canonical progressive migration, and
the reusable progressive tests remain.

## Reviewed untracked-artifact deletion list

The following pre-existing untracked artifacts were deliberately **not**
deleted or staged. They need an owner review before any cleanup:

1. `CLAUDE_HANDOFF_PROGRESSIVE_INGESTION.zip` and the two
   `CLAUDE_*HANDOFF*` directories.
2. Root `CORALINA_*.md` reports and `CORALINA_FIRST_IMPORT_*.json` payload
   candidates.
3. Root `PROGRESSIVE_*.md`, `RC5_*.md`, and `RC56P_*.md` historical reports.
4. The untracked `investigation/` directory.

These were excluded from this change because they are generated evidence and
may be needed for audit/history even though they are obsolete as operational
workflows.

## Proportional validation

- Offline generic payload validation: passed.
- Focused Vitest: 21/21 passed.
- TypeScript `tsc --noEmit`: passed.
- Production build: passed.
- Disposable PostgreSQL 17.6 import/duplicate/rollback checks: passed.

The payload and canonical migration were read-only during this work; their
tracked SHA-256 values remain unchanged.
