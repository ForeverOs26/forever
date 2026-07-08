# Coralina Classification Report

Task ID: RC2.1-CORALINA-CLASSIFY

## Summary

Coralina raw source materials from `forever-data/incoming/Coralina/` were copied or extracted into the official Forever project source structure at `forever-data/projects/coralina/source/`.

No incoming originals were deleted or modified. No application source code, database files, migrations, or UI files were changed. No real import was run.

`ready_for_import` remains `false` because extracted JSON has not been created and the Coralina manifest still contains `SOURCE_PENDING` identity fields.

## Classified Files

| Material type | Folder | Files |
| --- | --- | ---: |
| brochure | `source/brochure` | 4 |
| price-list | `source/price-list` | 2 |
| masterplan | `source/masterplan` | 10 |
| unit-plans | `source/unit-plans` | 198 |
| images | `source/images` | 116 |
| videos | `source/videos` | 3 |
| documents | `source/documents` | 10 |

Total classified files: 343

## Source Classification Decisions

| Incoming source | Classified as | Confidence | Reason |
| --- | --- | --- | --- |
| `2. E-Brochure-20260707T151353Z-3-001.zip` | brochure | high | Archive and enclosed PDFs identify Coralina e-brochures. |
| `CLK - Price List V.2. - Updated 03.07.26.zip` | price-list | high | Archive and enclosed PDFs identify Coralina price-list materials. |
| `CLK - Price List V.2. - Updated 03.07.26.pdf` | price-list | high | Standalone PDF filename identifies Coralina price list. |
| `CLK - Master Plan Price list V.2 - updated 03.07.26.pdf` | price-list | high | Standalone PDF filename identifies Coralina master-plan price list. |
| `4. Master Plan-20260707T151505Z-3-001.zip` | masterplan | high | Archive and enclosed PDF/JPG files identify Coralina master plan material. |
| `5. Floor Plan-20260707T151604Z-3-001.zip` | unit-plans | high | Official target has no separate floor-plan folder; supported plan files map to unit-plans. |
| `6. Unit Plan-20260707T151642Z-3-001.zip` | unit-plans | high | Archive and enclosed PDF/JPG files identify Coralina unit plans. |
| `11. Perspective-20260707T151843Z-3-001.zip` | images | high | Perspective render archive contains Coralina project imagery. |
| `12. Photo of Show Units-20260707T151908Z-3-001.zip` | images | high | Show-unit photo archive contains Coralina imagery. |
| `Video Coralina.zip` | videos | high | Archive and enclosed MP4 files identify Coralina videos. |
| `1. Company Profile-20260707T151303Z-3-001.zip` | documents | high | Company profile is a supplemental Coralina document. |
| `3. Facilities-20260707T151430Z-3-001.zip` | documents | high | Facilities PDF is a supplemental Coralina document. |
| `7. Furniture Package-20260707T151722Z-3-001.zip` | documents | high | Furniture package PDFs are supplemental Coralina documents. |
| `8. Living Service-20260707T151750Z-3-001.zip` | documents | high | Living services PDF is a supplemental Coralina document. |
| `9. Map-20260707T151820Z-3-001.zip` | documents | high | Map PDF/JPEG files are supplemental location documents; no official map folder exists for this task. |

## Files Needing Review

None. `_needs-review` exists and contains no classified files for this task.

## Missing Required Material Types

None of the official source material types are missing from `source/`.

Import is still blocked by missing extracted data files:

- `forever-data/projects/coralina/extracted/brochure.json`
- `forever-data/projects/coralina/extracted/price-list.json`

The manifest also still has `SOURCE_PENDING` fields that must be replaced only with source-backed Coralina facts before a real import.

## Testing

Dry-run validation is safe because it uses `--dry-run` and the import engine validates package readiness before any database write path.

Actual dry-run result: validation stopped safely after loading the Coralina manifest because `import-status.json` intentionally keeps `ready_for_import` false and extracted JSON is missing. No real import was run.

## Commit / Pull Request

Not committed. The classified source package is about 1.19 GB and includes one file over GitHub normal push limits: `forever-data/projects/coralina/source/masterplan/4. Master Plan__Coralina Master Plan.pdf` is 158,719,911 bytes. No pull request has been opened.
