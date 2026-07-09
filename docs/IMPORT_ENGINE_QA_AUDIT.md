# Import Engine QA Audit

Task ID: RC3-006

Date: 2026-07-09

Status: Documentation-only QA audit after RC3-005

## Scope

This audit reviewed the current Import Engine and the Modeva and Coralina project packages without modifying source code, database schema, migrations, UI, or project data.

Reviewed areas:

- `src/import/`
- `forever-data/projects/modeva/`
- `forever-data/projects/coralina/`

Required validation commands were run:

- `npm.cmd run import coralina -- --dry-run`
- `npm.cmd run import modeva -- --dry-run`
- `npx.cmd tsc --noEmit`

## Current Capability Summary

The Import Engine currently supports a source-backed dry-run import plan for:

- Project
- Buildings
- Units
- Unit Price History

The pipeline currently:

1. Loads and validates `manifest.json`.
2. Loads supported extracted datasets from `extracted/`.
3. Validates package readiness, required folders, required files, extracted JSON, supported manifest version, and required manifest metadata.
4. Blocks packages with `ready_for_import=false` before import plan creation.
5. Blocks required manifest fields that still contain `SOURCE_PENDING`.
6. Creates a deterministic import plan for ready packages.
7. Derives buildings from source-backed price-list rows.
8. Creates units from canonical unit-plan rows when available, otherwise from source-backed price-list inventory.
9. Creates price-history rows from source-backed price-list rows.
10. Validates duplicate keys, orphan relationships, missing numeric prices, missing price dates, and currency presence.
11. Completes dry-runs without creating a Supabase client or performing database writes.
12. Blocks execute mode for the current Project + Buildings + Units + Price History stage.

The current stage intentionally does not import:

- Media
- Documents
- Source records
- Project assets
- Relationships beyond plan dependencies
- Intelligence
- Passport snapshots

## Dry-Run Results

### Coralina

Command:

```text
npm.cmd run import coralina -- --dry-run
```

Result:

```text
Project: coralina
Status: blocked
Ready: false
Operations: 0
Buildings: 0
Units: 0
Prices: 0
Skipped: 0
```

Validation issues:

```text
error: manifest_metadata_source_pending - Required manifest metadata developer is still SOURCE_PENDING.
error: manifest_metadata_source_pending - Required manifest metadata country is still SOURCE_PENDING.
error: import_status_not_ready - import-status.json does not mark the project ready for import.
```

Assessment: Pass. Coralina is correctly blocked before import plan creation because required source-backed identity fields are unresolved and `ready_for_import` remains false.

### Modeva

Command:

```text
npm.cmd run import modeva -- --dry-run
```

Result:

```text
Project: modeva
Status: dry_run_completed
Ready: true
Operations: 586
Buildings: 7
Units: 289
Prices: 289
Skipped: 0
```

Warning:

```text
Plan validation warning price_history_currency_null: 289 rows.
```

Assessment: Pass. Modeva dry-run creates the expected RC3-005 stage plan:

- 1 Project operation
- 7 Building operations
- 289 Unit operations
- 289 Price History operations
- 586 total operations

Dry-run logging confirms no Supabase client was created and no database writes were performed.

## Stage Verification

### 1. Project Stage

Status: Pass.

The Project stage creates a canonical project object from manifest metadata, validation status, and extracted dataset context. Required manifest metadata is validated before plan creation. Optional facts remain `null` unless source-backed extracted facts exist.

Modeva passes this stage. Coralina is blocked before this stage because `developer` and `country` remain `SOURCE_PENDING`.

### 2. Building Stage

Status: Pass.

Buildings are derived from source-backed `price-list.json` unit inventory rows. Building operations depend on the Project operation. Modeva dry-run plans 7 buildings.

### 3. Unit Stage

Status: Pass with current-stage limitation.

Units are loaded from canonical `unit-plans.json` inventory rows when present. If that dataset does not contain canonical inventory rows, the planner falls back to source-backed price-list inventory while stripping price-specific fields from Unit operations.

Modeva dry-run plans 289 units. Coralina does not reach unit planning because package readiness blocks earlier.

### 4. Price History Stage

Status: Pass with known warning.

Price History rows are derived from source-backed price-list inventory rows, use `developer_price_list` as the source label, preserve the extracted price-list date, and depend on Unit operations.

Modeva dry-run plans 289 price-history rows. All 289 rows emit `price_history_currency_null` warnings because the extraction explicitly contains null currency.

### 5. Dry-Run Behavior

Status: Pass.

Dry-run mode validates, plans, reports counts, and returns before any database client is created. Coralina dry-run blocks safely with zero operations. Modeva dry-run completes with expected counts.

### 6. Execute Mode Blocking

