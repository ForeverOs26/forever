# Structured Input Preparation - Design v1

Status: Approved canonical design - independently reviewed and Owner approved
Authoritative base: `6bb1c66e1e7081811f308140dcb0c3f4935ac7e6`
Approved reviewed PR head: `0a703e31d3f940a1000d23f90dc448f249212b4e`
Review date: 2026-07-20

## Purpose and evidence discipline

Structured Input Preparation (SIP) is an approved local-only stage before Fast Intake. It turns a reviewed subset of a raw developer dossier into unchanged `project-facts.json` and `ExtractedPriceList` inputs. It is not an importer, payload builder, database client, publisher, OCR system, AI agent, or Factory executor.

Evidence labels:

- **[R]** directly verified repository fact at the authoritative base;
- **[E]** repository record of prior real-project work;
- **[D]** approved design decision or Owner policy;
- **[A]** assumption to be proved before implementation use; and
- **[U]** implementation question, not an Owner-policy question.

**[D]** Owner policies resolved here: SIP-001 prioritizes text-based PDF price lists; processing is local and offline; high-confidence deterministic cells may enter reviewed final JSON when every validator passes; all medium/low, ambiguous, conflicting, inferred, or duplicate-identity candidates require review; an edit is not `owner_verified` without separate explicit confirmation; reviewed non-sensitive final JSON and preparation records are tracked; raw material, temporary output, queues, renders, and sensitive data are not; and the 60-minute objective is a pilot target to measure, not a pass guarantee.

Coralina remains unpublished. Rainpalm remains unimported and unpublished. Partner Demo remains canonical. Factory remains A0 - Propose only.

## 1. Evidence reviewed and corrected

**[R]** `forever-data/projects/coralina/classification-log.json` records 343 classified source files from 15 incoming archives and standalone files, about 1.19 GB: 4 brochures, 2 price-list PDFs, 10 master-plan files, 198 unit-plan files, 119 media files (116 images and 3 videos), and 10 supplemental documents. Classification by name/path is inventory routing, not proof of content.

**[R]** Coralina `extracted/price-list.json` records two processed PDFs: the master-plan price list (7 pages, zero detected tables/rows), and `CLK - Price List V.2. - Updated 03.07.26.pdf` (4 pages, 4 detected tables, 198 rows). The latter is the only currently machine-proven text-table extraction case. It preserves date 2026-07-03 with raw 03.07.26, records THB as `inferred_default` from source-verified Thailand country evidence, and does not claim price-column currency evidence. The readiness audit records 95 size x price-per-sqm disagreements and does not recalculate source values.

**[R]** Coralina raw files are not tracked: tracked source entries at base are `.gitkeep` files. An Owner machine may contain ignored raw material, but that is not portable repository evidence. The historical OCR review records local Poppler `pdftoppm` 26.05.0 and Windows OCR for a separate identity task; it establishes neither an SIP OCR dependency nor qualification of another price list.

**[R]** Modeva has a committed project package and source classification record; saying no Modeva package exists is incorrect. The raw PDF is not committed as a portable fixture. Modeva migration/validation records 289 rows, a 2026-07-03 date, `Available` normalization, and THB policy. This proves manual transcription and downstream history, not a usable SIP-001 text layer.

**[R]** Rainpalm committed Fast Intake artifacts record 21 units, 14 positive prices, 7 source-null prices, 12 warnings, and `PARTIAL_READY_WITH_WARNINGS`. The pilot records 39.834 seconds wall-clock (0.133 seconds CLI) from compatible structured inputs to an unpublished validated draft. The raw brochure, price-list, and legal PDF are only described by provenance; no raw Rainpalm price-list PDF is committed. It cannot prove text-layer suitability.

**[E]** Prior reports record Coralina readiness effort of 4-8 focused hours and multiple audit passes. They record no comparable measured raw-dossier preparation duration for Modeva or Rainpalm.

**[D]** All three projects show PDF price lists and manual transcription are relevant. Only Coralina proves machine text-table extraction. Modeva and Rainpalm must be qualified from the actual authorized raw PDF before becoming SIP-001 fixtures. Text-PDF extraction is an evidence-informed narrow design decision, not a claim that every PDF is parser-compatible, text-based, or fully deterministic.

