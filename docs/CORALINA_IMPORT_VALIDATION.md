# Coralina Import Validation

Task ID: FDB-004A

Validation date: 2026-07-08

## Summary

The Coralina Import Validation milestone has started as an architecture validation task for Import Engine v1.

Result: **BLOCKED — SOURCE MATERIALS MISSING**

The official Forever source package structure for Coralina has been created under:

```text
forever-data/projects/coralina/
```

No application code, Supabase migrations, database schema, database data, or UI files were changed.

A dry-run only was performed. The dry-run stopped safely during validation because Coralina is not ready for import.

## Modeva Pipeline Reviewed

The existing Modeva pipeline establishes the v1 pattern Coralina must follow:

1. Project source package under `forever-data/projects/{project_slug}/`.
2. `manifest.json` declares project identity and source folder requirements.
3. `import-status.json` gates import readiness.
4. Required source folders contain source-backed files.
5. `extracted/brochure.json` and/or `extracted/price-list.json` provide structured facts.
6. Dry-run validates the package and prepares payload counts without a Supabase client.
7. Real import is allowed only after dry-run passes.

Modeva passed this path with 7 buildings, 289 units, and 289 price-history rows. Coralina has not yet reached the source-backed extraction stage.

## Coralina Package Created

```text
forever-data/projects/coralina/
├── README.md
├── manifest.json
├── import-status.json
├── extracted/
│   └── .gitkeep
└── source/
    ├── brochure/
    │   └── .gitkeep
    ├── documents/
    │   └── .gitkeep
    ├── images/
    │   └── .gitkeep
    ├── masterplan/
    │   └── .gitkeep
    ├── price-list/
    │   └── .gitkeep
    ├── unit-plans/
    │   └── .gitkeep
    └── videos/
        └── .gitkeep
```

Because `forever-data/` is ignored by `.gitignore`, the Coralina package files must be force-added when committing this validation package.

## Source File Discovery

Search performed for Coralina source material in the workspace found no matching files.

Search patterns included:

- `*coralina*`
- `*corallina*`
- `*coral*`

Result: no Coralina source files were available to classify or validate.

## Source Classification

| Category | Folder | Required | Supported file types | Files found | Status |
| --- | --- | ---: | --- | ---: | --- |
| Brochure | `source/brochure/` | Yes | `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp` | 0 | Missing required source file |
| Price list | `source/price-list/` | Yes | `.pdf`, `.xlsx`, `.xls`, `.csv`, `.jpg`, `.jpeg`, `.png` | 0 | Missing required source file |
| Masterplan | `source/masterplan/` | Recommended | `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp` | 0 | Missing recommended source file |
| Unit plans | `source/unit-plans/` | Recommended | `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp` | 0 | Missing recommended source file |
| Images | `source/images/` | Recommended | `.jpg`, `.jpeg`, `.png`, `.webp` | 0 | Missing recommended source file |
| Videos | `source/videos/` | Optional | `.mp4`, `.mov`, `.webm`, `.url`, `.txt` | 0 | Missing optional source file |
| Documents | `source/documents/` | Optional | `.pdf`, `.doc`, `.docx`, `.jpg`, `.jpeg`, `.png` | 0 | Missing optional source file |

## Manifest Status

`manifest.json` was created with the required Import Engine v1 manifest shape and supported manifest version `1.2`.

Important: required identity fields that are not source-backed are intentionally set to `SOURCE_PENDING` placeholders. These placeholders are blockers and must be replaced only after Coralina source documents provide the facts.

Placeholder fields:

- `developer`
- `project_type`
- `country`
- `province`
- `location`

The known requested intake identity is limited to:

- Project name: `Coralina`
- Project slug: `coralina`

No developer, location, country, province, project type, pricing, unit, media, or document facts were inferred.

## Import Status

`import-status.json` was generated with:

```json
{
  "ready_for_import": false,
  "status": "blocked_missing_source_materials"
}
```

This is intentional. A real import must not be run for Coralina until the required source files and extracted JSON exist and dry-run validation passes.

## Dry-Run Command

Command executed:

```bash
npm run import coralina -- --dry-run
```

Exit code: `1`

Output:

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> import
> jiti src/import/cli.ts coralina --dry-run

✔ Manifest - coralina
✖ Project is not ready for import.
import_status_not_ready: import-status.json does not mark the project ready for import.
required_files_missing: Required folder has no supported files for brochure.
required_files_missing: Required folder has no supported files for price-list.
brochure_extraction_missing: extracted/brochure.json is missing. Project import can continue, but project facts may be sparse.
price_list_extraction_missing: extracted/price-list.json is missing. Unit and price import will be skipped.
extracted_json_missing: No supported extracted JSON files are available.
```

## Validation Issues

### Errors

1. `coralina_source_files_absent`
   - No Coralina source files were found in the repository/workspace.

2. `manifest_contains_source_pending_values`
   - Required manifest identity fields contain placeholders because source-backed facts were unavailable.

3. `import_status_not_ready`
   - `import-status.json` correctly blocks import with `ready_for_import: false`.

4. `required_files_missing`
   - `source/brochure/` contains no supported brochure files.
   - `source/price-list/` contains no supported price-list files.

5. `extracted_json_missing`
   - Neither `extracted/brochure.json` nor `extracted/price-list.json` exists.

### Warnings

1. `brochure_extraction_missing`
   - `extracted/brochure.json` is missing.

2. `price_list_extraction_missing`
   - `extracted/price-list.json` is missing.

3. Missing recommended source folders content:
   - `source/masterplan/`
   - `source/unit-plans/`
   - `source/images/`

4. Missing optional source folders content:
   - `source/videos/`
   - `source/documents/`

## Database Safety

No database operation was performed.

The dry-run stopped at validation before project facts were loaded, payloads were prepared, a Supabase client was created, or database writes could occur.

No inserts, updates, deletes, migrations, Supabase type generation, schema changes, or UI changes were performed.

## Current Verdict

**NOT READY FOR IMPORT**

Coralina cannot yet prove second-project import success because no Coralina source materials are available.

The milestone has validated the safety behavior of Import Engine v1 for a second project package: the engine loads the Coralina manifest and refuses to proceed when readiness, required files, and extracted JSON are missing.

## Required Next Actions

Before a successful Coralina dry-run can be performed:

1. Add source-backed Coralina brochure files to `forever-data/projects/coralina/source/brochure/`.
2. Add source-backed Coralina price-list files to `forever-data/projects/coralina/source/price-list/`.
3. Add available masterplan files to `source/masterplan/`.
4. Add available unit-plan files to `source/unit-plans/`.
5. Add available images to `source/images/`.
6. Add available videos to `source/videos/` or document that no videos were provided.
7. Add available legal/verification/documents to `source/documents/` or document that no documents were provided.
8. Replace all `SOURCE_PENDING` manifest identity placeholders with source-backed facts.
9. Generate `extracted/brochure.json` from reviewed brochure facts.
10. Generate `extracted/price-list.json` from reviewed price-list facts.
11. Regenerate `import-status.json` with source file counts and `ready_for_import: true` only if required source and extracted files are present.
12. Re-run dry-run only:

```bash
npm run import coralina -- --dry-run
```

13. Run a real import only after dry-run passes and the user explicitly approves database writes.
