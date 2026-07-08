# Coralina Source Package

Status: **Not ready for import**

This folder is the official Forever source package shell for the Coralina Import Validation milestone.

## Package Structure

```text
forever-data/projects/coralina/
├── manifest.json
├── import-status.json
├── README.md
├── extracted/
└── source/
    ├── brochure/
    ├── price-list/
    ├── masterplan/
    ├── unit-plans/
    ├── images/
    ├── videos/
    └── documents/
```

## Validation Result

No Coralina source files were present in the repository or workspace at validation time.

Because there are no source files:

- No brochure could be validated.
- No price list could be validated.
- No masterplan could be validated.
- No unit plans could be validated.
- No images could be validated.
- No videos could be validated.
- No documents could be validated.
- No `extracted/brochure.json` could be generated.
- No `extracted/price-list.json` could be generated.

## Import Safety

`import-status.json` intentionally sets `ready_for_import` to `false`.

Do not run a real import for Coralina until source-backed files and extracted JSON are added and a dry-run passes.
