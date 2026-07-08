# Coralina Final Blockers

Task ID: COR-004B

Audit date: 2026-07-09

Status: Documentation-only re-audit after COR-004A and documentation path fix.

## Scope

This audit reviewed Coralina import readiness using:

- `docs/FOREVER_DOC_INDEX.md`
- `docs/CODEX_OPERATING_MANUAL.md`
- `docs/KNOWLEDGE_MODEL.md`
- `docs/DATA_STANDARD.md`
- `docs/CORALINA_READINESS_AUDIT.md`
- `docs/CORALINA_METADATA_FIX_REPORT.md`
- `forever-data/projects/coralina/manifest.json`
- `forever-data/projects/coralina/import-status.json`
- `forever-data/projects/coralina/extracted/*.json`

No app code, database files, migrations, UI files, import flags, or source data were changed. No real import was run.

## Current Readiness Score

**72 / 100**

Status: **Review Required / not ready for real import**

| Area | Score | Notes |
| --- | ---: | --- |
| Required core fields | 18 / 25 | Project name, slug, type, province, and location are source-backed. Developer and country remain `SOURCE_PENDING`. |
| Source evidence | 19 / 20 | Source package and extracted references remain materially complete. |
| Inventory completeness | 18 / 20 | 198 unit rows, 198 unique unit numbers, and buildings A-H are present. |
| Pricing completeness | 13 / 15 | Price-list date is now ISO-normalized to `2026-07-03`; all 198 unit rows still have null extracted currency. |
| Verification completeness | 4 / 10 | Coordinates, construction status, completion date, legal status, and ownership remain unverified or null. |
| Intelligence/import readiness | 0 / 10 | `ready_for_import` remains false, correctly blocking real import. |

## What Still Prevents `ready_for_import=true`

Coralina still must not be marked `ready_for_import=true`.

The exact hard blockers are:

1. `developer` remains `SOURCE_PENDING` in `forever-data/projects/coralina/manifest.json`.
2. `country` remains `SOURCE_PENDING` in `forever-data/projects/coralina/manifest.json`.
3. `import-status.json` still records `ready_for_import: false` and validation errors for unresolved manifest identity values.

Coordinates and construction status remain unresolved evidence gaps, but they are null optional project metadata under the current Data Standard. They should be resolved if source evidence exists, but the manifest identity blockers are the current reasons real import cannot proceed.

## Exact Fields Still `SOURCE_PENDING`

| File | Field path | Current value | Import impact |
| --- | --- | --- | --- |
| `forever-data/projects/coralina/manifest.json` | `developer` | `SOURCE_PENDING` | Hard blocker. Required developer identity cannot be imported. |
| `forever-data/projects/coralina/manifest.json` | `country` | `SOURCE_PENDING` | Hard blocker. Required country cannot be imported. |
| `forever-data/projects/coralina/manifest.json` | `metadata_evidence.developer_review.value` | `SOURCE_PENDING` | Confirms developer evidence remains unresolved. |
| `forever-data/projects/coralina/manifest.json` | `metadata_evidence.country_review.value` | `SOURCE_PENDING` | Confirms country evidence remains unresolved. |
| `forever-data/projects/coralina/import-status.json` | `mandatory_metadata_review.still_blocked[].field=developer.current_value` | `SOURCE_PENDING` | Mirrors the hard developer blocker. |
| `forever-data/projects/coralina/import-status.json` | `mandatory_metadata_review.still_blocked[].field=country.current_value` | `SOURCE_PENDING` | Mirrors the hard country blocker. |

No `SOURCE_PENDING` values were found in `forever-data/projects/coralina/extracted/*.json`.

## Remaining Non-`SOURCE_PENDING` Evidence Gaps

| File | Field path | Current value | Import impact |
| --- | --- | --- | --- |
| `forever-data/projects/coralina/extracted/brochure.json` | `developer.value` | `null` | Supports the developer blocker. |
| `forever-data/projects/coralina/extracted/brochure.json` | `location.country.value` | `null` | Supports the country blocker. |
| `forever-data/projects/coralina/extracted/brochure.json` | `completion.value` | `null` | Verification gap; not the current hard manifest blocker. |
| `forever-data/projects/coralina/extracted/brochure.json` | `ownership.value` | `null` | Verification gap; not the current hard manifest blocker. |
| `forever-data/projects/coralina/extracted/price-list.json` | `unit_inventory[*].currency.value` | `null` for 198 / 198 rows | Pricing metadata gap. Import Engine v1 may default Phuket pricing to THB, but the extracted field itself is not source-backed. |
| `forever-data/projects/coralina/manifest.json` | `metadata_evidence.coordinates_review.value` | `null` | Location verification gap. |
| `forever-data/projects/coralina/manifest.json` | `metadata_evidence.construction_status_review.value` | `null` | Construction verification gap. |
| `forever-data/projects/coralina/import-status.json` | `mandatory_metadata_review.still_blocked[].field=coordinates.current_value` | `null` | Review gap named by import status. |
| `forever-data/projects/coralina/import-status.json` | `mandatory_metadata_review.still_blocked[].field=construction_status.current_value` | `null` | Review gap named by import status. |

## Exact Source Evidence Needed

| Missing fact | Evidence needed |
| --- | --- |
| Developer | A Coralina-specific brochure page, company profile page, sales sheet, contract page, legal/developer document, or official developer statement that explicitly names Coralina's developer. The reviewed local material shows The Title branding plus AssetWise and Rhom Bho Property company-profile branding, but does not explicitly state Coralina's developer. |
| Country | A Coralina-specific address, location, map, brochure, legal document, or developer document that explicitly states the country. Existing reviewed evidence states Kamala and Phuket, but not the country. |
| Coordinates | A Coralina-specific map, address page, GIS export, official listing, or source document that provides latitude/longitude or GPS coordinates. |
| Construction status / completion | A Coralina-specific construction update, completion schedule, permit, inspection document, sales sheet, or developer document that states construction status or completion date. |
| Currency | A price-list page, pricing note, sales sheet, booking form, or official pricing document that explicitly labels the price currency, or a documented import policy confirming the THB default is intentionally applied for this dataset. |
| Ownership / legal verification | A Coralina-specific ownership, title, EIA, permit, contract, or legal verification document if Gold Standard readiness is required. |

## Real Import Possibility

Real import is **not possible now** under the current readiness rules.

The import package has strong source coverage, normalized price-list date, complete unit identity coverage, and no duplicate unit numbers, but the manifest still contains required identity placeholders. Importing now would create canonical records with unresolved developer and country identity.

## Next Recommended Action

Perform a targeted source-evidence pass for developer and country only.

Priority order:

1. Visually review or OCR the Coralina brochure, company profile, maps, sales sheets, and any contract/legal source pages for an explicit developer name and country.
2. If explicit Coralina-specific evidence is found, update `manifest.json`, `import-status.json`, and the relevant extracted evidence JSON with source file, page, and confidence.
3. Re-run JSON validation and an Import Engine dry-run after the identity fields are fixed.
4. Keep `ready_for_import=false` until dry-run validation passes and the readiness gate is intentionally updated.

## Validation Performed

- Parsed `manifest.json`, `import-status.json`, and all six extracted JSON files successfully.
- Searched `manifest.json`, `import-status.json`, and `extracted/*.json` for `SOURCE_PENDING`.
- Verified `price-list.json` has `price_list_date.value: "2026-07-03"`.
- Verified `price-list.json` has 198 unit rows, 198 unique unit numbers, 0 duplicate unit numbers, and buildings A-H.
- Verified all 198 price-list unit rows still have `currency.value: null`.

No real import was run.
