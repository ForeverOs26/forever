# Changelog

## v0.1.0

- FDB-001 completed.
- FDB-002 completed for Modeva import foundation and validation.
- FDB-003A completed: Forever Import Engine v1 created.
- FDB-003B completed: Modeva dry-run passed.
- FDB-003C completed: Modeva real import/idempotency test passed.
- RC3-001 completed: Import Engine architecture skeleton added with explicit import plans, relationship validation, rollback contract, and state machine.
- RC3-002 completed: first Project-only import stage added with Coralina dry-run blocked safely by readiness validation.
- RC3-003 completed: Buildings-only Import Engine stage added after Project for source-backed dry-run planning.
- FDM-001 completed.
- FDM-002 completed.

## Notes

- FDB-001 added the Forever Core Database foundation as additive Supabase migrations.
- FDB-002 established Modeva extraction, unit import prerequisites, import migration, and validation.
- FDB-003 created the reusable Import Engine and proved Modeva remains idempotent at 7 buildings, 289 units, and 289 price history rows with no duplicates.
- RC3-001 hardened the Import Engine boundary around manifest validation, extracted dataset loading, import planning, relationship validation, dry-run safety, rollback preparation, and database insertion separation.
- RC3-002 loads Coralina extracted datasets, creates a canonical internal Project object only after readiness passes, returns a blocked summary when readiness fails, and does not import units, buildings, media, relationships, Intelligence, or Passport data.
- RC3-003 derives canonical Building objects from source-backed price-list building facts, appends Building operations after Project in dry-run plans, keeps Units and Prices at zero, and leaves Coralina blocked until readiness blockers are resolved.
- FDM-001 created the Modeva source material folder structure.
- FDM-002 created the Forever project import manifest standard.
