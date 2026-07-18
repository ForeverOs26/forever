# Forever draft-import simplification report

## R2 integration record

- Branch: `codex/draft-import-simplification`
- Primary refactor commit: `964c600 refactor(operations): simplify draft project imports`
- Pull request: opened from this branch after the Ledger integration commit; independent review and Owner approval are required before merge because this is an R2 shared write pathway.
- Production connection: none during simplification.
- Coralina import: not performed outside the disposable PostgreSQL 17.6 validation database.

## Canonical Ledger updates

- `docs/CURRENT_STAGE.md` sets the next checkpoint to Owner-authorized Coralina draft import through the generic importer, with publication later and separate.
- `docs/ROADMAP.md` classifies RC5.5C/RC5.5D as historical or exceptional maintenance capability and records the normal generic-import sequence.
- `docs/FOREVER_STATUS.md` records the R2 review/Owner-approval gate, no production connection, no Coralina production import, and Factory A0.
- `docs/DECISIONS.md` records the durable generic-import decision and the separate exceptional-maintenance boundary.

## Complete changed-file list

- `FOREVER_DRAFT_IMPORT_SIMPLIFICATION_REPORT_FINAL.md`
- `Import Forever Project Draft.cmd`
- `docs/CURRENT_STAGE.md`
- `docs/CORALINA_RC5_3_EVIDENCE_AUDIT.md`
- `docs/DECISIONS.md`
- `docs/DRAFT_PROJECT_IMPORTS.md`
- `docs/FOREVER_STATUS.md`
- `docs/ROADMAP.md`
- `docs/RC3_RELEASE_REVIEW.md`
- `docs/progressive-ingestion/README.md`
- `scripts/import/Import-ForeverProjectDraft.ps1`
- `scripts/import/Start-ForeverProjectDraftImport.ps1`
- `scripts/import/tests/fixtures/rollback-check.json`
- `src/features/forever-ingestion/tests/draft-importer.test.ts`
- `src/features/forever-ingestion/tests/migration-contract.test.ts`

## Complete deleted-file list

- `PROGRESSIVE_PRODUCTION_VERIFICATION_HARNESS_FINAL_REPORT.md`
- `docs/CORALINA_IMPORT_VALIDATION.md`
- `docs/legacy-controlled-sql/20260718100000_coralina_prerequisite_execution_boundary.sql`
- `docs/legacy-controlled-sql/README.md`
- `docs/progressive-ingestion/FOREVER_PROGRESSIVE_INGESTION_INTEGRATION_REPORT_FINAL.md`
- `scripts/coralina/New-CoralinaProgressiveSession.ps1`
- `scripts/coralina/coralina-progressive-session.template.sql`
- `scripts/coralina/tests/coralina-temp-payload-role-boundary-postgres17.sql`
- `scripts/production/progressive-ingestion-baseline.sql`
- `scripts/production/progressive-ingestion-postflight.sql`
- `scripts/production/progressive-ingestion-preflight.sql`
- `scripts/production/progressive-ingestion-smoke.sql`
- `scripts/production/progressive-ingestion-zero-residue.sql`
- `scripts/production/tests/progressive-ingestion-harness-postgres17-regression.sql`
- `scripts/production/tests/verify-progressive-ingestion-harness.ps1`
- `scripts/production/verify-progressive-ingestion-production.ps1`
- `src/features/forever-ingestion/tests/coralina-progressive-payload.test.ts`
- `src/features/forever-ingestion/tests/production-harness.test.ts`
- `src/features/forever-ingestion/tests/production-preflight.test.ts`
- `src/import/prerequisite-execution.test.ts`

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
