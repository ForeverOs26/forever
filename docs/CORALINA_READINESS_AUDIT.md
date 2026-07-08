# Coralina Readiness Audit

Task ID: COR-003

Audit date: 2026-07-08

## Scope

This audit reviewed the Coralina import package before any real import:

- `forever-data/projects/coralina/manifest.json`
- `forever-data/projects/coralina/import-status.json`
- `forever-data/projects/coralina/classification-log.json`
- `forever-data/projects/coralina/extracted/*.json`

No application code, Import Engine code, database files, migrations, UI files, Supabase data, or import readiness flags were changed.

## Required Reading Status

Read successfully:

- `docs/CODEX_OPERATING_MANUAL.md`
- `docs/CODEX_PROJECT_UNDERSTANDING.md`
- `docs/ROADMAP.md`

Missing at requested paths:

- `docs/KNOWLEDGE_MODEL.md`
- `docs/FOREVER_DEVELOPMENT_ROADMAP.md`

Because `docs/KNOWLEDGE_MODEL.md` is absent, this audit used `docs/DATA_STANDARD.md` as the closest available mandatory-field standard for project, developer, location, unit, price-history, document, and media readiness.

## Readiness Score

**64 / 100**

Status: **Review Required / Not ready for real import**

| Area | Score | Notes |
| --- | ---: | --- |
| Required core identity | 13 / 25 | Project name, slug, type, province, and location exist; developer and country remain `SOURCE_PENDING`. |
| Source evidence | 19 / 20 | All 343 classified source files are represented in extracted references; all checked source references resolve locally. |
| Inventory completeness | 18 / 20 | 198 unique room/unit rows; buildings A-H are consistent between price list and unit plans. |
| Pricing completeness | 10 / 15 | Prices exist, but 95 rows do not exactly equal extracted area times extracted price/sqm; price-list date is not ISO-normalized in extracted JSON. |
| Verification completeness | 4 / 10 | Supplemental documents exist, but developer identity, country, coordinates, legal status, construction status, and completion remain unverified. |
| Intelligence/import readiness | 0 / 10 | `ready_for_import` is intentionally false and dry-run stops at the readiness gate. |

## Executive Verdict

Coralina must **not** be marked `ready_for_import=true` yet.

The extraction package is materially present and source-referenced, but real import is blocked by unresolved mandatory identity fields and several missing or inconsistent metadata areas. Enabling import now would create canonical records with unresolved source identity and incomplete location/developer context.

## Audit Findings

### Project Identity

| Field | Current value | Status | File requiring update |
| --- | --- | --- | --- |
| Project name | `Coralina` | Present | n/a |
| Project slug | `coralina` | Present | n/a |
| Developer | `SOURCE_PENDING` | Blocker | `manifest.json`, then `import-status.json` |
| Country | `SOURCE_PENDING` | Blocker | `manifest.json`, then `import-status.json` |
| Province | `Phuket` | Present | n/a |
| Location / area | `Kamala` | Present | n/a |
| Project type | `Residential` | Present, broad | `manifest.json` if a more precise source-backed type is required |
| Source version | `coralina-rc2-2-extraction-2026-07-08` | Present | n/a |
| Import readiness | `false` | Correct | Do not change until blockers are resolved |

### Developer

Developer readiness: **blocked**.

The company profile PDF is classified as a document, but the local machine-readable extraction did not expose a source-backed developer name. The manifest still has `developer: "SOURCE_PENDING"`. This blocks import because the Import Engine uses the manifest developer to upsert a developer record.

Required updates:

- `forever-data/projects/coralina/manifest.json`
- `forever-data/projects/coralina/import-status.json`
- `forever-data/projects/coralina/extracted/brochure.json` or `documents.json` if developer evidence is extracted from source

Recommended fix:

- OCR or visually review `forever-data/projects/coralina/source/documents/1. Company Profile__The Title Company Profile.pdf`.
- Add source-backed developer name and country only after verification.

### Location, Country, and Coordinates

Location readiness: **partially blocked**.

Verified:

- Kamala
- Phuket
- Beach distance: 430 m / 5 mins

Missing:

- Country remains `SOURCE_PENDING`.
- Latitude and longitude are missing.
- District/sub-location details are not structured.

