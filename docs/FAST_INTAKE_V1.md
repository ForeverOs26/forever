# Fast Intake v1

Status: Implemented in an open PR, pending independent review and Owner merge.
Not yet canonical on `main`.

Fast Intake v1 is a bounded, local, owner-only tool. It turns normal project
source materials into a deterministic, validated, **unpublished** Progressive
draft payload ready for the existing ordinary draft importer. It performs
**preparation and validation only**.

It never connects to production, never creates a database client, never makes a
network request, never executes a database import, and never publishes. No
production database, lead, publication, or write is touched by running it.

## Operator flow

```
source folder / ZIP archives
  → inventory + classification
  → structured-artifact extraction (reuse only)
  → normalized project facts (anti-fabrication)
  → Progressive payload (existing builder + fingerprint)
  → local draft-only validation (ordinary ValidateOnly boundary)
  → concise readiness summary
```

Target: 15 minutes or less (900 seconds) from source-material selection to a
validated, import-ready unpublished draft payload for a normally structured
project. The CLI measures elapsed time and reports `target_met` / `elapsed_seconds`;
it never fails solely because a run exceeds the target.

## Command

The operator needs only a project slug, a project name, and one or more source
paths (folders and/or `.zip` archives).

One source directory:

```
npm run intake -- --project marina-bay --name "Marina Bay" \
  --source "C:\forever-incoming\Marina Bay"
```

Multiple ZIP sources (Windows paths with spaces are supported):

```
npm run intake -- --project marina-bay --name "Marina Bay" \
  --source "C:\forever-incoming\Marina Bay brochure.zip" \
  --source "C:\forever-incoming\Marina Bay price list.zip"
```

Optional flags: `--out-root <dir>` (default `forever-data/projects`),
`--workspace <dir>` (gitignored extraction workspace, default `.intake-workspace`),
`--target-seconds <n>` (default 900), `--verbose` (list every classified file and
warning; off by default so the summary stays readable).

## Accepted input

- one source directory;
- one ZIP archive;
- multiple source directories and/or ZIP archives in one invocation.

Archives are treated as source material, not deliverables. Extraction happens
inside the gitignored `.intake-workspace`, ZIP path traversal is rejected before
any write, files cannot escape the workspace, and the temporary data is removed
after both success and failure. Original source archives are never modified.
Nested archives are **not** recursively unpacked in v1: they are classified and
recorded with an explicit `nested_archive` warning.

## Generated artifacts

```
forever-data/projects/<slug>/
  intake/
    source-manifest.json     inventory: roots, logical paths, sha256, category,
                             duplicate grouping, archive origin, warning codes
    classification.json      per-file categories + intake readiness warnings
    extracted-facts.json     the facts actually consumed, with provenance
    intake-summary.json      status, counts, validation result, next command
  progressive/
    payload.json             the canonical Progressive create payload
```

Every generated JSON file is deterministic, UTF-8 without a BOM, two-space
indented, and free of passwords, tokens, credentials, or personal information.
Machine-specific absolute paths never affect the payload fingerprint (they
appear only under `local_only_path` in the manifest).

## Classification categories

`brochure`, `price-list`, `payment-plan`, `project-facts`, `developer-profile`,
`master-plan`, `floor-plan`, `unit-plan`, `furniture-package`, `map-location`,
`legal-document`, `photo`, `video`, `archive`, `unknown`. Classification is for
routing and warnings only — never proof of a fact. Unknown files never block.

## Extraction and reuse

Fast Intake v1 reuses existing components rather than building new extractors:

- the existing Progressive batch builder and deterministic fingerprint
  (`src/features/forever-ingestion`);
- the existing `ExtractedPriceList` shape (`src/import/types.ts`) as price-list
  input;
- the existing currency policy and provenance/warning model;
- the ordinary draft-import `-ValidateOnly` invariants
  (`scripts/import/Import-ForeverProjectDraft.ps1`).

It consumes only recognized **structured** artifacts:

- an extracted price-list JSON (`ExtractedPriceList`), and
- a compact `project-facts.json` carrying identity facts with provenance.

Raw PDFs, spreadsheets, images, and videos are inventoried and warned about,
never interpreted. No large OCR, computer-vision, spreadsheet, or AI dependency
is introduced. A project with incomplete or unsupported materials still produces
the maximum safe partial draft payload, with explicit warnings.

### `project-facts.json`

Each field is a provenance-carrying fact; a field is used only when it is
source-backed (a non-empty value, a source reference, and confidence above
`"none"`):

```json
{
  "name":     { "value": "Marina Bay", "source_ref": "facts/project-facts.json", "confidence": "high", "status": "official_source" },
  "developer":{ "value": "Dev Co",     "source_ref": "facts/project-facts.json", "confidence": "high", "status": "official_source" },
  "location": { "value": "Kamala, Phuket, Thailand", "source_ref": "facts/project-facts.json", "confidence": "high" },
  "country":  { "value": "Thailand",   "source_ref": "facts/project-facts.json", "confidence": "high" },
  "project_type": { "value": "Residential", "source_ref": "facts/project-facts.json", "confidence": "medium" }
}
```

## Anti-fabrication rules

Raw source values are preserved. Fast Intake never infers an unsupported
developer, location, country, currency, price, yield, completion date,
ownership, bedroom count, unit type, or publication status. Missing information
stays `null`/omitted and becomes an explicit warning — never `"Not available"`,
`"Unknown"`, `0`, an empty string, or a demo placeholder. Country drives only
the existing currency inference rule; it is never stored as a fabricated field.
Canonical developer/location ids stay `NULL` — dependency resolution runs
offline and never auto-creates canonical records.

## Payload invariants

`schema_version = "1"`, `mode = "create"`, `project.slug = <requested slug>`,
`project.name = <requested or source-backed name>`, `project.publish = false`,
a deterministic `batch_fingerprint`, and no `documents` array. The builder and
fingerprint implementation are reused unchanged; the schema, fingerprint
algorithm, currency policy, and dependency resolution are not reimplemented.

## Validation

At the end of intake the generated payload is validated automatically through
the same draft-only invariants as
`scripts/import/Import-ForeverProjectDraft.ps1 -ValidateOnly` — with no database
credentials, no client, no network, and no write. The port additionally
recomputes and verifies the content fingerprint. An invalid payload fails closed
with a non-zero exit code, and a failed regeneration never replaces a previously
valid payload.

Fast Intake does **not** run the import. Validate again later with:

```
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project <slug> -ValidateOnly
```

Then, as a separately authorized action, run the ordinary draft import
(`Import Forever Project Draft.cmd`) and enter the database password once. No
password is printed or requested during Fast Intake preparation.

## Readiness status

- `READY_FOR_DRAFT_IMPORT` — validated with no warnings;
- `PARTIAL_READY_WITH_WARNINGS` — validated with warnings (the common healthy
  outcome for real projects);
- `BLOCKED` — a valid payload could not be produced (non-zero exit code).

Follows: SAVE FIRST → DISPLAY AVAILABLE DATA → ENRICH LATER → VERIFY
SELECTIVELY → PUBLISH DELIBERATELY.

## v1 limitations

- consumes structured artifacts only; raw PDFs/spreadsheets/images/videos are
  inventoried, not extracted (no OCR/CV/spreadsheet parsing);
- coordinates and construction status are never extracted (always warning-backed
  missing);
- repository-local media/documents have no stable importer URL, so media/document
  ingestion is deferred (`0` media rows) with an explicit warning;
- nested archives are not recursively unpacked;
- no production execution, publication, update/upsert, schema/migration/RPC/RLS,
  backend service, UI, or Factory-autonomy change.
