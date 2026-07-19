# Structured Input Preparation — Design v1

Status: Design only — awaiting independent review and Owner approval
Base commit: `6bb1c66e1e7081811f308140dcb0c3f4935ac7e6`
Date: 2026-07-19

This document designs the smallest reliable, source-backed Structured Input
Preparation (SIP) stage that converts an ordinary real-estate developer dossier
into the two compatible structured artifacts required by Fast Intake v1:

1. `project-facts.json` (the existing Fast Intake identity-fact contract);
2. an extracted price-list JSON compatible with the existing
   `ExtractedPriceList` contract (`src/import/types.ts`).

It authorizes no implementation, no extractor, no OCR, no AI agent, no parser,
no database work, no import, and no publication. Coralina and Rainpalm remain
unpublished; Rainpalm remains unimported; Factory remains A0 — Propose only.

Evidence classes used throughout, kept explicitly separate:

- **[R] Confirmed repository fact** — verified directly in the repository at
  the base commit.
- **[E] Evidence from real project materials** — read from committed project
  packages, reports, and migrations that record the real Modeva, Coralina, and
  Rainpalm preparation work.
- **[D] Design decision** — a decision this document makes.
- **[A] Assumption** — believed true but not provable from the repository.
- **[U] Unresolved question** — requires the Owner or later evidence.

---

## 1. Executive decision

**[D]** Forever adds exactly one generic stage — Structured Input Preparation —
between raw developer materials and Fast Intake v1:

```
raw developer dossier (folder / ZIPs)
  → Structured Input Preparation (propose → verify → human review)
  → project-facts.json + extracted price-list JSON (existing contracts, unchanged)
  → Fast Intake v1 (unchanged)
  → validated unpublished Progressive draft
```

**[D]** The first implementation slice (SIP-001) is **deterministic extraction
of price-list tables from text-based PDF price lists** into the existing
`ExtractedPriceList` shape, with a mandatory human review step for everything
the parser cannot prove. Project facts remain Owner-prepared in SIP-001, using
a documented checklist over the existing `project-facts.json` contract.

**[D]** The recommended architecture for SIP-001 is **Option A — deterministic
local parsers** (no OCR, no computer vision, no AI dependency, no network).
The recommended long-term direction is **Option C — hybrid staged extraction**
(deterministic first, AI only for semantic mapping under deterministic
validation and human review), adopted only when a real project proves the
deterministic path insufficient.

**[D]** SIP produces proposals, never confirmed facts. Every emitted value
carries an exact source reference; everything else is omitted with an explicit
warning. SIP never imports, never publishes, never touches a database, and
never resolves canonical developer/location records.

Rationale in one line: across all three real projects the price list was a
PDF price table (machine text extraction is proven for Coralina and is the
working assumption for the other two — § 3.1) and its manual transcription
dominated preparation effort, while
project identity facts were few, fast to enter, and frequently required human
judgment that no extractor can replace (see § 3).

---

## 2. Rainpalm pilot lesson

**[R]** Rainpalm Fast Intake Pilot 01 (`docs/FAST_INTAKE_PILOT_01_RAINPALM.md`)
measured 39.834 seconds wall-clock from compatible structured inputs to a
validated unpublished draft; the CLI itself took 0.133 seconds. The result was
`PARTIAL_READY_WITH_WARNINGS`: 1 project, 0 buildings, 21 units, 14 prices,
12 warnings. Rainpalm was not imported and not published.

**[R]** The pilot's own gap table records that the two JSON inputs
(`project-facts.json`, `price-list.json`) were manually prepared before timing,
and names structured-input preparation as the principal missing automation.
Fast Intake itself had no implementation defect.

**Lesson [D]:** the bottleneck is upstream of Fast Intake. The correct
investment is the smallest preparation stage that removes manual transcription
of the highest-volume artifact (the price-list table) while leaving human
judgment where the evidence shows it is genuinely required (identity facts,
currency evidence, conflicts). The 39.834-second pilot result must never be
combined with raw-extraction timing (§ 12).

---

## 3. Actual Modeva / Coralina / Rainpalm preparation comparison

### 3.1 What each dossier actually contained

**[E]** Coralina is the only project with a fully classified committed dossier
record (`forever-data/projects/coralina/`, raw binaries deliberately not
committed — `source/*/` holds only `.gitkeep`). Its classification record
(`classification-log.json`, `docs/CORALINA_CLASSIFICATION_REPORT.md`,
`import-status.json`) counts 343 source files (~1.19 GB) from 15 incoming ZIP
archives plus standalone PDFs:

| Material                | Count | Real type observed                                                                                |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------- |
| Brochures               | 4     | text-based PDFs (27–33 MB each)                                                                   |
| Price lists             | 2     | **text-based PDFs** (`CLK - Price List V.2. - Updated 03.07.26.pdf`, 4 pages, 4 tables, 198 rows) |
| Master plan             | 10    | 1 PDF (~158.7 MB) + 9 JPG images — visual only                                                    |
| Unit/floor plans        | 198   | JPG images — visual only                                                                          |
| Marketing images/videos | 119   | JPG/PNG/webp + 3 MP4                                                                              |
| Documents               | 10    | company-profile PDF, facilities PDF, furniture PDFs, map PDF + JPEGs                              |

**[E]** Modeva has no committed dossier (`forever-data/projects/modeva/` does
not exist; `src/features/modeva-knowledge/sources.ts` states no developer
package was committed). The single named raw source is one text price-list PDF
(`MOB - Price list V.2. - Updated 03.07.2026.pdf`) whose 289 unit rows were
manually transcribed verbatim into migration
`supabase/migrations/20260707105000_fdb002c_import_modeva_units.sql` with
per-row `source_file`, `source_page`, `source_row`, and raw metadata.