## 2. Boundary and staged flow

**[D]** SIP flow:

```text
raw dossier
-> safe inventory and classification
-> PDF text-layer qualification
-> deterministic table extraction
-> candidate-row normalization
-> deterministic validation
-> exception-only human review
-> final reviewed structured JSON
-> unchanged Fast Intake
```

Candidate output is not final accepted facts. Only high-confidence source-complete deterministic candidates passing every validator, or candidates explicitly accepted in review, enter final JSON. Rejected/unresolved candidates stay in a preparation report/decision record and never enter Fast Intake input. SIP does not build a Progressive payload; unchanged Fast Intake is the only sanitizer and payload builder.

**[D]** SIP reuses Fast Intake ZIP guards/reader, inventory, SHA-256/duplicate handling, and classification where technically possible: `src/intake/zip.ts`, `inventory.ts`, `classify.ts`, `extract.ts`, `sanitize.ts`, and the `run.ts` staging/atomic-artifact boundary. It must not create a second archive extractor or weaker ZIP boundary. A shared internal module is permitted only when direct reuse is impossible and it preserves existing behavior/tests.

Likely later SIP code is limited to `src/intake/sip/pdf-qualify.ts`, `pdf-text.ts`, `price-table.ts`, `candidate-normalize.ts`, `review.ts`, and fixture tests (or equivalent `src/sip/` placement if direct reuse requires it). This is design only. Source binaries remain immutable, the extraction workspace remains local and gitignored, and no raw file enters a browser or production code.

## 3. Exact current-contract compatibility

SIP emits no new input schema or unified vocabulary. A source reference is a portable logical path or existing `source_file`/`source_ref`, never an Owner-machine absolute path. Table/column evidence belongs in the preparation report because `Fact` has no table/column field.

| Output                 | Exact TypeScript type                                                                      | Allowed confidence/status                                                                                                                                                                                                                         | Source reference and missing representation                                                                                                    | Review requirement                                                                    | Fast Intake behavior                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Project facts root     | `IntakeProjectFacts` in `src/intake/types.ts`                                              | Optional `name`, `developer`, `location`, `location_area`, `country`, `project_type`, `short_description`, `full_description`                                                                                                                     | Omit unavailable fields; add no fields                                                                                                         | Non-high, ambiguous, conflicting, inferred, and unverified edits require review       | `normalizeToBatch` consumes only declared fields                                            |
| Project field          | `IntakeFact<string>`                                                                       | Confidence: `high`, `medium`, `low`, `none`; sanitizer accepts only first three. Status if supplied: `unverified`, `owner_verified`, `official_source`, `developer_provided`, `partner_provided`, `extracted`, `inferred`, `conflicting`, `stale` | Use `value: null` or omit; usable positive facts require `source_ref` or `source_file`; supplied `source_date` is ISO                          | High deterministic source transcription may pass; policy exceptions review            | `usableIntakeFact` rejects sentinels, missing refs, none/unknown confidence, invalid dates  |
| Price-list root        | `ExtractedPriceList` in `src/import/types.ts`                                              | Optional `price_list_date`, `currency_decision`, `unit_inventory`                                                                                                                                                                                 | Omit unsupported root values; use nested `Fact.value: null` for present unavailable cells                                                      | Date/currency ambiguity review                                                        | `sanitizePriceList` remains authoritative                                                   |
| Price-list cell        | `Fact<T>`, used in `ExtractedPriceListRow`                                                 | SIP emits `high`, `medium`, `low`, `none`. Exact `Fact.status`: `source_verified`, `inferred_default`, `unresolved`, `conflict`; never `extracted`                                                                                                | `source_file`, `page_number`, optional `sheet_name`; `source_row` is on row. Use null + none for a present unavailable cell; omit absent field | Medium/low, recovery, ambiguity, conflict, duplicate identity, inferred values review | Invalid facts nulled; invalid price/currency warned; missing unit identity skipped          |
| Currency               | `CurrencyDecision` in `src/import/currency-policy.ts`                                      | Status: `source_verified`, `inferred_default`, `unresolved`, `conflict`; confidence: `high`, `medium`, `none`                                                                                                                                     | Null value for unresolved/conflict; `CurrencyEvidence` holds file/page                                                                         | Inferred/unresolved/conflicting currency review                                       | `decideCurrency` owns country-default inference                                             |
| Progressive provenance | `FieldProvenance` / `FieldProvenanceMap` in `src/features/forever-ingestion/provenance.ts` | `unverified`, `owner_verified`, `official_source`, `developer_provided`, `partner_provided`, `extracted`, `inferred`, `conflicting`, `stale`; numeric confidence 0..1                                                                             | Portable `source_ref`; no SIP input field added                                                                                                | Only explicit accept-as-owner-verified produces `owner_verified`                      | Existing normalization/batch construction creates it; SIP does not substitute it for inputs |

