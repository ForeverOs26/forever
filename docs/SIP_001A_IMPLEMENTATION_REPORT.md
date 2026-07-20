# SIP-001A Implementation Report — Local Text-PDF Price-List Extraction

Status: Implementation complete for the narrow SIP-001A slice; **the real
Rainpalm pilot is BLOCKED by two external prerequisites that are absent from
this execution environment**, not by the design or the implementation. This
report is submitted for independent Codex review. It does not canonicalize
SIP-001A in `docs/CURRENT_STAGE.md`, `docs/FOREVER_STATUS.md`, or
`docs/ROADMAP.md`.

## 1. Exact base and scope

- Authoritative base: `9e8a615a242167052b833d1fac798af5a039c91d` (merge of PR
  #88, "docs(intake): design structured input preparation v1").
- Branch: `claude/sip-001a-rainpalm-pdf-extraction-4xbcrs`, created from that
  exact commit with a clean tracked working tree.
- Scope: the smallest canonical SIP-001A slice per
  `docs/STRUCTURED_INPUT_PREPARATION_DESIGN_V1.md` — locate the authorized
  Rainpalm raw PDF, qualify its text layer, extract one supported table
  layout locally with Poppler `pdftotext -layout` and deterministic
  TypeScript, normalize candidates into the unchanged `ExtractedPriceList`
  contract, run an exception-only review, produce reviewed final JSON only
  from deterministic accepted values, prove unchanged Fast Intake
  consumption, and compare against the reviewed Rainpalm ground truth as a
  post-extraction oracle.

## 2. Why the real Rainpalm pilot is blocked in this environment

This task runs in a Claude Code on the web (remote, ephemeral, Linux
container) session, not on the Owner's local Windows machine. Two
preflight facts were verified directly, honestly, and are reported exactly
as found — this is the environment's structural limitation, not something
this PR can work around:

1. **The authorized raw source folder does not exist here.**
   `C:\forever-incoming\Rainpalm\raw\price-list` is a Windows path on the
   Owner's machine. This container has no `C:\` drive and no
   `forever-incoming` directory anywhere on its filesystem (confirmed with
   an exhaustive `find`). The real Rainpalm raw PDF and the ground-truth
   `C:\forever-incoming\Rainpalm\price-list\price-list.json` are therefore
   both unreachable from this session.
2. **No local Poppler `pdftotext` executable is available.** `where.exe` is
   not applicable (Linux); `pdftotext`/`pdfinfo` are absent from `PATH`;
   only the `libpoppler134` runtime *library* is installed (no
   `poppler-utils` package, confirmed via `dpkg -l` and `find`). SIP-001A
   installs nothing — per `docs/STRUCTURED_INPUT_PREPARATION_DESIGN_V1.md`
   §5, this is recorded as the exact missing external prerequisite, not
   worked around.

This is the exact contingency `docs/CURRENT_STAGE.md` and
`docs/STRUCTURED_INPUT_PREPARATION_DESIGN_V1.md` already anticipate:
*"Absence of that PDF blocks the real Rainpalm pilot but does not invalidate
the design or prevent qualification/parser infrastructure work with safe
fixtures."* Accordingly, this PR implements and proves the full pipeline
against a small, committed, sanitized **fixture** representing authorized
`pdftotext -layout` output — invented for testing, not derived from or
shaped to match the real Rainpalm ground truth — and reports the real pilot
as blocked rather than claiming a result that did not happen.

Repository-recorded evidence used to design the fixture (already public in
this repo before this PR, not fetched from the protected ground-truth file):
`docs/FAST_INTAKE_PILOT_01_RAINPALM.md` records 21 units, 14 positive
prices, 7 source-null prices, villa identifiers such as `A4`/`A8`/`A9`, THB
currency, developer `Tonsai Company`, and location `Bang Tao, Phuket`. The
fixture used in this PR intentionally does **not** reproduce these exact
counts or identifiers — it is a structurally similar but independently
authored table used only to exercise the parser, never to make the
extraction output match the known answer.

## 3. Supported layout implemented

One fixed-width table layout, as produced by `pdftotext -layout`:

- a header line naming columns from a fixed dictionary (`Unit`/`Villa`,
  `Type`, `Bed(s)`, `Bath(s)`, `Size`/`Area`, `Price (CCC)`,
  `Status`/`Availability`) — matched case-insensitively against literal
  label variants, never guessed;
- data lines whose cells are sliced at the header's own column start
  offsets (columns separated by 2+ spaces or a tab);
- a header line may repeat verbatim on a later page (recognized as a
  continuation, not re-parsed as data or a second table);
- a data line with a blank unit-identity cell but content elsewhere is
  treated as a wrapped continuation of the previous row;
- currency is accepted only from a `(CCC)` parenthetical on the column
  literally mapped to `price` — a `Transfer Fee (THB)` column is never
  price-currency evidence;
- the date is read only from document content matching
  `date|updated|effective|as of ... DD.MM.YY(YY)`, never a filename or file
  timestamp.

Unknown headers, a header missing the unit-identity or price column, and a
duplicate-mapped header (e.g. two `Price` columns) never enter a usable
table — they are reported and excluded, and other qualified tables/pages
still proceed (partial success). This is one supported layout, not a
general PDF table engine — an unrecognized layout returns
`UNSUPPORTED_LAYOUT`, never an OCR fallback.

## 4. Modules implemented

All under `src/intake/sip/` (new directory; nothing in `src/intake/*.ts`
outside it was modified):

| Module | Responsibility |
| --- | --- |
| `types.ts` | SIP-001A types only; reuses `Fact`/`ExtractedPriceList` from `@/import/types` unchanged. |
| `pdf-tool.ts` | Local `pdftotext` preflight (PATH + documented Windows install paths, installs nothing) and bounded, argument-array `pdftotext -layout` invocation. |
| `pdf-qualify.ts` | Text-layer qualification → `QUALIFIED_SUPPORTED_LAYOUT` / `UNSUPPORTED_NO_TEXT_LAYER` / `UNSUPPORTED_LAYOUT` / `REVIEW_REQUIRED` / `TOOL_FAILURE`. |
| `price-table.ts` | Fixed-dictionary header mapping, column splitting, row/continuation extraction — the one supported layout. |
| `candidate-normalize.ts` | Builds candidate `ExtractedPriceListRow[]` with exact `Fact.status` vocabulary; anti-fabrication price/availability/currency/date rules; duplicate-identity detection; reviewed-JSON construction. |
| `review.ts` | Exception-only `ReviewSummary` + `canFinalize`. |
| `artifacts.ts` | Atomic JSON artifact writer (reuses `../fs-utils`). |
| `run.ts` | Orchestrator; never imports or reads the ground-truth file. |
| `cli-args.ts` / `cli.ts` / `run-cli.mjs` | `sip:price-list` CLI, mirrors `src/intake/cli*.ts` conventions. |
| `compare.ts` / `compare-cli.ts` / `compare-run-cli.mjs` | The **only** SIP-001A code authorized to read the ground-truth comparison file — a separate command run strictly after the reviewed JSON is already fixed. |

Reused unchanged: `src/intake/paths.ts` (`assertSafeSlug`, `removeManagedDir`),
`src/intake/fs-utils.ts` (`atomicWriteJson`), `src/intake/sanitize.ts`
(`sanitizePriceList`, called on the reviewed output as a compatibility
proof), `src/import/types.ts` (`Fact`, `ExtractedPriceList` — unchanged),
`src/import/currency-policy.ts` (`decideCurrency`,
`currencyEvidenceFromFact` — unchanged). No second ZIP reader, path guard,
`ExtractedPriceList` type, Fast Intake CLI, or Progressive builder was
created.

## 5. CLI

```
npm.cmd run sip:price-list -- --project rainpalm-villas --pdf "<resolved PDF path>" --out-root "forever-data/projects/rainpalm-villas/sip"
npm run sip:price-list -- --project rainpalm-villas --pdf "<pdf-path>"                      # bash/Linux/macOS
```

Separate, read-only, post-extraction-only comparison command:

```
npm run sip:compare-price-list -- --reviewed "<reviewed-price-list.json>" --ground-truth "<price-list.json>" --review-summary "<review-summary.json>"
```

Neither command searches the filesystem; the PDF/comparison paths are
always explicit arguments. Verified real invocation in this environment
(exit code 2, `TOOL_FAILURE`, no `reviewed-price-list.json` written — the
honest result given the missing local prerequisite):

```
$ node src/intake/sip/run-cli.mjs --project rainpalm-villas-smoketest --pdf "/tmp/fake-rainpalm.pdf" --out-root "/tmp/sip-smoketest-out"
SIP-001A price-list extraction — TOOL_FAILURE
...
Blocking issues:
  - BLOCKED — AUTHORIZED PDF TEXT TOOL REQUIRED: pdftotext was not found on this machine.
Finalized reviewed JSON: no
```

## 6. Generated artifacts

`forever-data/projects/<slug>/sip/`: `source-proof.json`,
`qualification.json`, `candidate-price-list.json`, `review-summary.json`,
`preparation-summary.json`, and `reviewed-price-list.json` (only when
finalization succeeds — no blocking duplicate identity, all candidates
resolved or safely excluded). None of these were committed for a real
Rainpalm run because none was produced; the module is proven against the
fixture in tests only. `source-proof.json` and `preparation-summary.json`
never contain an absolute Owner-machine path except the explicit,
non-canonical `local_only_path` field, mirroring the existing Fast Intake
`source-manifest.json` pattern. Temporary `pdftotext` output and the SIP
workspace live under gitignored `.sip-workspace/` and are removed after
both success and failure — never written beside the raw PDF, never
committed.

## 7. Fixture-proven results (not a real Rainpalm run)

Using the committed fixture `rainpalm-price-list.pdftotext-layout.txt` (11
rows across 2 pages, independently authored, not derived from the ground
truth):

- Qualification: `QUALIFIED_SUPPORTED_LAYOUT`.
- Candidate rows: 11 (all retained — a source-null "Sold" row stays a row
  with a null price, per the anti-fabrication rule).
- Review items: 3 non-blocking — a zero price (`A5`) and a non-numeric price
  (`A6`), both nulled with reason `price_unsupported_value`, and one
  unmapped availability label (`A7`'s continuation-merged
  "Reserved - pending contract" does not match the fixed availability
  dictionary, so it is retained verbatim with `medium_confidence_cell`,
  nulled out of the reviewed final JSON pending review, not guessed) — see
  the fixture-driven test assertions in
  `src/intake/sip/tests/candidate-normalize.test.ts`.
- Accepted (reviewed) rows: 11; finalized: `true`.
- Deterministic repeat: **byte-identical** `candidate-price-list.json`,
  `review-summary.json`, `reviewed-price-list.json`, and `qualification.json`
  across two independent runs with different temp directories (only the
  explicit `local_only_path` operational field differs) —
  `src/intake/sip/tests/run.test.ts`.
- Fast Intake compatibility: the reviewed output was fed into the
  **unchanged** `runIntake()` (`src/intake/run.ts`) exactly as any other
  pre-prepared structured price-list artifact and validated successfully
  (`validation.ok === true`, `units`/`prices` > 0) —
  `src/intake/sip/tests/fast-intake-compat.test.ts`.

## 8. Ground-truth comparison — not run against the real file

`compare.ts`/`compare-cli.ts` are implemented and unit-tested against a
synthetic ground truth (recall, exact-identity, per-field agreement,
positive-price agreement, null-price preservation, currency agreement,
source-reference completeness, fabricated-row/price counts, lost-null-price
count, missing/unexpected-row counts — every metric an explicit
numerator/denominator pair, per
`docs/STRUCTURED_INPUT_PREPARATION_DESIGN_V1.md` §7). The real comparison
against `C:\forever-incoming\Rainpalm\price-list\price-list.json` (21
units / 14 positive / 7 null, per the task brief and
`docs/FAST_INTAKE_PILOT_01_RAINPALM.md`) **was not run** — that file is not
reachable from this environment, and no real extraction exists to compare
it against. Running `sip:compare-price-list` against the real ground truth,
after a real `sip:price-list` run on the Owner's machine, is the exact
next step.

## 9. Determinism

Verified in `src/intake/sip/tests/run.test.ts`: two independent runs of
`runSipPriceListExtraction` against the same fixture PDF-like input, from
different temp directories with different PIDs/timestamps, produce
byte-identical `qualification.json`, `candidate-price-list.json`,
`review-summary.json`, and `reviewed-price-list.json`. `source-proof.json`'s
`sha256`/`byte_size` are identical; only the explicit `local_only_path`
field (excluded from canonical hashing, matching the existing Fast Intake
`source-manifest.json` pattern) differs. No lock, staging, or temporary
residue remains in the workspace after a run (`.sip-workspace/` is emptied
in both the success and failure paths).

## 10. Tests and validation

- New focused SIP-001A tests: **68 passed** across 8 files (`pdf-tool`,
  `pdf-qualify`, `price-table`, `candidate-normalize`, `review`, `compare`,
  `run` (includes determinism, no-ground-truth-access, and
  no-database/network boundary checks), `fast-intake-compat`). Coverage
  includes: real argument-array process spawning with a fake local
  `pdftotext` (proving shell-injection safety and Unicode/spaced-path
  handling against an actual child process, not a mock), missing-Poppler
  preflight, a real timeout (`ETIMEDOUT`), a non-zero exit, page-boundary
  preservation via the form-feed separator, unsupported/ambiguous headers,
  repeated headers, row continuation, thousands-separator parsing,
  ambiguous-separator rejection, sentinel/zero/negative/malformed prices,
  sold rows with null prices, availability normalization, missing and
  inapplicable (fee-column) currency evidence, date-from-content only,
  duplicate-identity blocking, source page/row references, deterministic
  repeat, structural proof that extraction never imports/reads the ground
  truth, unchanged Fast Intake consumption, and a grep-based proof that no
  SIP module imports a Supabase client, a raw `node:http(s)` module, or the
  PowerShell/Progressive importer.
- Full repository focused Fast Intake suite (`src/intake/tests/`):
  unaffected, still **202 passed, 1 skipped** (the skip is the pre-existing,
  documented PowerShell-unavailable-in-this-environment case).
- Full repository suite (`npx vitest run`): **2903 passed, 1 skipped, 3
  failed** — the 3 failures are in `src/import/importer-preflight.test.ts`
  and are **reproduced identically on the unmodified base commit**
  (verified via `git stash`), caused by Coralina/Modeva fixture data that
  is gitignored and absent from this fresh container checkout. This is a
  pre-existing, unrelated, host-environment gap, not a regression from this
  PR.
- TypeScript (`npx tsc --noEmit`): clean except one pre-existing,
  unrelated error — `src/features/project-detail/partner-demo-data.ts`
  cannot resolve `forever-data/projects/modeva/extracted/price-list.json`
  (same gitignored-data gap, also reproduced on the unmodified base).
- ESLint (`npx eslint src/intake/sip .gitignore package.json`): clean (0
  errors; 2 informational "no matching configuration" warnings for the two
  non-TS files, expected).
- Prettier (`npx prettier --check src/intake/sip package.json`): clean.
- `git diff --check`: clean.
- Changed-diff secret scan (API keys, tokens, private-key headers, Supabase
  keys, AWS keys): zero hits (grep false-positive on the word "token" as a
  variable name only).
- Changed-diff personal-data scan (emails, phone-shaped strings): zero
  hits.
- Production build (`npm run build`): succeeded. Bundle scan
  (`grep -rl "pdftotext|SIP-001A|sip-price-list|runSipPriceListExtraction|intake/sip" .output/`):
  **zero matches** — SIP-001A code, Poppler references, and raw-PDF
  handling are entirely absent from both the server and client production
  output, matching the existing `src/intake/*` boundary (this code is never
  imported by any app/route/component).
- Windows CLI smoke test using the real Rainpalm PDF: **not run** — the
  file does not exist in this environment (§2). A Linux-equivalent smoke
  test was run instead (§5), proving the CLI's argument handling, fail-closed
  behavior, and artifact writing.
- Real Rainpalm deterministic second run / real ValidateOnly against the
  real reviewed JSON: **not run**, for the same reason.

## 11. Limitations and unsupported layouts

- One layout only: a fixed-width `pdftotext -layout` table with a
  literal-dictionary header naming a unit-identity column and a price
  column. No XLSX/CSV, no OCR, no scanned PDFs, no image/floor-plan/master-plan
  interpretation, no AI extraction.
- Continuation-line handling is narrow: only a blank-identity line with
  content elsewhere, merged into the immediately preceding row.
- Date extraction recognizes one pattern family
  (`date|updated|effective|as of ... DD.MM.YY(YY)`); anything else is
  omitted, never guessed.
- Numeric parsing accepts comma-thousands and a two-decimal-place period
  suffix only; anything else (e.g. European `12.500.000`) is flagged
  `unsupported_numeric_separator`, never guessed.

## 12. Privacy boundary

No raw PDF, temporary extracted text, credentials, or personal data is
committed. Generated artifacts carry only a portable filename
(`source_filename`), content hashes, and the fixed `local_only_path`
operational field (excluded from canonical determinism, matching the
existing Fast Intake pattern). The fixture text committed for tests is
independently authored, not the real Rainpalm content.

## 13. No-production proof

No database client was created (grep-verified: no `supabase` import in any
`src/intake/sip/*.ts`). No network request module (`node:http`/`node:https`)
is imported. No Progressive/PowerShell importer
(`Import-ForeverProjectDraft`) is invoked. `sip:price-list` never
auto-invokes Fast Intake or the database importer. Production build output
contains zero references to this code (§10).

## 14. Follow-up recommendation

On the Owner's Windows machine, with the authorized raw PDF present under
`C:\forever-incoming\Rainpalm\raw\price-list` and a local Poppler
`pdftotext` on `PATH` (or at a documented install path):

1. Run `npm.cmd run sip:price-list -- --project rainpalm-villas --pdf "<resolved PDF path>"` and record the qualification result.
2. If `QUALIFIED_SUPPORTED_LAYOUT` (i.e. the real layout matches this
   fixture-modeled layout), review `review-summary.json`, then run
   `npm run sip:compare-price-list -- --reviewed "<reviewed-price-list.json>" --ground-truth "C:\forever-incoming\Rainpalm\price-list\price-list.json"` and record every metric.
3. If the real layout does not qualify, extend `price-table.ts`'s header
   dictionary or continuation handling narrowly against the real fixture
   captured from that run (never against the ground truth), in a follow-up
   PR — do not widen scope beyond one additional observed layout at a time.
4. Only after a real, reviewed, independently audited comparison should
   SIP-001A be considered for canonicalization in `docs/CURRENT_STAGE.md`.

## Confirmations

- Raw PDF was not committed or modified (none was accessible in this
  environment; no PDF bytes were written anywhere except the ephemeral,
  gitignored `.sip-workspace/`, cleaned after every run).
- Ground truth was not used during extraction: `compare.ts`/`compare-cli.ts`
  are the only modules that read it, structurally isolated from `run.ts`
  (proven by a dedicated test), and were not invoked against the real file
  in this session.
- Partner Demo remains canonical; unchanged by this PR.
- Rainpalm remains unimported and unpublished.
- Coralina remains unpublished.
- Factory remains A0 — Propose only.
- No production connection, database client, import, lead, publication, or
  production write occurred at any point in this session.

## Verdict

**BLOCKED — AUTHORIZED PDF TEXT TOOL REQUIRED**

The implementation, tests, and safe-fixture proof are complete and ready
for independent review. The real Rainpalm pilot did not run because this
remote execution environment has neither the authorized raw source folder
nor a local Poppler `pdftotext` executable — both are external
prerequisites on the Owner's machine, outside this PR's control. No claim
of a completed real Rainpalm extraction is made anywhere in this report or
in the generated artifacts (none were generated for a real run).