**[E]** Rainpalm's committed package (`forever-data/projects/rainpalm-villas/`)
contains only the Fast Intake artifacts. Its payload provenance names three raw
materials that were manually read during pre-pilot preparation: a brochure PDF
(`For PDF Presentation.pdf`, pages 1, 3, 5, 7–8), a price-list PDF, and a legal
document (`Rainpalm Legal and Ownership.pdf`) that supplied the THB currency
evidence.

**Classification census across all real dossiers observed so far [E]:**
PDF price lists — 3 of 3 projects; Excel/XLSX price lists — 0 of 3;
scanned-PDF-only price lists — 0 of 3 known; structured JSON — only when
manually prepared; images/floor plans/master plans — plentiful but
visual-only; legal
and developer-profile documents — present and load-bearing for currency and
developer evidence. Precision note: the Coralina price-list PDF is
machine-proven text-extractable (4 tables detected, 198 rows extracted, per
`extracted/price-list.json` `files_processed`); the Modeva and Rainpalm price
PDFs were manually transcribed, so their text layers are a working assumption
**[A]**, not committed evidence.

### 3.2 Reconstructed manual steps

**[E]** Modeva (`docs/IMPORT_ENGINE_MODEVA_REAL_RUN.md`,
`docs/VALIDATION_MODEVA.md`, `src/features/modeva-knowledge/facts.ts`):

| Step                                                                                      | Nature                      | Judgment needed |
| ----------------------------------------------------------------------------------------- | --------------------------- | --------------- |
| Transcribe 289 price-list rows from one text PDF into SQL VALUES with per-row source refs | deterministic transcription | none            |
| Normalize `03.07.2026` → `2026-07-03`, `Available` → `available`                          | deterministic rule          | none            |
| Record THB as explicit import policy in the migration header                              | policy decision             | yes             |
| Refuse placeholder seed values (“Under review”, trust 0) as facts                         | anti-fabrication            | yes             |
| List coordinates, beach distance, completion, starting price, yield as missing            | anti-fabrication            | none            |

**[E]** Coralina (`docs/CORALINA_READINESS_AUDIT.md`,
`docs/CORALINA_EXTRACTION_REPORT.md`, `docs/CORALINA_RC5_4_TARGETED_OCR_REVIEW.md`,
`forever-data/projects/coralina/`):

| Step                                                                                                                                                                                                                                                                                            | Nature                                  | Judgment needed                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------- |
| Classify 343 files from 15 ZIPs into source folders                                                                                                                                                                                                                                             | interpretive (filename/content)         | mapping decisions                |
| Extract 198 unit rows from the 4-page text price-list PDF into `Fact`-per-cell JSON                                                                                                                                                                                                             | deterministic (text-extractable tables) | none for row values              |
| Normalize price-list date `03.07.26` → `2026-07-03` (initially missed, fixed in COR-004A)                                                                                                                                                                                                       | deterministic rule                      | none                             |
| Currency: price columns state no currency; page-4 THB labels apply only to fees → THB recorded as `inferred_default` (rule `project_country_default_currency` v1.0.0), never as source-verified                                                                                                 | policy inference, explicitly stamped    | yes                              |
| 95 of 198 rows: `size_sqm × price_per_sqm ≠ price` — recorded as source discrepancy, **not** recalculated                                                                                                                                                                                       | anti-fabrication                        | yes                              |
| Identity facts (name, province, location, type) from brochure/facilities pages with `{source_file, page_number, confidence}`                                                                                                                                                                    | mixed: text extraction + visual reads   | some (project type, map reading) |
| Developer + country: unresolvable from the local dossier; targeted RC5.4 review rendered 34 PDF pages (Poppler `pdftoppm` 26.05.0) and ran local-only OCR (`Windows.Media.Ocr`), still insufficient; resolved only via official web sources (developer corporate history + Thailand SEC filing) | interpretive, escalation                | substantial                      |
| Bathrooms, per-row currency, payment terms, promo notes left `null` with `confidence: "none"`                                                                                                                                                                                                   | anti-fabrication                        | none                             |

**[E]** Recorded manual effort (Coralina, `docs/CORALINA_READINESS_AUDIT.md`):
4–8 focused hours to readiness — OCR/visual verification of developer+country
1–2 h; manifest/status updates 15–30 min; price-date normalization plus the
95-row price-arithmetic review 1–3 h; metadata review 1–2 h; final validation
30–60 min. Calendar time spanned multiple audit passes (2026-07-08 →
2026-07-13). Modeva and Rainpalm packages record no effort figure.

**[E]** Rainpalm (pre-pilot preparation, reconstructed from payload provenance
and the pilot record): manually read the brochure PDF for six identity facts
(`source_ref` in the form `For PDF Presentation.pdf#page=1`), manually
transcribed 21 villa rows with 14 positive prices and 7 explicit source-null
prices, and took THB from the legal/ownership document as row-level
`source_verified` evidence. Effort was not measured; it happened before the
timed window.

### 3.3 Cross-project findings that drive this design

1. **[E]** The price-list table is the dominant transcription burden (289,
   198, 21 rows) and was fully deterministic in every observed case, because
   every observed price list was a text-based PDF.
2. **[E]** Identity facts are few (≤ 8 fields) but repeatedly needed human
   judgment (developer vs. brand vs. shareholder; country never printed in
   local materials; project type as a broad label).
3. **[E]** OCR was a last resort, used once (RC5.4), locally, on 34 pages —
   and still insufficient without official web sources. Nothing observed makes
   OCR a majority requirement.