These vocabularies are not interchangeable. `Fact.status: "source_verified"` describes an accepted source-exact price cell; it is not Progressive `field_provenance.status: "extracted"`. `CurrencyDecision.status: "inferred_default"` is only the existing currency-policy result. A review report may say machine-extracted but creates no input status enum.

## 4. SIP-001: one supported PDF slice

**[D]** SIP-001 deterministically extracts tables from a _qualified_ text-based PDF price list into unchanged `ExtractedPriceList`. It excludes project-facts automation, XLSX, OCR, scanned PDFs, images/floor plans, AI extraction, database/import/publication, admin UI, and Factory autonomy.

1. Run safe inventory/classification, content hash, and duplicate grouping first. Filename/path classification only makes a candidate; it is never proof the file contains prices.
2. A local PDF-text executable must produce non-empty page-addressable text. Record tool version, PDF hash, page count, text bytes per page, and output hash. Empty/near-empty text, encryption, parse error, or missing page mapping is `unsupported_layout`, not OCR fallback.
3. Select a price-list candidate only with recognizable price-table headers and at least one syntactically valid unit identity plus price/availability column. Competing versions, multiple eligible tables, or missing content evidence creates review; filename never chooses final source.
4. Discover pages/table regions from text layout. Keep page, table index, source row, column header, raw text, and text offsets in local report. Final rows use contract `source_row`, `source_file`, and `page_number`.
5. Map only a fixed explicit header dictionary. Unknown, duplicate, or shifted headers are unsupported/review. Multi-line/merged headers require fixture-backed unambiguous reconstruction. A continued row needs prior unambiguous unit identity and compatible repeated geometry. Extract multiple tables independently then reconcile identity.
6. Use `unit_number` when present. `unit_code` does not replace missing identity. Duplicate normalized identities block, consistent with `sanitizePriceList`.
7. Parse numeric separators using document-local evidence. Mixed/ambiguous separators are review/unsupported. Preserve `raw_value`; never round, calculate, or repair.
8. Blank, dash, sentinel, SOLD, zero, negative, or nonnumeric price becomes null with confidence none; retain the unit row. Never calculate price or price-per-sqm. Source discrepancies are warnings, never corrections.
9. Normalize known availability labels only with a versioned fixed mapping; unknown label is retained and reviewed. Extract date only from document content. Extract currency only from evidence applicable to selling-price column; fee labels are not price-currency evidence.

Fail closed for unusable text, unknown header, unsafe page/row mapping, ambiguous layout/separators/date/header, unresolvable continuation, duplicate identity, contradictory source cells, or parser recovery. Partial success is allowed only for independent qualified rows/tables: supported candidates may continue; unsupported rows/tables are reported, excluded from final input, and reviewed.

## 5. Local tooling decision

**[D]** Initial path: existing authorized local Poppler `pdftotext -layout` (or equivalent versioned Poppler text output), deterministic TypeScript parser/normalizer, and existing Fast Intake contracts/validators. Repository evidence records prior local Poppler, but current shell does not expose `pdftotext`; SIP-001A must preflight executable/version and this PR installs nothing. No Python runtime, cloud service, AI API, OCR, or paid dependency is selected.

