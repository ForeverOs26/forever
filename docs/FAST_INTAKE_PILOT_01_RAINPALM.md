# Fast Intake Pilot 01 — Rainpalm Villas

Status: Completed locally; ready for independent review

## Scope and source integrity

Project: Rainpalm Villas (`rainpalm-villas`)

This was the first measured Fast Intake v1 pilot. It measured only compatible,
previously prepared structured artifacts into a validated unpublished
Progressive draft. It did not measure extraction from raw developer documents.

| Input         | Path                                                      | SHA-256                                                            |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Project facts | `C:\forever-incoming\Rainpalm\facts\project-facts.json`   | `1e47032269fe2cd48ed93f436075915a05e1be7380d2afc58ce793e55d5c795b` |
| Price list    | `C:\forever-incoming\Rainpalm\price-list\price-list.json` | `6ce4a187711f1fdcc26eed84689a0ef0f7a461262a4630b895c251781d10a73f` |

Both hashes matched the authorized values. The files had the required `.json`
extensions and were not modified. The requested control note,
`C:\forever-incoming\Rainpalm\README.txt`, was absent at preflight; it was not
needed as an intake source because the invocation deliberately named only the
two structured subdirectories. This is recorded as a documentation gap.

Structured-input sanity checks passed: name `Rainpalm Villas`; developer
`Tonsai Company`; location `Bang Tao, Phuket`; project type `Pool Villa`; 21
unique identifiers with no duplicates; 14 positive source-listed prices; seven
sold villas with null prices; THB only on priced rows; no price-list date field;
and no personal or sensitive information.

## Measured run

Exact command:

```powershell
npm.cmd run intake -- --project rainpalm-villas --name "Rainpalm Villas" --source "C:\forever-incoming\Rainpalm\facts" --source "C:\forever-incoming\Rainpalm\price-list" --target-seconds 900
```

The primary wall-clock measurement began immediately before invoking that
command and ended after the CLI result was read, the five generated artifacts
were parsed and inspected, and the first `-ValidateOnly` attempt completed.
Prepared JSON, candidate discovery, deterministic repetition, documentation,
and PR creation were outside the measured window.

| Measurement                       | Result                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| Wall-clock start (UTC)            | `2026-07-19T14:45:02.8799634Z`                                                              |
| Wall-clock finish (UTC)           | `2026-07-19T14:45:42.7140001Z`                                                              |
| Measured wall-clock               | `39.834` seconds                                                                            |
| CLI elapsed                       | `0.133` seconds                                                                             |
| Target                            | `900` seconds                                                                               |
| `target_met`                      | `true`                                                                                      |
| Source roots / files / duplicates | `2 / 2 / 0`                                                                                 |
| Categories                        | `project-facts=1`, `price-list=1`                                                           |
| Readiness                         | `PARTIAL_READY_WITH_WARNINGS`                                                               |
| Planned graph                     | `projects=1`, `buildings=0`, `units=21`, `prices=14`, `media=0`, `warnings=12`, `batches=1` |
| Batch fingerprint                 | `2ef6931168fc7b4c5c6cbba3e398f398de4b6ab9e5b7546962f570fcfded9781`                          |
| Payload SHA-256                   | `c95fb84744d9c067a003284be3fd8de5a2a84a2f9cf03a36b2c78b72d283a9b7`                          |

The first direct PowerShell `-ValidateOnly` attempt was blocked by this host's
execution policy, not by payload validation. The repeat using a process-scoped
`-ExecutionPolicy Bypass` passed:

```text
DRAFT_PAYLOAD_VALID|slug=rainpalm-villas|sha256=c95fb84744d9c067a003284be3fd8de5a2a84a2f9cf03a36b2c78b72d283a9b7|buildings=0|units=21|prices=14|media=0|documents=0|warnings=12
```

## Generated local draft

The complete canonical local generation exists under
`forever-data/projects/rainpalm-villas/`:

- `intake/source-manifest.json`
- `intake/classification.json`
- `intake/extracted-facts.json`
- `intake/intake-summary.json`
- `progressive/payload.json`