4. **[E]** Four provenance/confidence vocabularies already coexist in
   committed artifacts (Coralina `extracted/*` `Fact` status vocabulary;
   Progressive `field_provenance` statuses with numeric confidence; Rainpalm
   intake `IntakeFact`; Modeva `ExtractionFact` in code). **[D]** SIP must not
   add a fifth: its two outputs use exactly the two vocabularies Fast Intake v1
   already consumes (§ 5).
5. **[E]** Anti-fabrication behavior is already precedent, not theory: null
   bathrooms, null currency cells, refused placeholder seeds, un-recalculated
   price mismatches, seven sold villas with null prices.

**[A]** Environment limitation, stated honestly: this design was produced in a
remote session containing the repository only. The Owner-machine folders named
in the task (`C:\forever\forever-data\...`, `C:\forever-incoming\Rainpalm`) and
all raw binaries were not directly inspectable; `C:\forever-incoming\Rainpalm`
may no longer exist (the pilot already recorded its `README.txt` as absent).
The evidence above is the committed repository record of that material, which
is the only durable, review-stable record in any case.

---

## 4. Canonical Structured Input Preparation boundary

### 4.1 Position and non-duplication

**[D]** SIP is one generic stage. It ends exactly where Fast Intake v1 begins:
at two structured JSON files on local disk. It reuses Fast Intake's existing
inventory, classification, ZIP-safety, and category vocabulary concepts
(`src/intake/`) rather than re-specifying them, and it must never grow a second
payload builder, fingerprint, currency policy, validation boundary, or
ingestion contract. If SIP and Fast Intake ever disagree about a value, Fast
Intake's sanitization (`src/intake/sanitize.ts`) remains the authority and will
drop or block it.

### 4.2 Inputs

- **Form [D]:** one folder and/or one or more ZIP archives — identical to Fast
  Intake's accepted input, so the same dossier copy serves both stages.
- **Archive safety [D]:** the hardened untrusted-ZIP boundary specified for
  Fast Intake v1 (`docs/FAST_INTAKE_V1.md`: traversal, absolute paths, drive
  letters, reserved names, collisions, encrypted entries, ZIP64, symlinks,
  CRC/size verification, and the documented resource limits: 2 GiB archive,
  100,000 entries, 1 GiB single file, 8 GiB total, 200× ratio) applies
  unchanged. Nested archives are classified, warned, and not unpacked.
- **Supported for extraction in SIP-001 [D]:** text-based PDF price lists, and
  already-structured JSON (passed through untouched for Fast Intake).
- **Classified but not extracted [D]:** brochures, XLSX/CSV, scanned PDFs,
  images, floor/master plans, payment plans, legal documents, developer
  profiles, maps, media, unknown files. They are inventoried with the existing
  category vocabulary and surfaced to the Owner as evidence candidates for
  manual facts — never machine-interpreted in SIP-001.
- **Size expectations [E→D]:** real dossiers reach ~1.2 GB with single files
  up to ~159 MB; SIP must handle that without loading whole binaries into
  memory, and only ever parses files classified `price-list` with a `.pdf`
  extension whose text layer is present.
- **Duplicates [D]:** byte-identical files are grouped by SHA-256 exactly as
  the Fast Intake source manifest already does; only the duplicate-primary is
  parsed; duplicates are recorded, never double-extracted.
- **Sensitivity [D]:** raw dossiers may contain personal data (reservation
  names, phone numbers). SIP output artifacts must never carry personal data;
  any cell recognized as a person/contact column is dropped with a warning and
  listed for review. Raw source files are read-only and never modified,
  committed, or transmitted.

### 4.3 Outputs

Exactly, all local files:

1. `project-facts.json` — the existing Fast Intake contract, unchanged.
2. extracted price-list JSON — the existing `ExtractedPriceList` contract,
   unchanged, one `Fact` per cell with exact source references.
3. a preparation summary/report (JSON + short human-readable summary):
   sources inspected, tables found, rows proposed/accepted/rejected, warnings,
   review decisions, elapsed time.
4. unresolved-fact warnings — explicit list of every field and row SIP could
   not support (missing, ambiguous, conflicting, rejected).
5. optional review queue — the pending human-review items (§ 8) when review
   has not yet completed.

**[D]** Outputs 1–2 must be directly consumable by current Fast Intake v1 with
no adapter and no schema fork. The acceptance test is literal: run
`npm run intake` over the SIP output directory and obtain a validated draft.

### 4.4 Responsibilities

SIP **may**: identify candidate facts; extract table cells; retain exact
source references (file, page, table, row, column); assign confidence; assign
provenance status from the existing vocabularies only; normalize safe values
(whitespace, date format, thousands separators, availability labels);
flag ambiguity; omit unsupported values; request human confirmation.

SIP **may not**: publish; import; create database identifiers; resolve
canonical developer/location records (they stay `NULL` for offline dependency
resolution); invent currency, dates, or prices; treat filenames or folder
names as facts; convert uncertain values into confirmed facts; silently
resolve conflicting sources; or weaken any Fast Intake guard.

---

## 5. Output contracts in detail

### 5.1 `project-facts.json` rules (contract unchanged)

**[R]** The consuming contract is `IntakeProjectFacts` / `IntakeFact`
(`src/intake/types.ts`): fields `name`, `developer`, `location`,
`location_area`, `country`, `project_type`, `short_description`,
`full_description`; each an `IntakeFact` with `value`, `source_file`/`source_ref`,
optional `source_type`, optional ISO `source_date`, `confidence`
(`high|medium|low|none`), optional `status` from the Progressive provenance
vocabulary (`src/features/forever-ingestion/provenance.ts`). Fast Intake drops
any fact without a usable value, usable confidence, and present source
reference (`usableIntakeFact`, `src/intake/sanitize.ts`). **[D]** No new
required fields; no second provenance vocabulary.