Required later: authorized Poppler executable and recorded version. Later code: only narrow SIP modules/tests above. Optional fallback: separately approved local text extractor with equivalent deterministic page-addressable output. OCR remains out of scope and requires a new design checkpoint.

## 6. Human review policy

First slice uses CLI summary plus small machine-readable local review file, not a UI. Each item includes candidate, raw text, portable source ref, page/table/row/column, reason, and action.

- High-confidence deterministic cells with complete source references and passing validators may enter final JSON without per-cell Owner review.
- Medium/low, ambiguous headers, conflicting values, inferred currency, duplicate identities, unclear dates, and parser recovery require review.
- Accept retains actual status: normal source-exact price fact remains `source_verified`, not `owner_verified`.
- Edit records original and edit; it is not owner verification. Only separate explicit **accept as owner verified** creates `owner_verified` where receiving contract supports it.
- Reject/unresolved remains traceable in preparation report/decision record and is absent from final Fast Intake input.

## 7. Git, privacy, timing, and metrics

**[D]** Track reviewed non-sensitive final `project-facts.json`, final price-list JSON, preparation summary, and accepted/rejected decision record. Do not track raw PDF/XLSX/ZIP/image/video, temporary text, renders, transient workspaces/queues, credentials, client/passport/booking/contact/personal data, or unreviewed sensitive candidates. This is the future SIP boundary and does not rewrite history.

Two timing measures:

1. raw dossier -> reviewed structured JSON: pilot objective <=60 minutes for a supported qualified text-PDF dossier, measured on a real raw PDF;
2. reviewed JSON -> Fast Intake validated draft: existing Fast Intake measure.

Rainpalm 39.834 seconds proves measure 2 only, never measure 1. Safety/correctness override speed. SIP-001A reports unit-row recall against reviewed ground truth, exact unit-identity agreement, exact positive-price agreement, zero fabricated prices, zero lost null prices, source-reference completeness, byte-identical deterministic repeat, duplicate blocking, Fast Intake compatibility, review-item count, and manual-review time. Every metric has numerator/denominator; no vague accuracy percentage.

## 8. Pilot prerequisite and exact next task

Rainpalm is intended first SIP-001 pilot because reviewed structured result is comparison ground truth. Real validation cannot start until actual Rainpalm price-list PDF is present in an authorized local source folder. Committed payload does not imply raw PDF exists. Coralina extracted result may be a regression oracle; raw binaries are not committed portable fixtures.

> **SIP-001A - qualify and deterministically extract one supported text-based PDF price list into candidate `ExtractedPriceList` JSON, validate it, produce an exception-only review summary, and prove current Fast Intake consumes the reviewed result unchanged.**

Likely modules: shared Fast Intake safety modules plus narrow SIP modules in section 2. Tests: qualification, headers, continuation, separators, sentinels/nulls, duplicate blocking, refs, deterministic repeat, unchanged Fast Intake consumption. Prerequisites: authorized raw PDF, qualified text layer, Owner-approved Poppler path, reviewed ground truth. Executor: Claude Code with GPT-5.6 Terra-equivalent daily-development model; effort: normal focused development; then independent Codex repository/Windows audit. Done: every section 4/7 gate evidenced on one real supported PDF with no source, schema, Fast Intake, database, import, or publication change outside scoped implementation PR.

Explicit exclusions: project-facts automation, XLSX, OCR, scanned PDFs, image/floor-plan processing, AI extraction, database/import/publication, admin UI, Factory autonomy.

## 9. Remaining implementation questions

- **[U]** Confirm Owner-machine Poppler executable path/version in SIP-001A preflight; install no replacement in this PR.
- **[U]** Choose private module location only after direct-reuse analysis decides between `src/intake/sip/` and small shared boundary. Fast Intake behavior remains unchanged.

No Owner-policy decisions remain unresolved. Structured Input Preparation Design v1 is independently reviewed and Owner approved. SIP-001A is the active implementation checkpoint; implementation remains outside this design-canonicalization PR.
