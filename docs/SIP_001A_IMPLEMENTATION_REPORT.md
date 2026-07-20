# SIP-001A Implementation and Independent Windows Audit

Status: SIP-001A is implemented, independently audited, real-Windows validated, Owner approved, and canonical. This report remains the implementation and evidence record; `CURRENT_STAGE`, `FOREVER_STATUS`, and `ROADMAP` set SIP-001B as the next active checkpoint.

## Repository and review scope

- Authoritative base: `9e8a615a242167052b833d1fac798af5a039c91d`.
- Initially reviewed PR head: `fe7bf2ee7aaa865e7aede5b41646a5628f2de316`.
- Existing branch: `claude/sip-001a-rainpalm-pdf-extraction-4xbcrs`.
- PR #89 was independently audited without rebasing, history rewriting, merging, auto-merge, production access, or database work.
- `docs/CURRENT_STAGE.md`, `docs/FOREVER_STATUS.md`, and `docs/ROADMAP.md` remain unchanged.

## Independent corrections

The audit corrected PR-owned defects before accepting a real result:

- replaced sequential multi-file writes with a same-filesystem, lock-protected generation transaction with staging, backup, journal, rollback, and crash recovery;
- bound every generation to one source hash, tool identity, qualification, candidate, review summary, and finalized output;
- removed absolute local paths from canonical artifacts and applied the existing path boundary guard to protect the raw PDF directory;
- detected Git-for-Windows Xpdf honestly instead of calling it Poppler, retained the required `-layout` evidence, and added Xpdf `-table` parsing because its layout mode shifts right-hand price/status cells;
- fixed Windows child-process tests to prove executable-plus-argument-array invocation, Unicode/spaced paths, timeout, exit-code, output-limit, and cleanup behavior;
- added the observed multi-row header, separate land/living-area columns, pool-villa type, and stable left-core merge while retaining fail-closed unknown-layout behavior;
- tightened unit identity, continuation, calendar-date, duplicate, and footer handling;
- replaced a Rainpalm-shaped fixture with independently authored generic fixtures;
- corrected comparison metrics for formatted numeric prices, equivalent unit-type labels, null-price loss, and source-reference completeness;
- removed unsupported `accept-as-owner-verified` SIP actions and corrected CLI wording from human-reviewed to deterministic finalization;
- applied the Owner currency rule through the existing policy: explicit source currency wins; absent currency becomes THB with `inferred_default`, including downstream Fast Intake provenance.

## Authorized source and local tools

- File: `Rainpalm - Price List（for In house) update 04.2025.pdf`.
- Size: 77,091 bytes.
- SHA-256 before, between, and after real runs: `4ddee05fe5063bd8548ca8d2833c20bb4ca9b6b81a23aee8f21b065e1b5260b6`.
- The file is outside the repository and was never modified or committed.
- PDF text tool: Git for Windows bundled Xpdf `pdftotext` (vendor: Xpdf, version: 4.06), executable SHA-256 `9699be3ec5726d33010295d96fd9eff43c5a6f4201aefe5c1678e70ec9fe3948`.
- PDF inspection tool: bundled Poppler `pdfinfo` 26.05.0, SHA-256 `bc2c0f980c9a2a29cd1e06aacd8d1c7b67a5304e9d1d6f75190bdeb9c81a4365`.
- The one-page letter-landscape PDF is tagged, unencrypted, has no JavaScript, and contains no obvious personal data.
- Authorized local custody location: `<OWNER_LOCAL_INCOMING>/Rainpalm/raw/price-list/...`; the source remains outside the repository.

Exact command, run twice with fresh managed workspaces:

```powershell
npm.cmd run sip:price-list -- --project rainpalm-villas --pdf "<AUTHORIZED_RAINPALM_PRICE_LIST_PDF>"
```

## Real qualification and extraction

- Qualification: `QUALIFIED_SUPPORTED_LAYOUT`.
- Parser input: required Xpdf `-layout` plus Xpdf `-table`; parser mode `table` with only stable identity/type/area/bed/bath cells merged from layout.
- Text hashes: layout `ee836c1c2a0aabbcf94e5c64c93970651913fd51186952094bc5c02da2d51e8c`; table `800968494c9e597f140274303b7b872e8dcfd2cb4ddbe69d0d148552d62568d5`.
- Layout: one table and 21 rows; columns include villa number, pool-villa type, land area, living area, bedrooms, bathrooms, price, furniture, maintenance, sinking fund, and status.
- Candidate / accepted / safely omitted / review / rejected / blocking counts: `21 / 21 / 0 / 0 / 0 / 0`.
- Positive/null source prices: `9 / 12`. These are the actual April PDF values; the older oracle has `14 / 7` and was not used to alter extraction.
- Currency: the selling-price header states no currency. Per the later explicit Owner rule, all 21 rows carry THB as `inferred_default`. Any explicitly stated non-THB selling-price currency would be preserved as `source_verified`.
- Date: omitted because the PDF content contains no applicable date. The filename was not used as evidence.
- Generation ID: `e53dc8006ab0bccc67ea5267058ba88087dd3e973935b65182f2e159c93d06e8`.
- Two post-correction real runs produced identical canonical hashes and left no lock, staging, transaction, backup, or text-output residue.