Status: Pass by code audit.

After relationship validation, non-dry-run execution throws:

```text
Project + Buildings + Units + Price History execute mode is not enabled yet. Run dry-run only until this database write path is explicitly approved.
```

This prevents execution of the current RC3-005 stage until an approved write path is added. This audit did not run execute mode because the task forbids database modification.

### 7. SOURCE_PENDING Blocking

Status: Pass.

Required manifest metadata fields are checked for `SOURCE_PENDING`. Coralina correctly blocks on:

- `developer`
- `country`

### 8. Duplicate Prevention

Status: Pass at plan-validation layer.

The plan validator detects duplicate:

- Unit keys
- Building keys
- Price-history source keys

The current dry-run datasets produce no duplicate errors. Database-level idempotency remains outside this audit because execute mode is blocked for the current stage.

### 9. Relationship Validation

Status: Pass.

The plan validator checks:

- Units referencing missing buildings
- Price-history rows referencing missing units
- Missing unit numbers
- Invalid or missing numeric prices
- Missing price dates
- Missing or null currency

Modeva relationship validation emits warnings only, with no blocking errors.

### 10. Error and Warning Reporting

Status: Pass with minor presentation issue.

The Import Engine reports blocked status, readiness, counts, and validation issues clearly. Warnings are grouped by code in dry-run output.

Known presentation issue: `src/import/logger.ts` contains mojibake check/cross symbols in source, although console output in this environment rendered readable checkmarks. This is cosmetic and does not affect import safety.

### 11. No Accidental UI/Database/Migration Dependency

Status: Pass for dry-run.

The import path is isolated under `src/import/`. Dry-run does not create a Supabase client. Database writes are isolated to `src/import/database.ts`, and execute mode is blocked before database writes for the current stage.

No UI files, database migrations, or project data files were modified during this audit.

## Known Warnings

Modeva:

- `price_history_currency_null`: 289 rows.

Interpretation: Current extraction carries explicit null currency values. The dry-run preserves those nulls and reports warnings. The database write layer currently defaults null price-history currency to `THB`, but execute mode is blocked for this stage, so no write occurs.

Coralina:

- `developer` remains `SOURCE_PENDING`.
- `country` remains `SOURCE_PENDING`.
- `ready_for_import` remains false.

These are correct blockers, not importer failures.

## Blockers

Coralina import remains blocked until source-backed values replace:

- `developer`
- `country`

Coralina `import-status.json` must remain false until those required facts are resolved from Coralina-specific sources.

Execute mode for Project + Buildings + Units + Price History remains intentionally blocked pending explicit approval and implementation of the write path for the current stage.

## Risks

- Currency handling needs a policy decision before execute mode resumes for price history. The Data Standard says Phuket imports default to `THB` unless source data proves otherwise, while the current plan validator warns on explicit null currency and the database layer defaults null to `THB` at write time.
- Duplicate prevention is strong in dry-run plan validation, but future execute-mode idempotency should be backed by database constraints wherever safe.
- Coralina is a useful repeatability test because it includes richer extracted datasets than Modeva, but it is not ready to prove import repeatability until required identity blockers are resolved.
- Media and document extraction files exist for Coralina, but the Import Engine does not yet import them. Their schema should be frozen before the next stage to avoid duplicate source-of-truth paths.
- The rollback layer remains a contract/skeleton, not transaction-scoped rollback.

## Recommended Next Stages

1. Resolve Coralina `developer` and `country` only from Coralina-specific source evidence.
2. Re-run Coralina dry-run after updating readiness metadata in a dedicated source-intake task.
3. Decide the currency policy for price-history rows before enabling execute mode for the current stage.
4. Add or verify database-level uniqueness constraints for safe idempotency where schema permits.
5. Define the canonical media/document/source-record model before implementing the media/documents import stage.
6. Keep media/documents as dry-run planning first, with no database writes until relationship validation and duplicate prevention are proven.

## Safe to Continue to Media/Documents Stage?

Yes, with limits.

The Import Engine is safe to continue to a media/documents dry-run planning stage because the current validation, blocked-package behavior, dry-run behavior, duplicate checks, relationship validation, and database-write isolation are working as intended.

It is not yet safe to enable media/documents execute mode. Before any media/document database writes, the project needs an approved canonical model for sources, documents, project assets, images, videos, duplicate handling, visibility, and rollback behavior.

## Testing

```text
npm.cmd run import coralina -- --dry-run
PASS - blocked safely with 0 operations.

npm.cmd run import modeva -- --dry-run
PASS - 586 operations planned: 1 project, 7 buildings, 289 units, 289 price-history rows.

npx.cmd tsc --noEmit
PASS - no TypeScript errors.
```