All five JSON files parse and identify `rainpalm-villas`. The payload has
`schema_version: "1"`, `mode: "create"`, and `project.publish: false`. It has
no documents or media arrays, no canonical developer or location identifier,
no fabricated building from villa types A–D, and no price for source-null villas
`A4`, `A8`, `A9`, `B8`, `C2`, `C3`, or `C4`. All 14 price rows are positive THB
values. The project was not imported or published.

No lock, journal, staging, backup, or transaction residue remained after the
repeat; one complete current generation remains.

## Warning inventory

The generated payload contains 12 warnings:

- `country_missing` — no source-backed country, so no country-derived currency
  inference;
- `coordinates_missing` — v1 leaves coordinates null;
- `construction_status_missing` — v1 leaves construction status/completion
  date null;
- `developer_unresolved` — the raw `Tonsai Company` value is retained without
  creating a canonical developer row;
- `location_unresolved` — the raw `Bang Tao, Phuket` value is retained without
  creating a canonical location row;
- seven `price_missing` notes for `A4`, `A8`, `A9`, `B8`, `C2`, `C3`, and `C4`.

## Deterministic repetition

The exact command was run a second time outside the primary measurement. Its
CLI elapsed time was `0.094` seconds and it produced the same readiness,
fingerprint, payload SHA-256, graph counts, and 12 warnings. The payload,
classification, and extracted facts were byte-identical. Source-manifest stable
fields were identical after excluding `intake_started_at` and
`local_only_path`.

The summary's semantic stable fields were also identical after excluding elapsed
fields and the `source_manifest_sha256` value that is necessarily derived from
the manifest's operational timestamp. Classification, extracted-facts, and
payload hashes were unchanged. This is an operational metadata difference, not
a change in intake content or readiness.

## Manual preparation and gaps

`project-facts.json` and `price-list.json` were manually prepared before this
timed pilot from previously reviewed official project materials. That work is
pre-pilot structured-input preparation and evidence for a future raw-document
extraction stage; it is not included in the 39.834-second result.

| Gap classification                | Observed gap / disposition                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Structured-input preparation      | The two compatible JSON files were manually prepared before timing.                                                    |
| PDF/OCR extraction                | Raw official PDFs were not interpreted by Fast Intake v1.                                                              |
| Spreadsheet extraction            | No spreadsheet was processed; this remains outside v1.                                                                 |
| Normalization                     | Country is absent; canonical developer/location links are deliberately unresolved.                                     |
| Documentation                     | The specified incoming `README.txt` control note was absent.                                                           |
| Source-data absence               | Seven sold villas have null source prices; price-list date, coordinates, and construction status are absent.           |
| Fast Intake implementation defect | None found.                                                                                                            |
| Product decision                  | Decide the smallest source-backed preparation stage for ordinary dossiers without weakening anti-fabrication controls. |

The principal missing automation remains creating compatible structured JSON
from raw developer materials. Fast Intake v1 did not interpret raw PDFs, did
not calculate price per sqm, and did not turn villa types into buildings.

## Validation

- Fast Intake CLI: passed; importer-compatible local validation passed.
- Windows `-ValidateOnly`: passed with process-scoped execution-policy bypass.
- Windows parity corpus: passed, 65 cases agree.
- Focused Fast Intake test suite: 202 passed; one live-parity subtest is blocked
  by the host policy because it launches PowerShell without the bypass. This is
  an environment limitation; the direct 65-case harness passed.
- TypeScript: `npx.cmd tsc --noEmit` passed.

No production connection, database client, database import, real lead,
publication, or production write occurred. Coralina remains unpublished and
Factory autonomy remains A0 — Propose only.

## Recommended next checkpoint

Design, but do not implement in this pilot, the smallest source-backed
structured-input preparation stage that turns an ordinary project dossier into
`project-facts.json` and extracted price-list JSON while retaining provenance,
missing-fact handling, and anti-fabrication controls.
