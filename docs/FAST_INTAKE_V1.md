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

## What Fast Intake v1 does — and does NOT — do yet

Fast Intake v1 **does not yet transform an ordinary raw developer dossier
(PDF/Excel/images/video) into structured units and prices by itself.** It
prepares a validated payload in 15 minutes only when **compatible structured
artifacts already exist** — an extracted price-list JSON (`ExtractedPriceList`)
and a compact `project-facts.json`. Raw PDFs, spreadsheets, images, and videos
are **inventoried and classified only**, never interpreted.

Raw-document extraction — OCR, computer vision, and spreadsheet parsing — is a
**later Fast Intake stage**, deliberately out of scope for v1. This PR is not
complete raw-folder-to-database automation; it is a bounded, safe preparation
and validation tool that reuses the existing structured-ingestion contract.

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
validated, import-ready unpublished draft payload — **for a project whose
compatible structured artifacts already exist** (see the scope note above). The
CLI measures elapsed time and reports `target_met` / `elapsed_seconds`; it never
fails solely because a run exceeds the target.

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

The command works exactly as written from a clean PowerShell, cmd.exe, or bash
process. `npm run intake` executes the committed bootstrap
`src/intake/run-cli.mjs`, which configures the repository's `@/*` alias
resolution internally — no hidden environment variable (`JITI_TSCONFIG_PATHS`,
`JITI_ALIAS`), no shell-specific prefix, no Supabase variables, and no database
credentials are required.

## Accepted input

- one source directory;
- one ZIP archive;
- multiple source directories and/or ZIP archives in one invocation.

Archives are treated as source material, not deliverables, and as UNTRUSTED
input. Extraction happens inside the gitignored `.intake-workspace`; the
temporary data is removed after both success and failure, and original source
archives are never modified. Nested archives are **not** recursively unpacked in
v1: they are classified and recorded with an explicit `nested_archive` warning.

