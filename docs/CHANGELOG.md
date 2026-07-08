# Changelog

## v0.1.0

- FDB-001 completed.
- FDB-002 completed for Modeva import foundation and validation.
- FDB-003A completed: Forever Import Engine v1 created.
- FDB-003B completed: Modeva dry-run passed.
- FDB-003C completed: Modeva real import/idempotency test passed.
- RC3-001 completed: Import Engine architecture skeleton added with explicit import plans, relationship validation, rollback contract, and state machine.
- FDM-001 completed.
- FDM-002 completed.

## Notes

- FDB-001 added the Forever Core Database foundation as additive Supabase migrations.
- FDB-002 established Modeva extraction, unit import prerequisites, import migration, and validation.
- FDB-003 created the reusable Import Engine and proved Modeva remains idempotent at 7 buildings, 289 units, and 289 price history rows with no duplicates.
- RC3-001 hardened the Import Engine boundary around manifest validation, extracted dataset loading, import planning, relationship validation, dry-run safety, rollback preparation, and database insertion separation.
- FDM-001 created the Modeva source material folder structure.
- FDM-002 created the Forever project import manifest standard.