**[D]** Shared rules for every field: source reference format is
`<exact source filename>#page=N` (or `#pages=N-M`), matching the committed
Rainpalm precedent; sentinel values (`Not available`, `TBD`, dashes, …) are
never emitted; a missing field is omitted entirely (never an empty string);
`confidence: "none"` values are never emitted (omission + warning instead);
conflicting candidate values from different sources are never auto-resolved —
both candidates go to the review queue and nothing is emitted until a human
decides; `source_date` is emitted only when the document itself states a date.

Per-field rules (SIP-001: all eight fields are Owner-entered through the
checklist; the table also fixes the rules any later machine proposer must obey):

| Field               | Acceptable sources                                                        | Method (SIP-001)    | Normalization                               | Confidence                                                            | Status                                                           | Conflict / missing behavior                                                                                                                            | Human confirmation                     |
| ------------------- | ------------------------------------------------------------------------- | ------------------- | ------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `name`              | brochure cover/title page, price-list header, legal doc                   | Owner transcription | trim only                                   | `high` when printed verbatim                                          | `developer_provided` (or `official_source` for official filings) | differs from CLI name → Fast Intake records `project_name_source_differs`; missing → CLI name supplies display name                                    | always reviewed (it names the project) |
| `developer`         | legal/ownership doc, company profile, official filing                     | Owner transcription | trim; keep legal form suffix                | `high` only from legal/official docs; `medium` from brochure branding | `official_source` for filings; `developer_provided` otherwise    | brand vs. developer vs. shareholder ambiguity (Coralina lesson) → review queue, emit nothing until resolved                                            | always                                 |
| `location`          | brochure location page, map document text, legal doc                      | Owner transcription | trim                                        | `high` printed; `medium` read from map imagery                        | `developer_provided`                                             | missing → omit; Fast Intake warns `location_missing`                                                                                                   | at `medium` or below                   |
| `location_area`     | same as `location`                                                        | Owner transcription | trim                                        | as above                                                              | `developer_provided`                                             | missing → omit (optional field)                                                                                                                        | at `medium` or below                   |
| `country`           | legal doc, official filing, government source — never geography knowledge | Owner transcription | plausibility check only (`isUsableCountry`) | `high` only when a document states it                                 | `official_source` / `developer_provided`                         | never inferred from province/city/general knowledge (Coralina: local dossier never printed “Thailand”); missing → omit; currency then stays uninferred | always                                 |
| `project_type`      | brochure/facilities text                                                  | Owner transcription | keep source wording                         | `medium` typical (broad labels)                                       | `developer_provided`                                             | missing → omit                                                                                                                                         | at `medium` or below                   |
| `short_description` | brochure text, verbatim or lightly trimmed                                | Owner transcription | trim, no rewriting into claims              | `medium`                                                              | `developer_provided`                                             | marketing claims must not be upgraded into investment facts                                                                                            | always                                 |
| `full_description`  | brochure text                                                             | Owner transcription | as above                                    | `medium`                                                              | `developer_provided`                                             | as above                                                                                                                                               | always                                 |

**[D]** `owner_verified` is never a default: it is applied only through an
explicit review action (§ 8), consistent with the Progressive precedence rule
that `owner_verified` yields only to another owner action.

### 5.2 Extracted price-list JSON rules (contract unchanged)

**[R]** The consuming contract is `ExtractedPriceList` /
`ExtractedPriceListRow` / `Fact` (`src/import/types.ts`): per-cell
`{value, raw_value?, source_file?, page_number?, sheet_name?, confidence?, status?}`
with `status ∈ {source_verified, inferred_default, unresolved, conflict}`, plus
`price_list_date` and optional `currency_decision`
(`src/import/currency-policy.ts`). Fast Intake's sanitizer already drops rows
without usable unit identifiers, non-positive/non-numeric prices, unsupported
currencies, and malformed dates, and **blocks** on duplicate unit identifiers.

**[D]** Extraction rules per field. Every emitted cell carries
`source_file` (exact filename), `page_number`, and `source_row`; `raw_value`
preserves the verbatim source text whenever normalization changes it;
`sheet_name` stays `null` for PDFs and carries the sheet name if XLSX support
arrives (SIP-002). `status: "source_verified"` is used only for values read
verbatim from the document; nothing in SIP ever emits `inferred_default`
except the existing currency policy via `currency_decision`.

