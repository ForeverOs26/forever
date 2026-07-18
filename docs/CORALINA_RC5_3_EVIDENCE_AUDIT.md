# Coralina RC5.3 Evidence Audit

Task ID: RC5.3

Audit date: 2026-07-12

Status: Documentation-only re-audit of the two source-backed Project Knowledge Platform blockers (`developer.name`, `location.country`). No app code, database files, migrations, UI files, import flags, readiness rules, or source data were changed. No real import was run.

## Scope

RC5.3 is a focused data-completion pass: resolve `developer` and `country` for Coralina only if — and only where — real committed source material supports it, using the existing RC4.4–RC5.1 Project Knowledge Platform. This audit reviewed every committed Coralina artifact:

- `forever-data/projects/coralina/manifest.json`
- `forever-data/projects/coralina/import-status.json`
- `forever-data/projects/coralina/classification-log.json`
- `forever-data/projects/coralina/extracted/{brochure,price-list,masterplan,unit-plans,documents,images}.json`
- `forever-data/projects/coralina/source/**` (every committed file under every asset folder)
- `src/features/coralina-integration/data/coralina-facts.ts` and sibling data files
- `src/features/coralina-knowledge/{definition,facts,sources,profile,identity}.ts`
- `docs/CORALINA_FINAL_BLOCKERS.md`, `docs/CORALINA_READINESS_AUDIT.md`, `docs/CORALINA_EXTRACTION_REPORT.md`, `docs/CORALINA_CLASSIFICATION_REPORT.md`, and `docs/CORALINA_METADATA_FIX_REPORT.md`

## What was checked

- Searched every committed extracted JSON file for `developer`, `country`, and `thailand` (case-insensitive): the only matches are the two `null`-valued fields already recorded in `extracted/brochure.json` (`developer.value: null`, `location.country.value: null`, both `confidence: "none"`, `source_file: null`). No other extracted dataset mentions either field.
- Confirmed via `git ls-files forever-data/projects/coralina/source/**` that every tracked entry under every asset folder is `.gitkeep` — no PDF, image, or other binary source document is committed to the repository. This is enforced structurally by `.gitignore` (`forever-data/projects/coralina/source/*/*` is excluded, `.gitkeep` explicitly re-included), so it holds regardless of what a given local working copy happens to have on disk: a machine that ran the classification workflow (or that keeps the original `forever-data/incoming/Coralina` staging documents, or copies of them, alongside the repository) may legitimately show real files in `source/*/` locally without any of them being tracked or committed. Checking `git ls-files` rather than the raw filesystem is what makes this finding true across every clone, not just the one it was authored in. `classification-log.json` records that the 343 classified files were copied from `forever-data/incoming/Coralina` (itself an uncommitted, non-repository staging path never tracked by git), so the underlying documents the manifest's `metadata_evidence.developer_review`/`country_review` cite were reviewed once during classification but are not committed to this repository for independent re-verification.
- Raw document presence on a local disk is not, by itself, committed evidence: this repository's established extraction pattern (`src/features/coralina-knowledge/facts.ts`) requires a fact to be transcribed — with source, locator, page, excerpt, and confidence — into a committed dataset (`extracted/*.json`) before it can support a canonical field. Even where a real, uncommitted brochure file (in any language) is present on a given machine, that alone does not create or resolve a fact; a separate, explicit extraction pass would need to commit the transcribed developer/country statement (if one exists in that document) to `extracted/brochure.json` and `manifest.json`. That pass is a distinct task from this audit and is out of scope here (this stage performs no OCR and no AI extraction).
- Confirmed `manifest.json` still records `"developer": "SOURCE_PENDING"` and `"country": "SOURCE_PENDING"`, with `metadata_evidence.developer_review.reason` and `.country_review.reason` unchanged from RC5.0/RC5.1.
- Confirmed `import-status.json` still lists `developer` and `country` under `mandatory_metadata_review.still_blocked[]`, each with a `required_source` description, and still records `ready_for_import: false`.
- Confirmed no commit has touched `forever-data/projects/coralina/**` since the RC3 buildings-import stage (`git log -- forever-data/projects/coralina`) — no new source material has been committed for this project since before RC5.0 ran the chain end to end.
- Confirmed the unit-type dispute (`units.unitTypes`, price list vs. unit-plan image vocabulary) is untouched by this audit and remains a `contested`/`requires_review` finding with both conflicting facts withheld from the canonical record — RC5.3 does not resolve it.

## Finding

Neither blocker has sufficient committed source evidence. No committed document, extracted dataset, or repository artifact explicitly names Coralina's developer or states Coralina's country. The only local evidence bearing on developer identity (`The Title`, `AssetWise`, `Rhom Bho Property` branding on an unrelated company-profile document) is explicitly not Coralina-specific, and the only local evidence bearing on country (`Kamala`, `Phuket`) never escalates to naming the country itself.

This matches Decision Rule 3 (neither blocker has sufficient evidence): **no fact is added for either path.**

## Action taken

- `src/features/coralina-knowledge/facts.ts` — `CORALINA_EXPECTED_MISSING_PATHS` reasons for `developer.name` and `location.country` were extended (data only, no engine change) with the exact source-acquisition requirement below, transcribed verbatim from `import-status.json`'s `required_source` fields so the internal inspection route (`/internal/coralina`, `/internal/projects/coralina`) surfaces the precise evidence still needed, not just the fact that it is missing.
- Both gaps keep `manifestBlocker: true`, so RC4.9 readiness continues to treat them as `required` — the readiness profile, cross-source validation, canonical merge, and knowledge graph are unchanged.
- No timestamp was fabricated: the slice's stated `describedAt` clock (`2026-07-12T00:00:00.000Z`, already the RC5.1 value) is unchanged, since this audit did not re-author the extraction facts, only the gap reason text.

## Exact source evidence still needed

| Missing fact | Evidence needed |
| --- | --- |
| Developer (`developer.name`) | A Coralina-specific brochure, company profile page, sales sheet, contract page, or official developer statement that explicitly names Coralina's developer. |
| Country (`location.country`) | A Coralina-specific location, address, map, brochure, or legal/developer document that explicitly states the country. |

## Resulting readiness standing

Unchanged: `blocked`. `slice.readiness.report.standing === "blocked"` for the same two `required` `field_present` evaluations (`developer.name`, `location.country`); all other RC4.4–RC4.9 judgements (15 admitted facts, 2 withheld unit-type facts, 1 contested subject, 1 corroborated subject) are pinned identical by the existing RC5.0/RC5.1 test suite.

## Application-visible result

`/internal/coralina` and `/internal/projects/coralina` (both `noindex`, `nofollow`, internal-only) now render the extended gap reasons under "Missing information," so the exact evidence still required is visible next to each unresolved blocker. Coralina is not exposed publicly; it was not before this audit and remains not ready under the existing readiness rules.

## Next required action

Locate and commit real Coralina-specific source material — per the table above — under `forever-data/projects/coralina/source/`, then re-run this audit. No fabrication, inference from branding/marketing context, folder names, or prior conversation knowledge is an acceptable substitute.

## Validation performed

- Grepped all six extracted JSON files and `classification-log.json` for `developer`, `country`, `thailand` (case-insensitive) — no undiscovered evidence found.
- Verified every `source/*` folder contains only `.gitkeep`.
- Verified `git log -- forever-data/projects/coralina` shows no commit since the RC3 buildings-import stage.
- Verified `manifest.json` and `import-status.json` still record `SOURCE_PENDING` / `still_blocked` for both fields.

No real import was run. No application code, database, migration, UI, or route was changed.
