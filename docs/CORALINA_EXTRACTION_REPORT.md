# Coralina Extraction Report

Task ID: COR-002

Extraction date: 2026-07-08

## Summary

RC2.2 extracted structured Coralina data from the classified local source package under `forever-data/projects/coralina/source/`.

No application source code, UI files, migrations, Supabase data, or database configuration were changed. No Import Engine real import was run.

Import readiness remains **blocked**. `ready_for_import` is intentionally `false` because the local machine-readable source text does not verify every mandatory manifest identity field. In particular, `developer` and `country` remain `SOURCE_PENDING`.

## Extracted Datasets

| Dataset | Output | Status | Extracted records |
| --- | --- | --- | ---: |
| Brochure facts | `forever-data/projects/coralina/extracted/brochure.json` | Generated | n/a |
| Price list | `forever-data/projects/coralina/extracted/price-list.json` | Generated | 198 unit rows |
| Masterplan files | `forever-data/projects/coralina/extracted/masterplan.json` | Generated | 10 files |
| Unit and floor plans | `forever-data/projects/coralina/extracted/unit-plans.json` | Generated | 198 files |
| Images and videos | `forever-data/projects/coralina/extracted/images.json` | Generated | 119 media files |
| Documents | `forever-data/projects/coralina/extracted/documents.json` | Generated | 16 document/source files |

## Source-Backed Facts Extracted

- Project name evidence: `CORALINA KAMALA`, from the English brochure.
- Location evidence: `KAMALA`, `PHUKET MAP`, and beach/location map references from the English brochure.
- Beach distance: `WALK TO THE BEACH 430 M. / 5 MINS`, from the English brochure.
- Project type evidence: `Residential`, from facilities/project layout text showing residential floors.
- Facilities: 12 outdoor facilities and 10 indoor facilities from brochure/facilities pages.
- Common area facts: approximately 8,680 sq.m. total common area, with approximately 3,000 sq.m. green area, 2,700 sq.m. pool area, and 2,700 sq.m. common area in facilities.
- Price list date: `03.07.26`, from `CLK - Price List V.2. - Updated 03.07.26.pdf`.
- Unit inventory: 198 available units across buildings A-H.
- Unit types: 1 Bedroom L, 1 Bedroom M, 1 Bedroom Plus, 2 Bedroom, 2 Bedroom Plus, PH-2 Bedroom Plus, PH-3 Bedroom.

Every extracted field uses source metadata where available, including source file, page number when text extraction exposed one, and confidence.

## Missing Information

- Developer remains `SOURCE_PENDING`. `1. Company Profile__The Title Company Profile.pdf` is classified, but local text extraction did not expose machine-readable developer text.
- Country remains `SOURCE_PENDING`. Phuket/Kamala were verified, but `Thailand` was not verified from extractable local source text.
- Total project units remain null. The price list contains 198 available unit rows, but the total project inventory was not verified from extractable brochure text.
- Ownership, completion date, parking count, legal status, and payment terms remain null or source-pending.
- Masterplan geometry and detailed plan labels were not extracted because the masterplan source is primarily visual.

## Validation Summary

JSON validation passed for:

- `manifest.json`
- `import-status.json`
- `extracted/brochure.json`
- `extracted/price-list.json`
- `extracted/masterplan.json`
- `extracted/unit-plans.json`
- `extracted/images.json`
- `extracted/documents.json`

Price-list validation:

- Rows extracted: 198
- Unique unit numbers: 198
- Duplicate unit numbers: 0
- Buildings detected: A, B, C, D, E, F, G, H
- Numeric price, size, and price-per-sqm fields parse successfully.
- Required unit fields are present for all extracted rows: unit number, unit type, and availability status.

Import Engine dry-run:

```text
npm.cmd run import coralina -- --dry-run
```

Result: expected failure. The Import Engine loaded the manifest and stopped because `import-status.json` correctly keeps `ready_for_import` false.

## Remaining Blockers

1. Source-backed developer identity is still required before import.
2. Source-backed country value is still required before import.
3. OCR or visual review may be needed for image-only PDF pages, especially company profile and project overview pages.
4. `ready_for_import` must remain false until all mandatory identity fields are verified and updated.

## Readiness Assessment

**Not ready for import.**

The structured extraction package is present and internally valid, but Coralina cannot be imported safely while mandatory manifest identity fields remain `SOURCE_PENDING`. No database import should be run until those facts are verified from source material and the dry-run passes without readiness errors.