| Field                      | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit_number`              | Row identity. Verbatim from the identifier column. A row with no usable identifier is not emitted (recorded as a skipped-row warning).                                                                                                                                                                                                                                                                                                 |
| `unit_code`                | Verbatim when a distinct code/type-code column exists; otherwise omitted. Never synthesized from `unit_number`.                                                                                                                                                                                                                                                                                                                        |
| `building`                 | Verbatim from a building column, or propagated from an explicit building section header (§ 5.3 merged-cell rule). Never parsed out of the unit number (that is filename-style inference at cell level).                                                                                                                                                                                                                                |
| `floor`                    | Verbatim from a floor column only.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `unit_type`                | Verbatim label (e.g. `1 BEDROOM LA`, `Pool Villa Type A`).                                                                                                                                                                                                                                                                                                                                                                             |
| `bedrooms`                 | From an explicit bedrooms column only. Deriving from a type label requires an explicit, source-backed, Owner-confirmed mapping rule recorded in the report — otherwise omitted (`confidence: "medium"` maximum when a confirmed mapping is used, matching the Coralina precedent).                                                                                                                                                     |
| `bathrooms`                | Explicit column only; otherwise omitted (Coralina precedent: null with `confidence: "none"` → SIP simply omits the fact).                                                                                                                                                                                                                                                                                                              |
| `size_sqm`                 | Numeric parse of an explicit area column; `raw_value` keeps the source string.                                                                                                                                                                                                                                                                                                                                                         |
| `price`                    | Numeric-parseable, strictly positive values only. A blank, dash, `SOLD`, or zero cell yields **no price fact** (`value: null`, `confidence: "none"`) — never 0, never a guess. Sold/reserved rows keep their unit row without a price (Rainpalm precedent: 7 sold villas, null prices).                                                                                                                                                |
| `currency`                 | Only when the document states a currency for the price column of that table (symbol or ISO code in header/cells). A currency label attached to a different column (Coralina: THB on fee columns only) is **not** price-currency evidence. No silent THB. Anything else stays null; the currency decision then belongs to the existing `decideCurrency` policy using country evidence, stamped `inferred_default` with rule id/version. |
| `price_per_sqm`            | Extracted only when a column exists. **Never calculated** from price and size, and price is never calculated from it — the Coralina 95-row mismatch proves derived arithmetic misrepresents the source. Cross-checks may generate warnings, never values.                                                                                                                                                                              |
| `availability_status`      | Verbatim `raw_value`, normalized only via a fixed table (`Available→available`, `Sold→sold`, `Reserved→reserved`, case/whitespace-insensitive). Unknown labels stay verbatim and are flagged for review.                                                                                                                                                                                                                               |
| `payment_terms`            | Verbatim text from an explicit column/legend; otherwise omitted.                                                                                                                                                                                                                                                                                                                                                                       |
| `promotion_discount_notes` | Verbatim text; otherwise omitted.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `price_list_date`          | Only from a date printed on the document (title, header, footer). Normalized to ISO `YYYY-MM-DD` with `raw_value` preserved (`03.07.26 → 2026-07-03` precedent). Never from file-modified time or filename. Ambiguous day/month ordering → review queue, not a guess.                                                                                                                                                                  |

### 5.3 Table mechanics

- **Row identity [D]:** `(source_file, page_number, table_index, source_row)`
  is recorded for every emitted row; `unit_number` is the logical identity.
- **Duplicate units [D]:** duplicates within or across tables of one price
  list are a fail-closed condition: SIP refuses to emit the price-list JSON
  until a human resolves them in review; this mirrors — and fires earlier
  than — Fast Intake's blocking `IntakeConflictError`.
- **Merged cells / section headers [D]:** a value spanning rows (e.g. a
  building header above its units) may be propagated only when the text layout
  proves the grouping (a header line with no other row content); each
  propagated cell records the header's page/line as its reference. Anything
  ambiguous → review queue.
- **Multiple tables and pagination [D]:** tables are extracted per page and
  concatenated in document order; a header row repeated on each page is
  detected by exact header-text match and not emitted as data. Column meaning
  is never carried across tables with different headers — each table's headers
  are mapped independently, and unrecognized headers go to review.
- **Decimal/thousands separators [D]:** `1,234,567.89` style is parsed by
  default (all observed evidence uses it); a document whose numbers are
  ambiguous (`1.234` with no fractional context) is not silently parsed —
  the column goes to review with samples.
- **Null and placeholder cells [D]:** the Fast Intake sentinel list
  (`src/intake/sanitize.ts`) is reused verbatim; sentinels yield omitted
  facts, never values.
- **Invalid rows [D]:** a row failing structural parse is skipped with a
  warning naming file/page/row — partial extraction is normal and explicit,
  never silent.
- **Partial extraction [D]:** SIP always emits the maximum safe subset plus
  warnings; it fails closed only for duplicate identities, unreadable files,
  or a document with no recognizable table.
- **Conflicting price-list versions [D]:** two price-list files in one dossier
  are never merged. SIP proposes the one with the newer printed
  `price_list_date` when both are dated; otherwise the choice is a review
  decision. The unchosen file is recorded in the report as present-but-unused.
  (Fast Intake's current deterministic behavior — first by path with a
  `multiple_price-list` warning — remains the downstream authority if both are
  left in place.)

---

## 6. Selected first slice and deferred slices

Candidates evaluated:

| #   | Slice                                | Frequency in real dossiers [E]         | Complexity | Reliability                                                           | Source-ref accuracy             | Anti-fabrication risk                            | Review burden                    | Time saved                                         | Dependency cost               | Value for next project |
| --- | ------------------------------------ | -------------------------------------- | ---------- | --------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------ | -------------------------------- | -------------------------------------------------- | ----------------------------- | ---------------------- |
| 1   | Project facts from text brochures    | brochures common, facts few            | medium     | medium                                                                | good (page refs)                | **high** (marketing text, developer/brand traps) | high (every fact)                | low (≤ 8 fields, minutes by hand)                  | low                           | low                    |
| 2   | Price-list tables from XLSX          | **0 of 3 observed projects**           | low-medium | high                                                                  | excellent (sheet/row/col)       | low                                              | low                              | high _if XLSX appears_                             | low                           | speculative            |
| 3   | **Price-list tables from text PDFs** | **3 of 3 observed projects (PDF)**     | medium     | high (text layer proven for Coralina; assumed for the others — § 3.1) | exact (file/page/table/row/col) | low (verbatim cells)                             | low (spot-check + flagged cells) | **highest** (289/198/21 rows were the manual bulk) | one local PDF-text dependency | **direct**             |
| 4   | OCR for scanned PDFs                 | 0 of 3 required it for price data      | high       | medium                                                                | weak (no text anchors)          | high                                             | high                             | none yet                                           | high                          | none yet               |
| 5   | Image / floor-plan interpretation    | plentiful files, but visual-only media | very high  | low                                                                   | weak                            | very high                                        | very high                        | low                                                | high                          | none                   |
| 6   | Generic AI document extraction       | n/a                                    | high       | unproven                                                              | must be forced                  | high without hard validators                     | medium                           | broad but unproven                                 | high (model/service)          | premature              |

**Selected [D]: slice 3 — deterministic text-based-PDF price-list extraction**
(SIP-001), plus the zero-code project-facts checklist. It attacks the measured
majority of manual effort, matches 3-of-3 observed evidence, produces exact
source references, and adds at most one small, local, deterministic
dependency (PDF text extraction — candidates for evaluation at implementation
time, e.g. Poppler `pdftotext -layout`, already precedented by RC5.4's local
Poppler use, versus a pure-JS text extractor; chosen by the SIP-001 task under
the dependency rules, not by this design).

**Deferred [D]:**

- Slice 1 (brochure facts): deferred because the fields are few and the
  observed failure mode is judgment (developer vs. brand, country never
  printed locally), which automation cannot shortcut; the checklist plus review
  queue capture the same value at zero implementation cost.
- Slice 2 (XLSX): deferred until a real dossier contains one; it is the
  natural SIP-002 because the parsing is even more deterministic
  (`sheet_name`/row/column references are native to the existing `Fact` shape).
- Slice 4 (OCR): deferred — the preferred path avoids OCR unless real
  evidence proves it unavoidable for the majority of projects; the only OCR
  use so far (RC5.4) was targeted, local, and still insufficient alone.
- Slice 5 (images/floor plans): deferred — visual-only interpretation is the
  highest fabrication risk and lowest structured yield.
- Slice 6 (generic AI): deferred — permitted only later inside Option C with
  per-value citations, deterministic validators, and human review (§ 9); never
  as the first slice.

---

## 7. Anti-fabrication policy

**[D]** Binding rules for SIP and every later slice. Each rejected or missing
value is represented explicitly, never silently.

1. No filename-derived facts, and no folder-name-derived facts. Filenames may
   route classification only (existing Fast Intake doctrine).
2. No visual guess without source evidence; SIP-001 performs no visual
   interpretation at all.
3. No general-knowledge country/location inference. “Kamala, Phuket” never
   implies `country: Thailand` — only a document stating the country does
   (Coralina precedent).
4. No silent THB default. Currency is source-verified from price-column
   evidence, or inferred only by the existing
   `project_country_default_currency` rule with its explicit
   `inferred_default` stamp, rule id, version, and country evidence — or null.
5. No date from file-modified time, filename, or archive metadata; only
   printed dates, ISO-normalized with `raw_value` preserved.
6. No unit count inferred from marketing text when a unit table exists; the
   table is the sole inventory source and brochure counts become at most a
   cross-check warning.
7. No bedroom count from a type label unless an explicit, source-backed,
   Owner-confirmed mapping rule is recorded in the preparation report.
8. No price calculated from price-per-sqm, and no price-per-sqm calculation,
   unless separately authorized by the Owner; arithmetic mismatches are
   warnings, never corrections (Coralina 95-row precedent).
9. No conflict resolution by arbitrary source ordering: conflicting values
   from different sources or price-list versions go to human review; nothing
   is emitted for the conflicted field meanwhile.
10. No marketing claim converted into a verified investment fact; descriptions
    stay verbatim with `developer_provided` status.
11. No yield, ROI, occupancy, completion, or ownership claim without direct
    documentary evidence — absent evidence, these fields simply do not appear.
12. No sentinel laundering: `Not available`, `TBD`, `-`, `?`, `0`-as-unknown
    never become values (reuses the Fast Intake sentinel set verbatim).

**Representation [D]:** a **missing** value is an omitted field plus a
warning (`<field>_missing` style, matching existing codes such as
`country_missing`, `price_missing`); a **rejected** value appears only in the
preparation report / review queue with its verbatim source text, location, and
rejection reason — never in the two output artifacts; a **conflicted** value
appears in the review queue with all candidates and their references; an
**unresolved review item** blocks only its own field (or, for duplicate unit
identities, the price-list artifact as a whole).

---

## 8. Human review model

**[D]** The Owner reviews only what the machine cannot prove:

ambiguous facts; conflicting facts (including conflicting price-list
versions); low-confidence facts; inferred currency proposals; duplicate unit
identities; unclear table headers (unmapped columns); unclear price-list
dates; unresolved developer/location identity. High-confidence verbatim cells
with exact references are **not** individually reviewed — they are covered by
a per-table spot-check (the reviewer confirms one sampled row per table
against the source page, recorded in the report).

**Form [D]:** a CLI review summary in SIP-001 (no UI): the preparation report
prints a numbered review queue; each item shows the proposed value, verbatim
source excerpt, and exact reference; the Owner answers per item. A screen/UI
is deferred to SIP-003 and only if review becomes the measured bottleneck.

Actions and provenance consequences:

| Action            | Effect                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accept`          | Value emitted with its machine-assigned provenance (`extracted` for parsed cells; `developer_provided`/`official_source` for document facts) and confidence. Acceptance is not verification and never upgrades status.                                                                                                                     |
| `edit`            | Owner-corrected value emitted; the correction is recorded in the report with the original proposal. Status: `owner_verified` **only if** the Owner confirms the value against the source; otherwise `developer_provided` with the Owner as transcriber. Whether corrections auto-become `owner_verified` is an open Owner decision (§ 13). |
| `reject`          | Nothing emitted for that field/cell; the rejected proposal, its source reference, and the reason stay in the preparation report so the decision is traceable without entering Fast Intake.                                                                                                                                                 |
| `mark unresolved` | Field omitted with an explicit unresolved warning; item remains in the review queue for a later pass.                                                                                                                                                                                                                                      |

