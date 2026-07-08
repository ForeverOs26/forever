# Modeva Import Validation

Task ID: FDB-002D

Validation date: 2026-07-08

## Validation Summary

Modeva import artifacts were validated against the repository migration chain and extracted price-list source data.

The import migration is structurally consistent with the reviewed extraction:

- Modeva project seed exists.
- Developer and location relationships are seeded.
- Buildings A-G are defined.
- 289 reviewed unit rows are embedded in the import migration.
- 289 price-history rows are expected from the same source rows.
- Import logic uses idempotent upsert/update patterns.
- Production website build passes when invoked directly through the local Vite binary.

Important limitation: this validation did not apply migrations to a live Supabase database and did not query actual database counts. The Supabase CLI was not available in the local environment, and the task explicitly prohibited schema changes during validation.

## Passed Checks

1. Modeva Project Exists

- Passed by migration-chain validation.
- `20260707103000_fdb001_seed_title_bang_tao_modeva.sql` seeds project slug `modeva`.

2. Developer Relationship

- Passed by migration-chain validation.
- Modeva seed resolves `developer_id` through the `developer_seed` CTE for `Title`.

3. Location Relationship

- Passed by migration-chain validation.
- Modeva seed resolves `location_id` through the `location_seed` CTE for `Bang Tao`.

4. Buildings A-G

- Passed by import migration validation.
- `20260707105000_fdb002c_import_modeva_units.sql` defines 7 buildings:
  - Building A: 56 units
  - Building B: 8 units
  - Building C: 38 units
  - Building D: 71 units
  - Building E: 18 units
  - Building F: 76 units
  - Building G: 22 units

5. Unit Inventory Count

- Passed by source-to-migration validation.
- Extracted rows in `price-list.json`: 289
- Embedded source rows in import migration: 289

6. Price History Count

- Passed by import logic validation.
- Import migration derives one `unit_price_history` row from each resolved unit row.
- Expected price-history rows: 289

7. Foreign Key Path

- Passed by static validation.
- Buildings resolve through `projects.slug = 'modeva'`.
- Units resolve `project_id` and `building_id` before insert.
- Price history resolves `unit_id` from affected inserted/updated units.

8. Idempotency

- Passed by SQL structure validation.
- Buildings use `ON CONFLICT (project_id, building_code) DO UPDATE`.
- Units use update-then-insert behavior based on `(project_id, unit_code)`.
- Price history uses `ON CONFLICT (unit_id, price_source, source_file, source_page, price_list_date) DO UPDATE`.

9. Normalization Decisions

- Passed by import migration validation.
- Currency: `THB`
- Price list date: `2026-07-03`
- Status: `Available` normalized to `available`

10. Website Build

- Passed.
- Direct build command used:
  - `node node_modules/vite/bin/vite.js build`
- Result: production build completed successfully.

## Failed Checks

No static validation checks failed.

The following checks could not be fully executed because no live database was available:

- Actual database count for Modeva buildings.
- Actual database count for Modeva units.
- Actual database count for Modeva price history records.
- Runtime orphan-record query.
- Runtime foreign-key query.
- Runtime double-run idempotency verification.

## Warnings

- Supabase CLI was not available locally, so migrations were not applied to a database during this validation milestone.
- The normal `npm run build` path could not be used because system `npm` was not available.
- The bundled `pnpm run build` path attempted dependency installation and failed under restricted network access.
- Build validation succeeded by directly invoking the existing local Vite binary.
- The current `units` table uses `base_price_thb`, not `price`; the Modeva import correctly writes unit price into `base_price_thb` and writes historical prices into `unit_price_history.price`.
- Actual production readiness still requires applying migrations in a controlled Supabase environment and running SQL count/orphan/idempotency checks there.

## Recommendations

Before marking the import fully production-ready:

1. Apply all FDB migrations to a clean staging Supabase database.
2. Run count checks:
   - 1 Modeva project
   - 1 Title developer relationship
   - 1 Bang Tao location relationship
   - 7 Modeva buildings
   - 289 Modeva units
   - 289 Modeva price-history rows
3. Run orphan checks for buildings, units, and price history.
4. Run the FDB-002C import migration twice in staging and confirm counts remain stable.
5. Decide whether a database-level unique constraint should be added for `units(project_id, unit_code)` in a future additive migration.
6. Keep `base_price_thb` as the unit snapshot price unless the architecture formally adds a generic `units.price` column.

## Final Verdict

NEEDS FIXES

Reason: repository-level validation passed, and the website builds successfully, but live database validation was not executed. The import should not be called production-ready until it has been applied and queried in a controlled Supabase environment.