The hardened ZIP boundary rejects, before any write: `../` and `..\` traversal
(including mixed separators), absolute and leading-separator paths, Windows
drive-letter and UNC paths, NUL/control and Windows-invalid characters, reserved
Windows names (`CON`, `NUL`, `COM1`…), unsafe trailing dots/spaces, duplicate
and case-insensitive-colliding entry paths, file/directory collisions, encrypted
entries, unsupported compression methods (only STORED and DEFLATE are read),
ZIP64 archives, symlink-like entries, and malformed or truncated central
directories. Every extracted file's CRC-32 and declared sizes are verified.

Conservative resource limits (all configurable in code, enforced fail-closed):

| Limit | Default |
| --- | --- |
| Archive size | 2 GiB |
| Entry count | 100,000 |
| Single expanded file | 1 GiB |
| Total expanded size | 8 GiB |
| Compression ratio (files > 1 MiB) | 200× |
| Normalized path length | 4,096 chars |

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

Every generated JSON file is UTF-8 without a BOM, two-space indented, and free
of passwords, tokens, credentials, or personal information.

**Determinism, honestly stated.** For identical logical inputs these artifacts
are byte-identical regardless of the machine or absolute source location:
`progressive/payload.json`, the batch fingerprint, `classification.json`,
`extracted-facts.json`, and the stable inventory fields of
`source-manifest.json` (logical paths, hashes, categories, duplicate grouping).
Operational metadata is NOT claimed deterministic and never affects the payload
or fingerprint: `intake_started_at`, elapsed times in `intake-summary.json`, and
the operator-reference `local_only_path` entries.

**Transactional output.** All artifacts are built in a unique staging directory
inside the destination project directory, validated there, and only then swapped
into place atomically (backup-and-restore renames). A failure at any stage —
inventory, extraction, hashing, normalization, any artifact write, validation,
or the final swap — removes the staging directory and preserves the previous
canonical five-file set byte-for-byte; old and new artifacts are never mixed. A
per-project `.intake.lock` (exclusive directory creation) blocks a concurrent
run for the same slug; different slugs are independent. Stale staging/backup
directories from a crashed run are removed on the next run.

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

Each field is a provenance-carrying fact; a field is used only when it survives
every anti-fabrication guard: a non-empty, non-sentinel value (`Not available`,
`Unknown`, `N/A`, `TBD`, dashes and similar are never facts), a known usable
confidence (`high`/`medium`/`low` — `none` or an unknown string disqualifies), a
present source reference, and a valid ISO `source_date` when one is given:

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
ownership, bedroom count, unit type, or publication status — and never infers a
fact from a filename, folder name, classification, the CLI project name, or a
placeholder. Missing information stays `null`/omitted and becomes an explicit
warning — never `"Not available"`, `"Unknown"`, `0`, an empty string, or a demo
placeholder.

Price-list rows are sanitized before the canonical builder sees them: rows with
no usable unit identifier are skipped (warned); zero, negative, or non-numeric
prices are omitted (warned); currencies outside the supported ISO set are not
used (warned); a malformed country value is not used for currency inference
(warned); and **duplicate unit identifiers are a blocking conflict** — the run
ends BLOCKED rather than importing an ambiguous inventory. The CLI project name
may supply the display name, but when a source-backed name differs the conflict
is recorded explicitly (`project_name_source_differs`).

Country drives only the existing currency inference rule; it is never stored as
a fabricated field. Canonical developer/location ids stay `NULL` — dependency
resolution runs offline and never auto-creates canonical records.

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
recomputes and verifies the content fingerprint (stricter than PowerShell,
never more lenient). An invalid payload fails closed with a non-zero exit code,
and a failed regeneration never replaces a previously valid payload.

Parity with the PowerShell boundary is pinned by a shared corpus of valid and
invalid payloads at `src/intake/test-fixtures/validation-corpus/`:

- the TypeScript half runs in CI (`src/intake/tests/validation-parity.test.ts`)
  and enforces that TypeScript never accepts a payload the PowerShell boundary
  rejects;
- the PowerShell half runs on Windows via
  `scripts/import/tests/Compare-DraftValidationParity.ps1`, which drives the
  real `-ValidateOnly` over the same corpus and fails on any mismatch. It stops
  before any database argument or password.

Fast Intake does **not** run the import. Validate again later with:

```
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project <slug> -ValidateOnly
```

Then, as a separately authorized action, run the ordinary draft import
(`Import Forever Project Draft.cmd`) and enter the database password once. No
password is printed or requested during Fast Intake preparation.

## Readiness status

- `READY_FOR_DRAFT_IMPORT` — locally valid through the validation boundary, a
  structurally meaningful graph (at least one building, one unit, and one
  price), and no substantive missing-fact or conflict warning. Informational
  notes that do not reduce the graph (offline dependency-link deferral,
  coordinates/construction not extracted in v1, deferred media) do not demote a
  complete draft.
- `PARTIAL_READY_WITH_WARNINGS` — an importer-valid, unpublished partial draft
  whose missing enrichment is explicit (e.g. missing developer, location,
  country, currency, or prices; or no structured graph at all). The common
  honest outcome for real projects. Never publish-ready — publication is always
  a later, separate Owner action.
- `BLOCKED` — the payload cannot safely pass the ordinary importer boundary
  (malformed structured JSON, duplicate unit identifiers, validation failure,
  lock contention, unsafe paths). Non-zero exit code; the previous canonical
  artifact set is not replaced. Missing media alone never blocks.

Follows: SAVE FIRST → DISPLAY AVAILABLE DATA → ENRICH LATER → VERIFY
SELECTIVELY → PUBLISH DELIBERATELY.

## v1 limitations

- consumes structured artifacts only; raw PDFs/spreadsheets/images/videos are
  inventoried, not extracted. **Raw-document extraction (OCR, computer vision,
  spreadsheet parsing) is a later Fast Intake stage** — v1 does not turn an
  ordinary raw developer dossier into structured units/prices by itself;
- coordinates and construction status are never extracted (always warning-backed
  missing);
- repository-local media/documents have no stable importer URL, so media/document
  ingestion is deferred (`0` media rows) with an explicit warning;
- nested archives are not recursively unpacked; ZIP64, encrypted, and
  non-STORED/DEFLATE archives are rejected with a concise error;
- no production execution, publication, update/upsert, schema/migration/RPC/RLS,
  backend service, UI, or Factory-autonomy change.