**[D]** `owner_verified` is applied exactly per the existing Progressive
precedence rule: only an explicit owner action assigns it, and it then yields
only to another owner action. Rejected and superseded values never enter
`project-facts.json` or the price-list JSON — the preparation report is their
only home, which keeps repeat runs deterministic (§ 12) and honest.

---

## 9. Architecture options

| Criterion           | A — deterministic local parsers           | B — AI-assisted + deterministic validation              | C — hybrid staged                                             |
| ------------------- | ----------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Accuracy            | high on text tables; zero on scans/images | broad but variable; citation quality must be forced     | deterministic core accuracy + AI reach where needed           |
| Speed               | seconds                                   | seconds–minutes per document                            | seconds for the core path                                     |
| Cost                | none per run                              | per-token/service cost                                  | cost only on the AI fraction                                  |
| Dependencies        | one small local text-extraction tool      | model/SDK or cloud service                              | A's plus optional AI component                                |
| Privacy             | fully local                               | dossiers may leave the machine (cloud) — Owner decision | local core; AI step governed by the same Owner decision       |
| Offline             | yes                                       | not for cloud models                                    | core yes                                                      |
| Reproducibility     | byte-deterministic                        | not deterministic across model versions                 | deterministic core; AI proposals recorded, replay from record |
| Debugging           | direct (text in → cells out)              | opaque; needs citation audits                           | mixed, but failures localize to the AI stage                  |
| Maintenance         | low                                       | model/prompt drift                                      | medium                                                        |
| Factory suitability | ideal for A0 (propose-only, verifiable)   | needs strong gates                                      | good: AI confined to propose-only with validators + review    |