Required updates:

- `forever-data/projects/coralina/manifest.json`
- `forever-data/projects/coralina/import-status.json`
- `forever-data/projects/coralina/extracted/brochure.json`

Recommended fix:

- Extract country from a source-backed brochure/map/company page, or leave it pending.
- Add coordinates only if verified from local source material or an approved source-backed map document.

### Construction Status

Construction readiness: **missing**.

No source-backed construction status, completion date, permit status, or inspection date is currently extracted.

Required updates:

- `forever-data/projects/coralina/extracted/brochure.json`
- `forever-data/projects/coralina/import-status.json`

Recommended fix:

- Review brochure and supplemental documents for construction/completion facts.
- Keep values null unless explicitly verified.

### Unit Consistency

Unit readiness: **strong, with minor semantic caveats**.

Validation results:

- Unit rows extracted: 198
- Unique room/unit numbers: 198
- Duplicate room/unit numbers: 0
- Buildings in price list: A, B, C, D, E, F, G, H
- Buildings in unit/floor plans: A, B, C, D, E, F, G, H
- Required unit import fields exist: room number, unit type, availability status

Observed caveat:

- There are 73 unique developer code types across 198 units. This is expected if `unit_code` represents a plan/type code rather than a unique unit identity, but any validator interpreting `unit_code` literally as unique would report duplicates. The importer uses `unit_number` as the unit identity.

Required updates:

- None for unit identity before dry-run.

Recommended fix:

- Document clearly that `unit_number` is the unit identity and `unit_code` is the developer type/code.

### Price Consistency

Pricing readiness: **review required**.

Validation results:

- Price rows: 198
- Price rows with numeric size, selling price, and price/sqm: 198
- Duplicate unit price-history source keys found locally: 0 by room/source/page/row identity
- Price-list date in extracted JSON: `03.07.26`

Issues:

- `price_list_date` is not normalized to ISO format in `price-list.json`, even though the Data Standard requires `YYYY-MM-DD`. Import Engine v1 normalizes this value during import, but the extracted dataset itself is not standard-normalized.
- 95 rows do not exactly equal `area * price_per_sqm` using the extracted integer area and extracted price/sqm. Differences appear consistent with hidden decimal area values, discounts, or PDF-rendered rounded values, but that cannot be inferred.
- `currency.value` is null on unit rows. Import Engine v1 defaults Phuket imports to THB, but the extracted field itself does not provide source-backed currency.

Required updates:

- `forever-data/projects/coralina/extracted/price-list.json`

Recommended fix:

- Normalize `price_list_date.value` to `2026-07-03` or add a separate normalized field if preserving the raw source value.
- Review mismatched price rows against the PDF or original spreadsheet/source if available.
- Keep currency null unless source-backed, or document that importer-level default THB is being applied.

### Media References

Media readiness: **good for source package; not importer-ready for v1 media persistence**.

Validation results:

- `images.json` records: 119
- Images: 116
- Videos: 3
- Source references resolve locally: yes

Issues:

- Media is not imported by Import Engine v1.
- Some media records rely on filename-derived titles/subcategories rather than page-level source text.

Required updates:

- None for Import Engine v1 core import.
- Future Import Engine v2 work is needed for canonical media persistence.

### Document References

Document readiness: **good for source package; incomplete for legal verification**.

Validation results:

- `documents.json` records: 16
- Classified supplemental document files: 10
- Brochure and price-list documents included in extracted document inventory.
- Source references resolve locally: yes

Issues:

- No legal, EIA, construction permit, ownership, or completion verification document is currently extracted as such.
- Company profile PDF is present but not machine-readable enough to verify developer identity.

Required updates:

- `forever-data/projects/coralina/extracted/documents.json`
- `forever-data/projects/coralina/extracted/brochure.json` if facts are extracted from documents

### Masterplan References

Masterplan readiness: **source-present, detail-limited**.

Validation results:

- `masterplan.json` records: 10 files
- All masterplan source references resolve locally.
- Buildings A-H are reflected through related facility/layout and unit-plan evidence.

Issues:

- Masterplan geometry and detailed labels were not extracted.
- One classified masterplan PDF is approximately 158 MB, which may remain a GitHub/source-control handling concern.

