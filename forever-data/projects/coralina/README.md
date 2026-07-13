# Coralina Source Package

Status: **Classified, not ready for import**

This folder is the official Forever source package for Coralina.

## Classification Result

Coralina source materials from `forever-data/incoming/Coralina/` have been classified into the official source folders.

| Material type | Files |
| ------------- | ----: |
| brochure      |     4 |
| price-list    |     2 |
| masterplan    |    10 |
| unit-plans    |   198 |
| images        |   116 |
| videos        |     3 |
| documents     |    10 |

`source/_needs-review/` exists and is empty for this task.

## Import Safety

`import-status.json` sets `ready_for_import` to `true` for deterministic dry-run planning. This does not authorize execute mode or a database write.

Do not run a real import for Coralina until the reviewed package passes dry-run and a separate execute checkpoint approves the target environment, transaction safety, and rollback behavior. Selling-price THB is an `inferred_default` from source-verified country Thailand, not direct price-list evidence.