**Recommendation [D]:** **Option A for SIP-001.** The observed evidence is
uniformly text-extractable, and Option A is deterministic, offline, private,
dependency-light, and exactly verifiable — the properties Forever's doctrine
already demands. **Long-term direction: Option C**, in which AI may later
propose semantic header mappings or brochure-fact candidates with mandatory
per-value citations, deterministic shape validators, and human review, and may
never write an accepted artifact directly. No paid service is recommended now:
necessity is unproven (Option A covers 3-of-3 observed projects), existing
local tools suffice, ROI is speculative until SIP-001 is measured, and a
service dependency adds privacy and reproducibility costs with no demonstrated
return. Option B alone is rejected as first slice for reproducibility and
privacy reasons and because it would invert the doctrine (interpretation
first, verification second).

---

## 10. Measurable acceptance criteria (for the future implementation)

The SIP-001 implementation is accepted only when all of the following are
demonstrated on a real ordinary dossier:

1. A real dossier produces a valid `project-facts.json` (checklist path) that
   Fast Intake v1 consumes unchanged.
2. A real text-PDF price list produces valid `ExtractedPriceList` JSON that
   Fast Intake v1 consumes unchanged — no adapter, no schema fork.
3. Every accepted fact and cell carries an exact source reference
   (file + page + table/row for cells; file + page for facts).
4. Unsupported facts are absent from the artifacts and present as explicit
   warnings; sentinel values never appear as facts.
5. Duplicate unit identities are blocked before emission (fail closed or
   human-resolved; never silently merged).
6. No personal data appears in any generated artifact (verified by the
   changed-artifact scan).