Required updates:

- None for Import Engine v1 core import.
- `masterplan.json` if richer plan semantics are required.

## Relationship Audit

| Relationship | Status | Notes |
| --- | --- | --- |
| Manifest to import-status | Consistent | Status correctly keeps import blocked. |
| Manifest assets to source folders | Consistent | Required and recommended folders are present. |
| Classification log to extracted files | Consistent | All 343 classified source paths are represented by extracted source references. |
| Unit rows to buildings | Consistent | Unit rows map to buildings A-H. |
| Unit/floor plan buildings to unit buildings | Consistent | Unit-plan building labels also cover A-H. |
| Documents to source files | Consistent | No broken local references found. |
| Media to source files | Consistent | No broken local references found. |
| Masterplan to source files | Consistent | No broken local references found. |

## Detected Blockers

1. `developer` remains `SOURCE_PENDING` in `manifest.json`.
2. `country` remains `SOURCE_PENDING` in `manifest.json`.
3. `ready_for_import` remains false in `import-status.json`, correctly blocking import.
4. Coordinates are missing.
5. Construction status and completion date are missing.
6. Price-list date is not ISO-normalized in extracted JSON.
7. 95 price rows require review because extracted area times extracted price/sqm does not exactly equal extracted selling price.
8. Legal/verification documents are not extracted as legal evidence.
9. `docs/KNOWLEDGE_MODEL.md` is missing, so mandatory Knowledge Model verification cannot be completed against that named document.
10. `docs/FOREVER_DEVELOPMENT_ROADMAP.md` is missing at the requested path.

## Files Requiring Updates Before `ready_for_import=true`

Required:

- `forever-data/projects/coralina/manifest.json`
- `forever-data/projects/coralina/import-status.json`
- `forever-data/projects/coralina/extracted/brochure.json`
- `forever-data/projects/coralina/extracted/price-list.json`

Likely required after OCR/visual review:

- `forever-data/projects/coralina/extracted/documents.json`
- `forever-data/projects/coralina/extracted/masterplan.json`

Repository documentation gap:

- `docs/KNOWLEDGE_MODEL.md`
- `docs/FOREVER_DEVELOPMENT_ROADMAP.md` or a documented replacement path

## Recommended Fixes

1. OCR or visually review the company profile and brochure pages to verify developer and country.
2. Update manifest identity fields only with source-backed values.
3. Normalize price-list date to ISO format in extraction, while preserving the raw source date in metadata if useful.
4. Review the 95 price arithmetic mismatches against original source material; do not recalculate or override source prices without evidence.
5. Add source-backed coordinates only if verified from local source material.
6. Extract construction status and completion date if present; otherwise keep null and document the gap.
7. Re-run JSON validation and Import Engine dry-run only after the mandatory blockers are fixed.
8. Keep `ready_for_import=false` until the dry-run passes without readiness errors.

## Estimated Effort To Reach `ready_for_import=true`

Estimated effort: **4-8 focused hours**, assuming source documents contain the missing facts.

Breakdown:

- OCR/visual verification of developer and country: 1-2 hours.
- Manifest/import-status updates: 15-30 minutes.
- Price-list date normalization and price mismatch review: 1-3 hours.
- Coordinates/construction/legal metadata review: 1-2 hours.
- Final validation and dry-run: 30-60 minutes.

If the missing developer, country, construction, or coordinate facts are not present in the local source package, effort depends on obtaining additional source-backed material and should remain blocked until that material exists.

## Validation Performed

Commands/results:

```text
JSON parse audit: passed for manifest, import-status, classification-log, and six extracted JSON files.
Source-reference audit: 3,382 source references checked; 0 missing local source files.
Classified-file coverage: 343 classified paths; 343 represented in extracted source references.
Unit audit: 198 rows; 198 unique room/unit numbers; 0 duplicate room/unit numbers.
Price arithmetic audit: 95 rows require review.
npm.cmd run import coralina -- --dry-run: expected failure at import_status_not_ready.
```

## Final Readiness Assessment

Coralina is **not ready for real import**.

The source package and extraction coverage are substantially complete, but the required import identity and verification metadata are not ready. The correct next step is targeted source-backed metadata completion, not enabling `ready_for_import`.