Canonical file hashes:

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `source-proof.json`         | `f2d3e5f6b397eaa866ed8f61b5d8f08d5c09e10b6bd6aac226ad56e0d049adfd` |
| `qualification.json`        | `06f12bb599ede40f2af65ccb950a9c77cda0db5abcf142a46c7a600692e4a645` |
| `candidate-price-list.json` | `3cc4cfd9cb06b1b9f3929fb7f5cb8ab8d39af482358f77c393327d39e4213d55` |
| `review-summary.json`       | `6be80b78fcf01b5f6958d5379595bf2d6154f62f5b27024b0eaafbb1b74a2ec8` |
| `preparation-summary.json`  | `caa39976f52efb0b61dfaa97f3950370ad9efc6b0fc37a83f1a6da34fbbb01ed` |
| `reviewed-price-list.json`  | `3cc4cfd9cb06b1b9f3929fb7f5cb8ab8d39af482358f77c393327d39e4213d55` |
| `comparison-report.json`    | `2b4fc0d06360771de18da601da9a8b0d07c096e54e05901c2d28f6de7e41264b` |

## Oracle isolation and comparison

The extraction orchestrator has no oracle path or oracle import. All extraction artifacts and their hashes were finalized twice before the separate comparison command read the oracle. Only then were the authorized input hashes checked:

- `price-list.json`: `6ce4a187711f1fdcc26eed84689a0ef0f7a461262a4630b895c251781d10a73f` (exact match).
- `project-facts.json`: `1e47032269fe2cd48ed93f436075915a05e1be7380d2afc58ce793e55d5c795b` (exact match).

Comparison metrics against the older reviewed inventory:

| Metric                        |  Result |
| ----------------------------- | ------: |
| Unit-row recall               |   21/21 |
| Exact unit identity           |   21/21 |
| Unit type                     |   21/21 |
| Bedrooms                      |   21/21 |
| Bathrooms                     |   21/21 |
| Size                          |   21/21 |
| Availability                  |   18/21 |
| Positive price                |    9/14 |
| Null-price preservation       |     7/7 |
| Currency                      |   14/14 |
| Source-reference completeness | 166/166 |

Fabricated rows/prices, lost nulls, missing rows, and unexpected rows are all zero. Review items and manual review time are `0` and `0 seconds`. The five positive-price and three availability differences reflect the actual newer PDF, not a parser defect; no oracle value was copied into extraction.

## Fast Intake and ValidateOnly

The finalized SIP JSON and unchanged authorized `project-facts.json` were passed through the existing public Fast Intake CLI in a temporary non-canonical destination. It produced a valid unpublished create payload with 21 units, 9 positive price-history rows, 17 honest warnings, no null price converted into a price, and THB decisions preserved as `inferred_default`. `project.publish` remained `false`. A second final-code run produced the same payload SHA-256, `06cc20cfdeb9ec0f8b8edd6a13f0d1e146ad8e2074235891f6047f923810d908`. PowerShell `Import-ForeverProjectDraft.ps1 -PayloadPath <temporary payload> -ValidateOnly` returned `DRAFT_PAYLOAD_VALID`; no database client, credential, network request, importer execution, or write was used.

## Validation and privacy

Focused SIP and currency tests pass: 87 tests across 9 files. The complete repository suite passes: 305 files and 2,917 tests, with the live PowerShell parity boundary enabled through process-local `ExecutionPolicy Bypass`. TypeScript, changed-file ESLint, Prettier, the production build, and `git diff --check` pass. The production bundle has zero matches for SIP, `pdftotext`, Poppler, fixture, incoming-folder, or raw-price-list identifiers. Changed-diff scans have zero secret and email hits; phone-shaped matches are SHA/diff-index false positives only. The seven tracked SIP JSON files have zero absolute-path matches and contain no PDF. No dependency or lockfile changed.

Tracked SIP artifacts contain no absolute paths, executable paths, usernames, raw PDF bytes, raw extracted text, renders, credentials, or personal data. No dependencies or lockfile were added or changed.

## Limitations

SIP-001A supports only qualified text PDFs with the fixture-covered fixed-table structures. It does not support OCR/scanned PDFs, XLSX/CSV, images, floor plans, master plans, AI extraction, cloud processing, or general-purpose table inference. Unknown layouts, unsafe identity mapping, duplicates, or contradictory explicit currency fail closed or require review.

## Confirmations

Partner Demo remains canonical. Rainpalm remains unimported and unpublished. Coralina remains unpublished. Factory remains A0 — Propose only. No production connection, database client, import, lead, publication, or production write occurred.

## Verdict

PASS — SIP-001A CANONICAL; SIP-001B ACTIVE