7. Repeat execution over unchanged sources and unchanged review decisions is
   deterministic: byte-identical output artifacts (operational timestamps
   excluded, matching Fast Intake's stated determinism boundary).
8. Every human decision (accept/edit/reject/unresolved) is recorded in the
   preparation report with the original proposal.
9. Raw source files are byte-unchanged after every run.
10. No database client, connection, import, lead, publication, or production
    write occurs; no network request is made by the deterministic path.
11. Fast Intake validation of the resulting draft passes (`-ValidateOnly`
    boundary), and the draft remains unpublished.

**Timing targets [D]**, measured separately and never combined:

- raw dossier → reviewed structured JSON (SIP window, including human
  review): target ≤ 60 minutes for a Coralina-scale dossier (≈ 200-row text
  price list), against the 4–8 h manual baseline; the extraction itself
  (machine time) target ≤ 60 seconds.
- structured JSON → validated Fast Intake draft: the existing 900-second Fast
  Intake target governs; Rainpalm's measured 39.834 s / 0.133 s stands as the
  benchmark and must not be conflated with SIP timing.

---

## 11. Implementation roadmap

### SIP-001 — text-PDF price-list extraction (first smallest slice)

- **Scope:** deterministic text extraction of price-list tables from
  text-based PDF price lists into `ExtractedPriceList` JSON; header-mapping
  table for observed column names; row/cell source references; sentinel and
  duplicate handling; CLI review queue + preparation report; project-facts
  Owner checklist (documentation, no code).
- **Excluded:** OCR, computer vision, XLSX/CSV, brochure parsing, AI, UI,
  any Fast Intake change, any import/publication, canonical record resolution.
- **Files/modules likely involved:** a new bounded module (e.g.
  `src/sip/` or `src/intake/prepare/` — final location decided at
  implementation) plus test fixtures; `src/intake/` and `src/import/`
  contracts imported read-only, unchanged.
- **Test strategy:** golden-fixture PDFs (synthetic, committed, small) →
  byte-exact expected JSON; property tests for separators/sentinels/duplicates;
  a full pipeline test proving Fast Intake consumes the output unchanged;
  determinism test (two runs, identical bytes).
- **Pilot project:** the next real dossier; Rainpalm's real price-list PDF is
  the natural first re-run candidate (compare SIP output against the manually
  prepared, already-validated JSON — a ready-made ground truth), without
  importing or publishing anything.
- **Success metric:** acceptance criteria § 10; headline: reviewed structured
  price-list JSON from a real text-PDF in ≤ 60 minutes including review, with
  zero fabricated values found in review.
- **Risk:** low-medium (PDF text-layout variance is the main unknown; fail
  closed to review on unrecognized layouts).
- **Recommended executor:** Claude Code, high effort, standard model tier;
  one focused PR. Codex is equally viable if the Owner prefers; the decisive
  requirement is the committed fixture corpus, not the executor.

### SIP-002 — second source format (XLSX/CSV price lists)

- Only after SIP-001 is measured on a real project, and only when a real
  dossier actually contains a spreadsheet price list. Scope: same contract,
  `sheet_name`-bearing references, native cell types. Excluded: everything
  else. Test strategy mirrors SIP-001 with spreadsheet fixtures. Risk: low.

### SIP-003 — review workflow improvements

- Only if review is the measured bottleneck after SIP-001/002 real runs
  (measured: review minutes dominate the SIP window). Scope: better review
  ergonomics (batch accept per table, richer diffs, possibly a minimal local
  screen). Excluded: any change to provenance semantics. Risk: low.

### SIP-004 — advanced OCR / computer vision

- Only if real project evidence shows scanned-PDF-only or image-only price
  lists in a majority-relevant share of incoming dossiers. Scope: local OCR
  proposals routed entirely through the § 8 review queue with page-image
  references. Excluded: cloud OCR unless the Owner decides otherwise (§ 13).
  Risk: high; requires its own design checkpoint before implementation.

No stage expands Factory autonomy; every stage is propose-only under A0.

---

## 12. Risks

| Risk                                                                        | Mitigation                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PDF text-layout variance breaks table detection on a new developer's format | fail closed to review with page text samples; extend the header-mapping fixture corpus per project                      |
| A text-PDF price list arrives with no text layer (scan)                     | detected by empty text extraction → explicit `price_list_not_text_extractable` warning; manual path or SIP-004 evidence |
| Provenance vocabulary drift (a fifth vocabulary appears)                    | hard rule: SIP emits only the two existing consumed contracts; review artifacts carry no new status enums               |
| Review fatigue → rubber-stamping                                            | queue contains only unproven items; spot-check protocol is one row per table, recorded                                  |
| Silent scope creep toward a second ingestion pipeline                       | SIP ends at two JSON files; any payload/fingerprint/currency logic in SIP is a review-blocking defect                   |
| Personal data leaking from raw dossiers into artifacts                      | drop-and-warn rule for person/contact columns; changed-artifact personal-data scan in every SIP PR                      |
| Dependency risk from a PDF text library                                     | smallest local tool, pinned; evaluated in the SIP-001 task against the repo's dependency rules                          |

---

## 13. Open Owner decisions

1. **First-slice priority — confirm text-PDF over XLSX.** Evidence (PDF price
   lists in 3 of 3 real projects, no XLSX observed) supports text-PDF price
   lists first; XLSX becomes SIP-002 when one actually appears. Confirm or
   override.
2. **Cloud AI processing of source documents.** May dossier contents ever be
   sent to a cloud AI service, or must all processing remain local? This
   gates Option C's AI step and any future OCR service. (SIP-001 is fully
   local either way.)
3. **Medium-confidence facts.** Must AI- or machine-proposed facts at
   `medium` confidence always require Owner confirmation before emission, or
   only when flagged by the § 8 queue rules? (This design assumes: always in
   the queue when interpretive; verbatim `medium` cells pass with spot-check.)
4. **`owner_verified` on manual corrections.** Should an Owner `edit` during
   review automatically set `owner_verified`, or only when the Owner
   explicitly confirms the value against the source? (This design recommends
   the explicit confirmation variant.)
5. **Git tracking of SIP artifacts.** Should preparation reports and review
   queues be committed under `forever-data/projects/<slug>/` alongside the
   existing intake artifacts (recommended for auditability, matching the
   Coralina/Rainpalm precedent of committing structured artifacts but never
   raw binaries), or remain local-only?

---

## 14. Assumptions and unresolved questions

- **[A]** Committed repository evidence faithfully records the Owner-machine
  material structures; raw binaries and `C:\forever-incoming\Rainpalm` were
  not directly inspectable in this session (§ 3.3).
- **[A]** The next real project's price list will resemble the observed
  pattern (text-based PDF, one table family, `1,234,567.89` numerals). A
  counter-example redirects SIP-002's priority — it does not break SIP-001,
  which fails closed.
- **[U]** Exact PDF text-extraction dependency choice (Poppler `pdftotext`
  vs. pure-JS) — decided inside the SIP-001 task under dependency rules.
- **[U]** Final module location (`src/sip/` vs. `src/intake/prepare/`) —
  decided at implementation; constraint: Fast Intake code remains unchanged.
- **[U]** The five Owner decisions in § 13.

---

## 15. Exact next implementation task

After this design is independently reviewed and approved, and Owner decisions
§ 13.1–13.2 are answered:

> **SIP-001:** implement deterministic text-based-PDF price-list extraction to
> `ExtractedPriceList` JSON with exact per-cell source references, sentinel and
> duplicate fail-closed handling, a CLI review queue, and a preparation
> report; ship the project-facts Owner checklist; prove § 10 acceptance
> criteria on the Rainpalm price-list PDF against the existing manually
> prepared JSON as ground truth; import nothing; publish nothing; change no
> Fast Intake, importer, schema, or contract code.

Until then: no implementation. Coralina remains unpublished. Rainpalm remains
unimported and unpublished. Factory remains A0 — Propose only.
