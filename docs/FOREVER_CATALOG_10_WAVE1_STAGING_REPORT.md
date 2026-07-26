# Forever Catalogue 10 — Wave 1 staging report

Task: `FOREVER-CATALOG-10-002`
Branch: `claude/forever-catalog-10-001`
Worktree: `C:\forever-worktrees\catalog-10`
Base SHA: `a9d275fc678065ef70b331aee20f24f1c4f030e6`
Planning commit continued from: `72454e3`

## Verdict

**FOREVER CATALOGUE WAVE 1 STAGING PASSED**
**— FOUR UNPUBLISHED DRAFTS VERIFIED**
**— RAINPALM STRUCTURE LOADED, PRICES DEFERRED**
**— REPLAY SAFETY VERIFIED**
**— PUBLIC CATALOGUE UNCHANGED**
**— PRODUCTION UNTOUCHED**

The controlled staging import completed on 2026-07-26 in an interactive session
against `forever-staging`, using the payloads committed at head
`60e59d2316fec826aa1abe242439907e6089c2d6`. All four projects are present as
unpublished drafts.

| Metric             | Baseline | Final |    Delta |
| ------------------ | -------: | ----: | -------: |
| projects           |       60 |    64 |   **+4** |
| buildings          |        7 |    17 |  **+10** |
| units              |      290 |   689 | **+399** |
| prices             |      290 |   668 | **+378** |
| ingestion_batches  |      106 |   110 |   **+4** |
| ingestion_warnings |        8 |    48 |  **+40** |

Every delta is exactly the sum of the four imports, so nothing unrelated
changed. A repeated Coralina import was refused with
`draft_import_duplicate_slug` and wrote nothing. §15 carries the full record.

Two earlier statuses are superseded and retained only as history:

- **§3 and §13 record a BLOCKED result.** Those describe non-interactive
  sessions in which the password gate could not receive input. They are accurate
  about those attempts and are no longer the current status.
- **Coralina's staging presence was "query-unverified".** It is now resolved:
  the successful run began with no Wave 1 slug present, so Coralina was
  confirmed **absent before import** and was created fresh, not reused.

One decision remains open, and it is not a blocker: the Rainpalm price-list
selection. Rainpalm is loaded with 21 units and zero prices by design.

## 1. Exact base and branch

| Item           | Value                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| Branch         | `claude/forever-catalog-10-001`                                                     |
| Base SHA       | `a9d275fc678065ef70b331aee20f24f1c4f030e6` (`origin/main`, merge commit of PR #100) |
| Continued from | `72454e3` — planning-only commit, unpushed at task start                            |
| Worktree       | `C:\forever-worktrees\catalog-10`; `C:\forever` was read but never modified         |

## 2. Staging target verification

The task requires the authorized staging project to be identified explicitly and
never inferred from the locally linked project. Both were enumerated read-only
through the authenticated Supabase CLI project inventory.

| Role                   | Ref (sanitized) | Name                    | Region           | Linked locally |
| ---------------------- | --------------- | ----------------------- | ---------------- | -------------- |
| **Authorized staging** | `garji…zisu`    | `forever-staging`       | `ap-southeast-2` | **no**         |
| Production — forbidden | `abtvs…jeed`    | `ForeverOs26's Project` | `ap-northeast-1` | **yes**        |

Three facts follow, and they matter:

1. The **locally linked** Supabase project is **production**, exactly as the
   brief warned. `supabase/config.toml` pins `project_id` to the production ref.
   Any command that defaulted to the repository link would have hit production.
   No such command was issued.
2. The staging project is a genuinely separate project in a different region,
   created 2026-07-21, `ACTIVE_HEALTHY`, and is the same ref that
   `docs/FOREVER_STUDIO_001_IMPLEMENTATION_REPORT.md` records as
   `forever-staging`. Its pinned CA is present locally as
   `forever-staging-ca.crt`, distinct from the production CA.
3. The staging target is therefore **proven**. The §1 gate "stop when the target
   cannot be proven as staging" did not trip. The blocker is a later one.

## 3. The blocker — no staging database credential (HISTORICAL)

> **Superseded by §15.** This section describes the non-interactive sessions of
> FOREVER-CATALOG-10-002 and -005, where the password gate could not receive
> input. It remains accurate about those attempts. The import has since
> succeeded in an interactive session; nothing below is the current status.

Baseline counts, the Coralina state query, and every import in those sessions
required authenticated access to the staging Postgres database. That access did
not exist in them.

| Channel                                              | State                                                                                                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/import/Import-ForeverProjectDraft.ps1`      | Requires `-HostName`, `-SslRootCert` and a password. Line 153 prompts interactively (`Read-Host -AsSecureString`). This session is non-interactive.                                                                         |
| `FOREVER_IMPORT_HOST/PORT/DATABASE/USER/SSLROOTCERT` | Absent from the process, User and Machine environments.                                                                                                                                                                     |
| `.env`                                               | Only one exists, at `C:\forever\.env`. It holds a **production** URL and a publishable (anon) key. No staging URL, no staging key, no service-role key.                                                                     |
| `supabase migration list` / `db` commands            | Both `--db-url` and `--password` are declared required. There is no access-token-only read path.                                                                                                                            |
| `SUPABASE_ACCESS_TOKEN`                              | Not set. The CLI's token lives in the Windows Credential Manager and is reachable only by the CLI itself; extracting it to run ad-hoc SQL would mean handling a secret in plaintext and is not something this task will do. |

Two further points on why the gap was not worked around:

- The Owner password prompt is not an obstacle to route around. It is the
  deliberate per-import human gate the repository was built with. Substituting
  an ambient org-scoped token for it would replace the Owner's authorization
  with the agent's.
- The `src/import/` engine independently refuses staging by design.
  `IMPORT_TARGET_REGISTRY.staging` has `expectedProjectId: null` and
  `executeAllowedByTarget: false`, and `runImportPreflight` returns
  `staging_unconfigured` for any staging import. Making that path run would mean
  editing the guard, which §9 forbids ("do not weaken validation").

This is the same failure mode already on record: `CORALINA_SIMPLE_DRAFT_IMPORT_REPORT_FINAL.md`
(2026-07-18) reports "the authorized masked prompt could not receive input in
this non-interactive session. No database connection was made."

**Consequently, in those sessions: baseline counts were not recorded, no project
was loaded, no acceptance check ran against a live database, and no final
staging counts existed.** That was true then and is stated in the past tense
deliberately. Baseline, final counts and per-project verification now exist and
are in §15.

## 4. Coralina actual-state resolution

The brief asks which of the contradictory documents is right. The contradiction
was resolved from repository evidence; it could not be closed by query.

| Document                                                     | Claim                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `docs/CURRENT_STAGE.md` (canonical, 2026-07-23)              | "Coralina imported as an unpublished draft: 1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch" |
| `RC5_6_CONTROLLED_IMPORT_REPORT_FINAL.md` (2026-07-18 01:34) | Coralina absent; 0 of 405 expected writes; V15 rolled back                                                                |

Four later reports, all from 2026-07-18 and all newer than RC5.6, settle it:

| Report                                                       | Time  | Outcome                                                                                    |
| ------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------ |
| `CORALINA_PROGRESSIVE_DRAFT_IMPORT_REPORT_FINAL.md`          | 19:27 | not imported                                                                               |
| `CORALINA_TEMP_PAYLOAD_ROLE_BOUNDARY_REPAIR_REPORT_FINAL.md` | 19:55 | repair only                                                                                |
| `CORALINA_PROGRESSIVE_DRAFT_IMPORT_REPORT_FINAL_V2.md`       | 20:16 | stopped fail-closed at TLS attestation; "The committed Coralina import was not attempted." |
| `CORALINA_SIMPLE_DRAFT_IMPORT_REPORT_FINAL.md`               | 20:31 | "IMPORT FAILED AND ROLLED BACK … no database connection was made"; counts all zero         |

**Resolution: `docs/CURRENT_STAGE.md` is wrong.** Every Coralina import attempt
on record failed and rolled back. The canonical stage document describes the
intended end state of the package, not an achieved database state.

A second finding matters more for this task: **every one of those attempts
targeted production**, authenticating as the `postgres.<production-ref>` pooler
user. No Coralina import has ever been attempted against `forever-staging`.

Classification against the brief's four options:

- **C — absent**, for staging, at high confidence. No import was ever aimed at
  staging, and the staging project was created 2026-07-21, three days after the
  last attempt.
- **Now query-verified (2026-07-26).** The successful staging run began with no
  Wave 1 slug present in `forever-staging` — the pre-import duplicate check
  returned an empty set. Coralina was therefore **absent before import** and was
  created fresh. The repository-evidence classification above was correct, and
  `docs/CURRENT_STAGE.md` was wrong. See §15.

Because Coralina was absent rather than partial, no idempotent update variant
was prepared. The existing canonical package is a clean `create`, and that is
how it landed.

## 5. What was prepared

Four complete, validated, staging-ready draft packages. All four are
unpublished by construction, deterministic, and free of invented values.

| Project                         | Slug               | Buildings | Units | Prices | Media | Docs | Warnings |
| ------------------------------- | ------------------ | --------: | ----: | -----: | ----: | ---: | -------: |
| The Title Coralina Kamala       | `coralina`         |         8 |   198 |    198 |     0 |    0 |        6 |
| Rainpalm Villas                 | `rainpalm-villas`  |         0 |    21 |  **0** |     0 |    0 |        7 |
| Garden of Eden (Park Residence) | `garden-of-eden`   |         0 |     0 |      0 |     0 |    0 |       13 |
| The Title Sierra                | `the-title-sierra` |         2 |   180 |    180 |     0 |    0 |       14 |

Payload digests and idempotency keys:

| Slug               | `payload.json` SHA-256                                             | `batch_fingerprint`                                                |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `coralina`         | `2d5613a35705b251f20208aa4273038c2d8001bebe5d2c5bab5e55cb653e6605` | `9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c` |
| `rainpalm-villas`  | `4e5f5d4d56eab887097247e5165b4acdd08c0c31e2346fef1b0d1085ca7c5ed2` | `8f84fbecbf31daf2648f879181b3cc4302e1eab7a33530d6e194b09b2ff21a4e` |
| `garden-of-eden`   | `c8a5156779a7f92fbb3d1359f18276a59f3f8d5b02c9ce011b7ecd8307ea370a` | `de458b059155e971d6bdbe99c521e0009a15ca552d901d12ea02c054fceefbca` |
| `the-title-sierra` | `7cb81e154ab13d22df500209c5edb5ec87bfeadd733488c252053c62ed79c9a7` | `4a3e9c17fb826a8f42ae32f17cac9a30f92a00a19efdf5b0e2872fb12d625b29` |

All four pass the canonical offline validator:

```text
DRAFT_PAYLOAD_VALID|slug=coralina|sha256=2d5613a3…|buildings=8|units=198|prices=198|media=0|documents=0|warnings=6
DRAFT_PAYLOAD_VALID|slug=rainpalm-villas|sha256=4e5f5d4d…|buildings=0|units=21|prices=0|media=0|documents=0|warnings=7
DRAFT_PAYLOAD_VALID|slug=garden-of-eden|sha256=c8a51567…|buildings=0|units=0|prices=0|media=0|documents=0|warnings=13
DRAFT_PAYLOAD_VALID|slug=the-title-sierra|sha256=7cb81e15…|buildings=2|units=180|prices=180|media=0|documents=0|warnings=14
```

> **Owner Upload Trust Policy applied (FOREVER-CATALOG-10-004).** The three
> authored payloads were rebuilt under the trust policy for initial ingestion:
> Owner-supplied packages are accepted sources, provenance is `owner_provided`,
> and Rainpalm carries one soft price-version warning instead of four forensic
> ones. The hashes above are the ones that policy produced. See §12.

### 5.1 Coralina — local canonical payload reused unchanged; imported fresh into staging

"Reused" here means exactly one thing: the **local canonical payload** at
`forever-data/projects/coralina/progressive/payload.json` was re-validated and
carried forward unchanged. It does **not** mean an existing Coralina record was
found in staging and adopted.

**Resolved 2026-07-26.** Coralina was confirmed absent from `forever-staging`
before the import and was then created fresh as a new unpublished draft — 8
buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch. No staging row
was reused. See §15.

The canonical package was re-validated and reproduces its recorded hashes
exactly. Nothing was regenerated; re-deriving it would only risk drift.

- Identity: `The Title Coralina Kamala`, legal developer
  `Rhom Bho Property Public Company Limited` retained.
- Location resolved honestly: `Kamala, Phuket, Thailand`, area `Kamala`, with
  `location_unresolved` retained because no canonical `kamala` row exists yet.
- 8 buildings (A–H) and 198 units, both supported by the package.
- Prices carry `price_list_date` `2026-07-03` and full per-row provenance.
- Six existing warnings preserved verbatim.
- `publish: false`.

**The 2026-07-17 freshness question is answered, and the answer is mild.** The
fresher list was inventoried, not merged:

| Document                                                  | SHA-256                                                            | Bytes     |
| --------------------------------------------------------- | ------------------------------------------------------------------ | --------- |
| `CLK - Price List V.2. - Updated 17.07.26.pdf`            | `268c2fa30e39e89c7dd5e3d7751326e3cf958ec2783e5953eabccbece9b3f3c0` | 251,902   |
| `CLK - Master Plan Price list V.2 - updated 17.07.26.pdf` | `1f7d70c83a53b96981dabba3e03206996f8c1c6bfdfc37983a48c9e16eadd2fa` | 1,474,832 |

Read-only comparison of the 17.07.26 list against the ingested 03.07.26 package:

- 198 rows parsed, 0 unresolved.
- 197 unit codes shared with the package, **all 197 at byte-identical prices**.
- **No price moved between 03.07.26 and 17.07.26.**
- Exactly one inventory difference: `CKF406` is in the package and absent from
  the 17.07 list; `CKD508` is in the 17.07 list and absent from the package.
- All 198 rows in the 17.07 list read `Available`.

So the canonical prices are not stale; the fresher document is an inventory
correction of one unit. This stays a separate Owner freshness decision and was
not applied. The canonical package was not modified.

### 5.2 Rainpalm Villas — accepted structural draft, prices deferred

The Owner-approved Rainpalm package is the official initial working source. The
draft is accepted, not provisional and not weak.

| Item       | Value                                                                               |
| ---------- | ----------------------------------------------------------------------------------- |
| Identity   | `Rainpalm Villas`, developer raw `Tonsai Company`, `Bang Tao, Phuket`, `Pool Villa` |
| Units      | 21, each with code, type, bedrooms, bathrooms and size                              |
| Prices     | 0 — deferred, see below                                                             |
| Provenance | `owner_provided` / `owner_uploaded_project_material` / confidence 1                 |
| Status     | `publish: false`                                                                    |

Unit code, type, bedrooms, bathrooms and size all come from the same row of the
same document, so each unit carries **one** `metadata.source` record naming that
row rather than five identical provenance objects.

**Prices are inactive for exactly one reason: the package holds four price-list
versions.** No single current schedule can be selected yet. That ambiguity does
not block the project or its units — it is recorded as one soft warning:

```text
multiple_price_list_versions (severity: info)
```

The warning carries all four versions with their filenames, digests and sizes;
states that prices activate once the Owner selects the current version or a
newer developer price list arrives; and notes that availability is deferred
alongside prices because it moves with the price list. Nothing was averaged,
merged or selected by filename.

The retired Fast Intake v1 package is retained as
`forever-data/projects/rainpalm-villas/progressive/payload.fast-intake-v1.json`
for history. Media and documents are 0: media rows need a hosted URL and no
Storage upload was performed.

**RAINPALM STRUCTURAL DRAFT ACCEPTED — PRICE VERSION SELECTION PENDING.**

### 5.3 Garden of Eden (Park Residence) — highest honest draft

The source is two January 2026 decks. Everything the deck states is recorded;
everything it does not state is absent and warning-marked.

| Item          | Source-stated value                                                |
| ------------- | ------------------------------------------------------------------ |
| Official name | `GARDEN OF EDEN (PARK RESIDENCE)` — singular, as the source has it |
| Property type | `PREMIUM APART-HOTEL`                                              |
| Location      | `Layan`; 300 m to beach                                            |
| Completion    | `Q4-2027`                                                          |
| Buildings     | 6                                                                  |
| Total area    | over 122,000 sqm                                                   |
| Source date   | `January 2026`, stated on the title page                           |

Notable decisions:

- **Developer is unstated.** Neither deck names a developer, so no raw developer
  name was preserved — there is none to preserve. `developer_unresolved` records
  it. This does not block the draft and no separate developer confirmation is
  required before creating one.
- **Provenance is `owner_provided`.** The decks are an Owner-supplied project
  package, so under the trust policy every field carries
  `status: "owner_provided"`, `source_type: "owner_uploaded_project_material"`,
  `confidence: 1` and `source_date: "2026-01"`. Confidence 1 means the
  extraction is faithful to the package, not that the package has been
  independently audited.
- `completion_date` stays NULL. `Q4-2027` is a quarter, not a date; resolving it
  to a day would be invention. The stated quarter is kept in
  `completion_quarter_only`.
- **No building rows were created** despite "Buildings: 6", because the deck
  gives no identifiers. Inventing six codes would fabricate structure. The
  stated count is preserved in `building_inventory_missing`.
- Pages 4–6 carry a five-year investment model with entry/exit figures, discount
  tiers, ROI percentages and a stated rental return. `investment_projections_not_prices`
  records explicitly that these are agency projections, that they were
  deliberately not ingested, and that they must never be rendered as a price, a
  price range or a yield promise.
- Source-stated facts with no column in the schema (300 m to beach, 122,000 sqm,
  70% landscaped, professional management) are preserved in
  `stated_facts_not_modelled` rather than discarded or forced into an unrelated
  field.

### 5.4 The Title Sierra — Passport Light plus the 2026-05-15 price list

The freshest unit-level price data in the whole intake, extracted through the
SIP-sanctioned path.

Extraction is `pdftotext -table` from **Xpdf 4.06**. This matters: the SIP
contract (`src/intake/sip/pdf-tool.ts`) permits table mode only for an Xpdf
build, and the builder asserts the vendor before running. Under `-layout` this
document exhibits the same column-registration drift the register recorded for
Rainpalm — the Tower/Floor and Type columns lag their rows by one line. Table
mode resolves it from PDF coordinates rather than guessing, and the builder
refuses to emit anything if a single row fails its strict pattern.

Integrity gates, all passed on all 180 rows:

| Gate                                               | Result      |
| -------------------------------------------------- | ----------- |
| Rows parsed / unresolved                           | 180 / **0** |
| Unique room numbers                                | 180 of 180  |
| Tower letter agrees with room-number prefix        | 180 of 180  |
| Floor agrees with room-number encoding             | 180 of 180  |
| Price/sqm × area agrees with selling price (±0.5%) | 180 of 180  |
| Non-integer selling prices                         | 0           |

Verified content:

| Item            | Value                                                           |
| --------------- | --------------------------------------------------------------- |
| Official name   | `THE TITLE SIERRA` (internal code `SIB`)                        |
| Buildings       | Towers `A` and `C`, taken from the Tower column                 |
| Units           | 180 — 128 in Tower A, 52 in Tower C; floors 3–8                 |
| Bedrooms        | 157 one-bedroom, 23 two-bedroom, read from the stated Room Type |
| Areas           | 28.40 – 58.10 sqm                                               |
| Prices          | 180, THB 3,145,400 – 7,713,800                                  |
| Price-list date | `2026-05-15`, from the in-document header `Updated : 15.05.26`  |
| Availability    | all 180 stated `Available`; no conflicts                        |

Decisions worth stating:

- **`project_type` is absent.** The document exhibits a tower/floor/room
  structure with a sinking fund and a monthly common fee, but never names a
  property type. Calling it a condominium would be inference, so the field stays
  NULL and `project_type_missing` carries the observed structure.
- **No developer name at all**, not even raw. The price list names no legal
  entity, and resolving The Title brand prefix to a company would be invention.
- `location_missing` stands. The master plan that would carry the location is
  image-only — zero extractable characters, digest recorded.
- **Currency is THB at medium confidence, honestly qualified.** The Selling
  Price column carries no currency marker. THB is stated in the same document,
  on page 4, for the sinking fund and common fee. The decision records that
  evidence with its page and an explicit `currency_not_stated_on_price_rows`
  review finding, rather than claiming the price rows state THB.
- `unit_type_code_inconsistent` records a genuine source self-contradiction: the
  `Type (No.)` code `1BMC2` maps to both `1 BEDROOM MC2` and
  `1 BEDROOM MC2(M)`. Both columns are stored verbatim — Room Type as
  `unit_type`, Type (No.) in unit metadata — and neither was normalised.
- Bathrooms are absent from the source and stay NULL for all 180 units.
- **Building rows carry a code and nothing else.** The Tower column supplies the
  letters `A` and `C`. It supplies no building _name_, so none is emitted — a
  label such as "Tower A" would be this pipeline's invention presented as a
  source fact, and marking a derived display string as developer-provided would
  be worse still. Floor and unit counts are likewise absent: a price list
  enumerates offered units, not a building's inventory, so deriving counts from
  it would overstate. A build-time assertion fails the run if any building ever
  regains a `name`. The RPC supplies its own fallback label at insert time,
  which is a database default rather than a fact asserted here.

**Internal Use Only handling.** Every page is stamped `(Internal Use Only)`.
`internal_use_only_source` records that the data may be held in this internal
draft, that unit-level prices and the document itself must not become
anonymously public, and that no publication permission is implied. §8 explains
why the draft state enforces this structurally.

## 6. Warnings summary

| Project            | Warnings                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coralina`         | `developer_unresolved`, `location_unresolved`, `coordinates_missing`, `construction_status_missing`, `media_processing_deferred`, `document_processing_deferred`                                                                                                                                                                                                  |
| `rainpalm-villas`  | `country_missing`, `coordinates_missing`, `construction_status_missing`, `developer_unresolved`, `location_unresolved`, **`multiple_price_list_versions`**, `media_not_ingested`                                                                                                                                                                                  |
| `garden-of-eden`   | `developer_unresolved`, `location_unresolved`, `country_missing`, `coordinates_missing`, `construction_status_missing`, `completion_quarter_only`, `building_inventory_missing`, `unit_types_missing`, `price_list_missing`, `investment_projections_not_prices`, `stated_facts_not_modelled`, `media_not_ingested`, `source_date_recorded`                       |
| `the-title-sierra` | `developer_unresolved`, `location_missing`, `country_missing`, `project_type_missing`, `coordinates_missing`, `construction_status_missing`, `bathrooms_missing`, `building_inventory_partial`, `unit_type_code_inconsistent`, `price_currency_document_level_only`, `internal_use_only_source`, `brochure_missing`, `media_not_ingested`, `source_date_recorded` |

## 7. Determinism and idempotent replay

**Determinism — verified.** `scripts/catalog/build-wave1-payloads.mjs`
regenerates the three authored payloads. Two consecutive `--check` runs reported
`UNCHANGED` for all three with identical fingerprints, and a third run after
reformatting the builder also reported `UNCHANGED`. The fingerprint function is
byte-identical to the repository's canonical
`src/features/forever-ingestion/build-batch.ts::fingerprintBatch`, and it
reproduces the two pre-existing fingerprints exactly — `coralina`
`9ceb05d2…` and the original `rainpalm-villas` `2ef69311…` — which is what
proves the implementation is the same one, not merely a similar one.

All four payloads self-verify: recomputing the fingerprint from the committed
content reproduces the declared `batch_fingerprint` in every case, which is the
check `src/intake/validate-draft.ts` performs and the PowerShell path does not.

**Source identity is pinned for reproducibility, not as an audit.** Eleven
documents are pinned by filename, SHA-256 and byte length — two Sierra, two
Garden of Eden, seven Rainpalm — so a given Owner package rebuilds to the same
payload every time. Each is resolved by filename across
`FOREVER_WAVE1_SOURCE_ROOTS` on a normal build and on `--check` alike.

The digest picks the intended copy of the selected package. It is deliberately
**not** a cross-folder conflict system: several folders holding a file of the
same name is normal and never blocks a project. If no copy matches the pin, the
package has moved on — the build takes the newest candidate, records a soft
`source_version_changed` notice, and continues. Only a file that cannot be found
or read stops the build.

The earlier forensic negative-test harness, whose only purpose was cross-folder
source-conflict handling, has been removed along with the hard blockers it
tested. The build-time audits that remain cover the hard-blocker list in §12.6:
draft-only status, duplicate unit codes, unparseable numerics, Rainpalm's
zero-price contract, and Sierra's code-only buildings.

**Idempotent replay — proven from the contract, not from a run.** A second
identical import creates zero duplicate business rows, guaranteed at three
independent layers:

1. `public.forever_progressive_ingest` recomputes its own server-side payload
   hash. On an exact replay of a completed batch it returns the stored summary
   with `replayed: true` and writes nothing. An old idempotency key carrying
   changed content raises `fingerprint_payload_mismatch`.
2. The importer's in-transaction preflight raises `draft_import_duplicate_slug`
   if the slug already exists and `draft_import_duplicate_batch_fingerprint` if
   the fingerprint has been used — before the RPC is reached.
3. The importer additionally raises `draft_import_unexpected_replay` if the RPC
   reports `replayed`, and the whole thing is one `BEGIN`/`COMMIT`.

This is a contract-level guarantee. It has **not** been demonstrated against
`forever-staging`, because nothing was loaded. The demonstration is the second
half of §9.

## 8. Public and private verification

Verified statically from the migration chain, which is checkable without a
database connection:

| Guarantee                                      | Mechanism                                                                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drafts are never public                        | `public.projects` public SELECT policy is `is_active = true AND public_status = 'published'`. The RPC's create path hard-codes `'draft'` and cannot publish.           |
| Draft units, prices and media are never public | Every project-scoped child table — `units`, `buildings`, `unit_price_history`, `project_media`, `documents`, `images`, `videos` — requires a published, active parent. |
| Warnings and batches are never public          | `ingestion_warnings` and `ingestion_batches` have RLS enabled and **no public policy at all**.                                                                         |
| Never born verified                            | The RPC hard-codes `forever_verified = false` on create.                                                                                                               |
| No automatic media publication                 | All four payloads carry `media: 0` and `documents: 0`. No asset was uploaded and no Storage object was created or made public.                                         |

So Sierra's Internal Use Only unit prices are structurally unreachable
anonymously for as long as the project stays `draft`. **Public catalogue absence
was not confirmed by query** — that requires the missing credential — but the
policy chain makes a draft's public visibility impossible by construction rather
than by convention.

Nothing was published. No `publish` flag is `true` in any payload.

## 9. Runbook — executed 2026-07-26 (retained for re-use)

> **This runbook has been executed successfully.** It is retained because it is
> the procedure Waves 2 and 3 will reuse, and because it documents exactly how
> the Wave 1 import was performed. Results are in §15.

Each project is one command, run from `C:\forever-worktrees\catalog-10` in an
interactive PowerShell window that can accept the password prompt. Load them
one at a time and check the result before continuing.

Set the non-secret connection settings for **staging** first — note the staging
host and the staging CA, not the production ones:

```bash
$env:FOREVER_IMPORT_HOST = "db.<staging-ref>.supabase.co"
$env:FOREVER_IMPORT_SSLROOTCERT = "$env:USERPROFILE\.supabase\certs\forever-staging-ca.crt"
```

Record the baseline before the first import:

```bash
psql -h $env:FOREVER_IMPORT_HOST -U postgres -d postgres -c "SELECT (SELECT count(*) FROM public.projects) AS projects, (SELECT count(*) FROM public.developers) AS developers, (SELECT count(*) FROM public.buildings) AS buildings, (SELECT count(*) FROM public.units) AS units, (SELECT count(*) FROM public.unit_price_history) AS prices;"
```

Confirm Coralina's actual staging state before loading it:

```bash
psql -h $env:FOREVER_IMPORT_HOST -U postgres -d postgres -c "SELECT slug, public_status FROM public.projects WHERE slug IN ('coralina','rainpalm-villas','garden-of-eden','the-title-sierra') OR name ILIKE '%coralina%';"
```

Then, in this order — lowest risk first:

```bash
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project garden-of-eden -HostName $env:FOREVER_IMPORT_HOST -SslRootCert $env:FOREVER_IMPORT_SSLROOTCERT
```

```bash
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project the-title-sierra -HostName $env:FOREVER_IMPORT_HOST -SslRootCert $env:FOREVER_IMPORT_SSLROOTCERT
```

```bash
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project rainpalm-villas -HostName $env:FOREVER_IMPORT_HOST -SslRootCert $env:FOREVER_IMPORT_SSLROOTCERT
```

```bash
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project coralina -HostName $env:FOREVER_IMPORT_HOST -SslRootCert $env:FOREVER_IMPORT_SSLROOTCERT
```

Each emits `IMPORTED AS DRAFT|<slug>|{...}` with post-commit counts. Verify
those counts equal §5 before running the next. To prove idempotent replay, run
any one command a second time: it must fail with `draft_import_duplicate_slug`
and write nothing.

Before running any of this, confirm `public.forever_progressive_ingest` exists
on staging. Staging migration history was last recorded as contiguous through
`20260722140000`, which includes `20260718113000_progressive_ingestion_v1`, but
that was 2026-07-22 and is not re-verified here.

## 10. Production untouched

| Check                          | Result                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Production database connection | **None.** No psql, no client, no query.                                                           |
| Production credential used     | **None.** The production anon key in `C:\forever\.env` was never read into any command.           |
| Production migration applied   | None.                                                                                             |
| Production write               | None.                                                                                             |
| Locally linked project         | Remains production, unlinked and unused; `supabase/config.toml` unmodified.                       |
| Supabase CLI use               | One read-only `projects list` for identity comparison.                                            |
| Publication                    | None. No public catalogue output changed.                                                         |
| Owner source files             | Read-only throughout. No create, delete, rename, move or edit.                                    |
| Private zones                  | Not entered. No client, contract, financial or personal file referenced.                          |
| Committed secrets              | None. No credential, no connection string, no Owner absolute path, no Internal Use Only document. |

## 11. What the Owner must supply

Blocking Wave 1 entirely:

1. ~~**Staging database access**~~ — **satisfied 2026-07-26.** The import ran in
   an interactive session and all four drafts are loaded. Nothing blocks Wave 1
   staging any longer.

Blocking Rainpalm prices only, unchanged from the register §7.4:

2. The authoritative Rainpalm price list, with its issue date stated inside the
   document.
3. A ruling on whether the `4_12_2025` variant supersedes the 14-price schedule,
   and what `4_12_2025` denotes.
4. The absent `Копия Rainpalm - Price List（for In house)-1.pdf`, or written
   confirmation that `Rainpalm - Price List new.pdf` is the same document.
5. D4's availability: Available or Reserved.

Non-blocking, needed before any publication:

6. Written permission to publish unit-level prices from Internal Use Only
   documents — applies to Coralina, Sierra and Rainpalm.
7. Developer legal identity for Garden of Eden and The Title Sierra.
8. A location statement for The Title Sierra in a text-extractable document.
9. A decision on the Coralina `CKF406` / `CKD508` inventory difference.

## 12. Owner Upload Trust Policy (FOREVER-CATALOG-10-004)

The Owner set the product rule for initial ingestion: it must be simple and
permissive. This section supersedes the source-forensics framing of the two
earlier passes, and the payload hashes in §5 are the ones this policy produced.

### 12.1 The policy

A project package the Owner deliberately supplies — ZIP, brochure, price list,
master plan, floor plans, images, spreadsheets, presentations — **is** the
official working source for the initial unpublished draft. The first import is
not a forensic source audit. It prioritises speed and completeness.

Facts faithfully extracted from an approved package are recorded as:

| Field         | Value                             |
| ------------- | --------------------------------- |
| `status`      | `owner_provided`                  |
| `source_type` | `owner_uploaded_project_material` |
| `confidence`  | `1`                               |

`owner_provided` is the existing status in
`src/features/forever-ingestion/provenance.ts` for direct first-party Owner
input; nothing new was invented. Confidence 1 records that the extraction is
faithful to the package — not that the package has been independently audited.
No second document is required for an initial draft.

### 12.2 What changed from the previous pass

| Area                             | Before                                                                                                                                 | Now                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Garden of Eden provenance        | `extracted` / `agency_investment_presentation` / 0.5                                                                                   | `owner_provided` / `owner_uploaded_project_material` / 1 |
| Rainpalm unit provenance         | `extracted` / `operator_intake` / 0.5, repeated per field                                                                              | `owner_provided` / 1, **one row-level source record**    |
| Rainpalm price warnings          | 4 warnings incl. `authoritative_price_list_unresolved`, `cited_source_file_absent`, `availability_unverified`, `availability_conflict` | 1 soft `multiple_price_list_versions`                    |
| Rainpalm warning count           | 10                                                                                                                                     | 7                                                        |
| Same-name file in another folder | hard build failure                                                                                                                     | soft `source_version_changed` notice                     |
| Cited-but-absent document        | hard build failure (`cited_source_reappeared`)                                                                                         | not modelled — belongs to later inspection               |
| Forensic negative-test harness   | `scripts/catalog/test-wave1-source-integrity.mjs`                                                                                      | removed                                                  |

Unit code, unit type, bedrooms, bathrooms and size come from the same row of the
same document, so they now share one `metadata.source` record instead of five
identical provenance objects. Sierra units and buildings use the same shape.

### 12.3 Rainpalm — accepted structural draft

The Rainpalm Owner package is the official initial working source. The draft
carries project identity, 21 units with codes, types, bedrooms, bathrooms and
sizes, and `publish: false`.

**The structural layer is not classified as weak, provisional or
non-document-backed.** It is an accepted Owner-supplied structure.

Prices remain at zero for one reason only: the package holds four price-list
versions, so no single current schedule can be selected yet. That ambiguity does
not block the project or the units. One soft warning records it:

```text
multiple_price_list_versions (severity: info)
```

It states that prices and availability stay inactive, that the 21-unit structure
is accepted and unaffected, and that prices activate once the Owner selects the
current version or a newer developer price list arrives. All four versions are
preserved side by side; none was averaged, merged or chosen by filename.
Availability is deferred with prices because it moves with the price list.

### 12.4 Garden of Eden and Sierra

Both Owner-supplied packages are accepted initial project sources with
`owner_provided` provenance. No separate developer confirmation is required
before creating an unpublished draft.

Missing data still stays missing and is warning-marked — Garden of Eden has no
units, buildings or prices; Sierra has no location, developer or property type —
but none of that blocks the draft, and nothing was invented to fill a gap.
Sierra buildings keep a source-backed `building_code` and no derived name.

### 12.5 Same-name files are not a blocker

The selected Owner package is the source boundary. Several folders holding a
file of the same name is normal. The pinned SHA-256 picks the intended copy for
reproducibility; if no copy matches the pin, the build takes the newest
candidate, records a soft `source_version_changed` notice, and continues. Only a
file that cannot be found or read stops the build.

### 12.6 Hard blockers for an initial import

Only these stop a draft. Everything else is a warning or stays absent.

| Blocker                                          | Enforced by                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| File cannot be read                              | `source_unreadable` in the source resolver                        |
| Package cannot be associated with a project      | builder requires a slug and name                                  |
| Payload fails the schema                         | canonical validator and the ingestion RPC                         |
| Duplicate project slug                           | RPC `project_slug_exists`; importer `draft_import_duplicate_slug` |
| Duplicate unit code in one payload               | `duplicate_unit_code` audit                                       |
| Numeric value cannot be parsed                   | `unit_value_unparseable` / `price_value_unparseable` audits       |
| Executable or secret material would be committed | `.gitignore` allowlist plus the pre-commit scans                  |
| Database target cannot be proven to be staging   | §2, and the import target guard                                   |

### 12.7 Later Inspection / Update workflow — not implemented here

Deep verification moves to a future workflow, to run after a Forever broker
visits the project or a newer official package arrives. It will:

- compare the new package with the existing project;
- detect duplicate units;
- detect changed prices and availability;
- preserve prior values and their source dates;
- flag conflicts for review;
- update only after that review.

None of it is implemented in this PR. Recording it here fixes where the
verification burden belongs: on the update path, not on first ingestion.

### 12.8 Validation

| Check                                                                  | Result                                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Builder, normal run                                                    | pass — three payloads written                                                                                                  |
| Builder, `--check`                                                     | pass — all `UNCHANGED`, exit 0                                                                                                 |
| Canonical offline validator, all four payloads                         | `DRAFT_PAYLOAD_VALID` ×4                                                                                                       |
| Fingerprint self-verification, all four                                | 4/4 recompute correctly                                                                                                        |
| Duplicate unit-code check, all four                                    | none                                                                                                                           |
| Unpublished status, all four                                           | `publish: false`, `mode: create`                                                                                               |
| Build-time audits (draft-only, duplicates, numerics, Rainpalm, Sierra) | pass                                                                                                                           |
| `git check-ignore -v` safety check                                     | source directories remain ignored                                                                                              |
| Owner absolute-path scan of staged content                             | clean                                                                                                                          |
| Credential/secret scan of staged content                               | clean                                                                                                                          |
| `git diff --check`                                                     | clean                                                                                                                          |
| Prettier, builder and edited docs                                      | formatted                                                                                                                      |
| ESLint                                                                 | superseded — see §14, which ran it after a lockfile install                                                                    |
| GitHub CI checks on PR #104                                            | **none configured.** No `.github/workflows` exists and the PR reports zero checks. An empty check list is not a passing build. |

No database was contacted in the passes covered by §12.

## 13. Wave 1 controlled staging import attempt — first try, blocked (HISTORICAL)

> **Superseded by §15.** This records the FOREVER-CATALOG-10-005 attempt, which
> ran in a non-interactive session and could not reach the database. It is
> retained because it establishes the staging-target proof and the safety
> boundary that the successful run later reused. The import has since completed;
> nothing in this section is the current status.

**Result at the time: BLOCKED — payloads ready, interactive staging access
required, no database contact.**

No project was imported in that attempt. No database was contacted — not
staging, not production. The blocker was the one the brief anticipated: the
sanctioned interactive password gate could not receive input in that session.

### 13.1 Preconditions

| Check    | Result                                                                 |
| -------- | ---------------------------------------------------------------------- |
| PR head  | `ca3c02d9cdedc030be92de30acc6a88a1831bad5` — matches the expected head |
| Branch   | `claude/forever-catalog-10-001`                                        |
| Worktree | clean before and after                                                 |

### 13.2 Staging target — proven

Enumerated read-only through the Supabase management API from a temporary
working directory, so no repository link could be consulted.

| Role                   | Ref (sanitized) | Name                    | Region           | Status           | Database host               |
| ---------------------- | --------------- | ----------------------- | ---------------- | ---------------- | --------------------------- |
| **Authorized staging** | `garji…zisu`    | `forever-staging`       | `ap-southeast-2` | `ACTIVE_HEALTHY` | `db.garji…zisu.supabase.co` |
| Production — forbidden | `abtvs…jeed`    | `ForeverOs26's Project` | `ap-northeast-1` | `ACTIVE_HEALTHY` | not used                    |

The staging CA is present at `forever-staging-ca.crt` (Supabase Root 2021 CA),
distinct from the production CA. `--linked` was never used; the repository's
`supabase/config.toml` still pins production, which is precisely why the
enumeration ran outside the repository.

**The staging target is proven.** The §1 gate did not trip. The blocker is
later.

### 13.3 The blocker — the interactive password gate cannot receive input

`scripts/import/Import-ForeverProjectDraft.ps1` line 153 calls
`Read-Host 'Database password' -AsSecureString` when no `-Password` is supplied.
That prompt was probed directly, in isolation, with no database involved:

```text
stdin is NOT a tty
exit_code=124   (killed after 20s — Read-Host blocked forever waiting for input)
output=[]
```

`Read-Host` did not fail; it blocked indefinitely on input that cannot arrive.
This is a session property, not a repository defect.

No sanctioned alternative exists, and none was manufactured:

| Channel                                              | State                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `FOREVER_IMPORT_HOST/PORT/DATABASE/USER/SSLROOTCERT` | absent from Process, User and Machine environments                     |
| `PGPASSWORD`, `SUPABASE_DB_PASSWORD`                 | absent from all three scopes                                           |
| `.env`                                               | only `C:\forever\.env` exists; production URL and publishable key only |
| Ad-hoc SQL reproduction                              | **forbidden by §3** and not attempted                                  |
| Importer guard modification                          | **forbidden by §3** and not attempted                                  |
| Target-attestation bypass                            | **forbidden by §3** and not attempted                                  |

The password was not requested from, searched for in, or extracted from any
credential store. Doing so would mean handling it in plaintext and would bypass
the very gate §1 and §3 designate as the only channel.

### 13.4 What §2 through §7 therefore produced

Every step from §2 onward requires an authenticated staging connection, so none
of it ran. Nothing below is asserted from inference.

| Brief section                     | Status                                                  |
| --------------------------------- | ------------------------------------------------------- |
| §2 Baseline counts                | **not recorded** — requires a connection                |
| §2 Duplicate-slug read-only check | **not run**                                             |
| §2 Coralina actual starting state | resolved later — absent before import, see §15          |
| §3 Imports (all four)             | **not executed** — zero commands issued                 |
| §5 Post-import verification       | **not run**                                             |
| §6 Replay safety                  | **not run**                                             |
| §7 Final counts and deltas        | **not recorded**; baseline − final = **0 rows written** |

**At that time Coralina's actual starting state remained unknown.** It was
confirmed later: the successful run found no Wave 1 slug present, so the
§4 classification (absent from staging) is now query-verified. See §15.

### 13.5 Payloads are ready and match the expected results exactly

The committed payloads at PR head were re-validated offline through the
canonical validator. Every count matches §4 of the brief:

| Project            | §4 expected                                     | Payload actual           | Match |
| ------------------ | ----------------------------------------------- | ------------------------ | ----- |
| `coralina`         | 8 buildings, 198 units, 198 prices, 6 warnings  | 8 / 198 / 198 / 6        | yes   |
| `rainpalm-villas`  | 21 units, 0 prices, 7 warnings                  | 0 buildings / 21 / 0 / 7 | yes   |
| `garden-of-eden`   | 0 buildings, 0 units, 0 prices, 13 warnings     | 0 / 0 / 0 / 13           | yes   |
| `the-title-sierra` | 2 buildings, 180 units, 180 prices, 14 warnings | 2 / 180 / 180 / 14       | yes   |

```text
DRAFT_PAYLOAD_VALID|slug=coralina|sha256=2d5613a3…|buildings=8|units=198|prices=198|media=0|documents=0|warnings=6
DRAFT_PAYLOAD_VALID|slug=rainpalm-villas|sha256=4e5f5d4d…|buildings=0|units=21|prices=0|media=0|documents=0|warnings=7
DRAFT_PAYLOAD_VALID|slug=garden-of-eden|sha256=c8a51567…|buildings=0|units=0|prices=0|media=0|documents=0|warnings=13
DRAFT_PAYLOAD_VALID|slug=the-title-sierra|sha256=7cb81e15…|buildings=2|units=180|prices=180|media=0|documents=0|warnings=14
```

The §5 assertions that can be checked without a database were checked, and all
pass:

| Assertion                                                                       | Result |
| ------------------------------------------------------------------------------- | ------ |
| Rainpalm — 21 units, 21 unique codes                                            | pass   |
| Rainpalm — zero price rows                                                      | pass   |
| Rainpalm — no imported availability claim (0 units carry `availability_status`) | pass   |
| Rainpalm — `multiple_price_list_versions` present                               | pass   |
| Garden of Eden — project exists with 0 buildings, units and prices              | pass   |
| Sierra — exactly 180 unique unit codes                                          | pass   |
| Sierra — 180 price rows, every one matching a unit code                         | pass   |
| Sierra — buildings `A` and `C`                                                  | pass   |
| All four — `publish: false`                                                     | pass   |

What remains unverifiable without a connection is only the database-side half:
that the rows land, that the fingerprint is stored, that no unrelated project
changes, and that a replay writes nothing.

### 13.6 Safety confirmations

| Confirmation                                        | Evidence                                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Production never contacted                          | No connection, query, credential or connection string. Production was listed once, read-only, for identity comparison. |
| Staging never contacted                             | The password gate blocked before any connection could be attempted.                                                    |
| Rows written                                        | **0** in both projects                                                                                                 |
| Projects published                                  | none — no import ran, and all four payloads carry `publish: false`                                                     |
| Public catalogue output                             | unchanged                                                                                                              |
| Booth tables, Booth migrations, Cloudflare, PR #102 | untouched, as required by §1                                                                                           |
| Migrations applied                                  | none                                                                                                                   |
| Password handling                                   | never printed, saved, logged, committed or pasted — it was never obtained                                              |
| Repository changes                                  | documentation only                                                                                                     |

### 13.7 Unresolved: the Rainpalm price-selection decision (still open)

Independent of staging access, one Owner decision is still open. The Rainpalm
package holds four price-list versions, so no current schedule can be selected.
The draft therefore carries 21 units and zero prices, with the soft
`multiple_price_list_versions` warning naming the activation condition.

Prices activate when the Owner either selects the current version from the four
already in the package, or supplies a newer developer price list. Availability
is deferred alongside prices because it moves with the price list. Nothing was
averaged, merged or chosen by filename. **This does not block the import** — the
21-unit structure is accepted and ready to load now.

### 13.8 What unblocked Wave 1 (executed successfully — see §15)

One thing: an interactive session that can answer the masked prompt. From
`C:\forever-worktrees\catalog-10`, with the staging host and staging CA set
explicitly — never `--linked`, never the production ref:

```bash
$env:FOREVER_IMPORT_HOST = "db.<staging-ref>.supabase.co"
```

```bash
$env:FOREVER_IMPORT_SSLROOTCERT = "$env:USERPROFILE\.supabase\certs\forever-staging-ca.crt"
```

Record the baseline, then the read-only duplicate check for all four slugs:

```bash
psql -h $env:FOREVER_IMPORT_HOST -U postgres -d postgres -c "SELECT (SELECT count(*) FROM public.projects) projects, (SELECT count(*) FROM public.buildings) buildings, (SELECT count(*) FROM public.units) units, (SELECT count(*) FROM public.unit_price_history) prices, (SELECT count(*) FROM public.ingestion_batches) batches, (SELECT count(*) FROM public.ingestion_warnings) warnings;"
```

```bash
psql -h $env:FOREVER_IMPORT_HOST -U postgres -d postgres -c "SELECT slug, public_status FROM public.projects WHERE slug IN ('coralina','rainpalm-villas','garden-of-eden','the-title-sierra');"
```

Then import one at a time, in the §3 order — Coralina only if that check shows
it absent:

```bash
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project coralina -HostName $env:FOREVER_IMPORT_HOST -SslRootCert $env:FOREVER_IMPORT_SSLROOTCERT
```

```bash
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project rainpalm-villas -HostName $env:FOREVER_IMPORT_HOST -SslRootCert $env:FOREVER_IMPORT_SSLROOTCERT
```

```bash
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project garden-of-eden -HostName $env:FOREVER_IMPORT_HOST -SslRootCert $env:FOREVER_IMPORT_SSLROOTCERT
```

```bash
powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project the-title-sierra -HostName $env:FOREVER_IMPORT_HOST -SslRootCert $env:FOREVER_IMPORT_SSLROOTCERT
```

Each emits `IMPORTED AS DRAFT|<slug>|{...}` with post-commit counts; check them
against §13.5 before running the next. For §6 replay safety, run any one command
a second time: the expected outcome is a refusal with
`draft_import_duplicate_slug` and zero rows written.

## 14. Independent local readiness audit at head `73041a0`

Earlier passes ran without repository dependencies installed and recorded ESLint
as "not run". That is now corrected: `npm ci` installs cleanly from the
committed lockfile, and the full local toolchain was exercised. This section
records what was actually measured, and separates PR-owned results from
reproduced baseline failures by running the same checks at the merge-base
`a9d275fc` in a throwaway worktree.

No database was contacted. Nothing about the staging import, database replay or
post-import counts is claimed here — those remain unrun and still require the
interactive session described in §13.8.

### 14.1 Environment

| Item                        | Value                                                                   |
| --------------------------- | ----------------------------------------------------------------------- |
| Head audited                | `73041a059098a90369400981894d3c0876364311`                              |
| Merge-base compared against | `a9d275fc678065ef70b331aee20f24f1c4f030e6`                              |
| Install                     | `npm ci` — 619 packages, lockfile SHA-256 unchanged, working tree clean |
| Node / npm                  | v24.18.0 / 11.16.0                                                      |

### 14.2 Independent payload recalculation

Recomputed without reusing the builder's helpers. Fingerprints were recomputed
with the repository's canonical
`src/features/forever-ingestion/build-batch.ts::fingerprintBatch`, loaded through
`jiti` — so a divergence between the builder's private copy and the canonical
implementation would have surfaced. It did not.

| Slug               | `payload.json` SHA-256                                             | `batch_fingerprint`                                                | Canonical recompute |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------- |
| `coralina`         | `2d5613a35705b251f20208aa4273038c2d8001bebe5d2c5bab5e55cb653e6605` | `9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c` | matches             |
| `rainpalm-villas`  | `4e5f5d4d56eab887097247e5165b4acdd08c0c31e2346fef1b0d1085ca7c5ed2` | `8f84fbecbf31daf2648f879181b3cc4302e1eab7a33530d6e194b09b2ff21a4e` | matches             |
| `garden-of-eden`   | `c8a5156779a7f92fbb3d1359f18276a59f3f8d5b02c9ce011b7ecd8307ea370a` | `de458b059155e971d6bdbe99c521e0009a15ca552d901d12ea02c054fceefbca` | matches             |
| `the-title-sierra` | `7cb81e154ab13d22df500209c5edb5ec87bfeadd733488c252053c62ed79c9a7` | `4a3e9c17fb826a8f42ae32f17cac9a30f92a00a19efdf5b0e2872fb12d625b29` | matches             |

All four also pass `src/intake/validate-draft.ts::validateDraftPayloadFile`,
which independently recomputes the fingerprint and is stricter than the
PowerShell path.

Per-payload invariants, all verified independently:

| Check                                                                 | Result                                              |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `schema_version = 1`, `mode = create`, `publish = false`              | 4/4                                                 |
| Slug matches directory                                                | 4/4                                                 |
| `documents = 0`, `media = 0` (no auto public media)                   | 4/4                                                 |
| Counts equal the expected draft results                               | 4/4 — 8/198/198/6, 0/21/0/7, 0/0/0/13, 2/180/180/14 |
| Unit codes unique                                                     | 198, 21, 0, 180 — no duplicates anywhere            |
| Building codes unique, every unit's `building_code` resolves in-batch | 4/4                                                 |
| Every price row references an existing unit code                      | 198, 0, 0, 180 — no orphans                         |
| All price values finite and non-null                                  | 4/4                                                 |
| All unit numerics finite                                              | 4/4                                                 |
| Every warning carries entity, code and message                        | 4/4                                                 |
| `developer_id` and `location_id` null                                 | 4/4                                                 |
| Retired provenance vocabulary absent                                  | 4/4                                                 |

Project-specific:

| Assertion                                                               | Result |
| ----------------------------------------------------------------------- | ------ |
| Rainpalm — 21 units, zero prices                                        | pass   |
| Rainpalm — no unit carries `availability_status`                        | pass   |
| Rainpalm — `multiple_price_list_versions` retained                      | pass   |
| Rainpalm — retired forensic warnings absent                             | pass   |
| Garden of Eden — valid empty structural draft with a project name       | pass   |
| Sierra — exactly 180 unique unit codes and 180 price rows, one per unit | pass   |

### 14.3 Toolchain results, PR-owned versus baseline

Every failure below was reproduced at the merge-base with identical output, so
none is introduced by this PR.

| Check                                 | HEAD                                         | Merge-base                                  | PR-owned?           |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------- | ------------------- |
| Builder normal + `--check`            | pass, tree byte-identical after rebuild      | n/a (builder is new)                        | —                   |
| Canonical validator, 4 payloads       | `DRAFT_PAYLOAD_VALID` ×4                     | n/a                                         | —                   |
| **Production build** (`vite build`)   | **pass**, exit 0                             | n/a                                         | —                   |
| **ESLint** (`eslint .`)               | 1125 problems (1118 errors, 7 warnings)      | **1125 problems (1118 errors, 7 warnings)** | **no — identical**  |
| ESLint on the PR's own script         | **0 problems**                               | n/a                                         | —                   |
| **TypeScript** (`tsc --noEmit`)       | 1 error, exit 2                              | **1 error, exit 2, same file and line**     | **no — reproduced** |
| **Full test suite** (`vitest run`)    | 3380 passed, 3 failed, 6 skipped (357 files) | same 2 files, same 3 tests fail             | **no — reproduced** |
| `git diff --check`                    | clean                                        | —                                           | —                   |
| Public-bundle scan                    | clean                                        | —                                           | —                   |
| Secret / credential scan              | clean                                        | —                                           | —                   |
| Owner absolute-path scan outside docs | clean                                        | —                                           | —                   |

The single TypeScript error is
`src/features/project-detail/partner-demo-data.ts(13,29)` importing
`forever-data/projects/modeva/extracted/price-list.json`. That file is tracked at
neither the merge-base nor this head — it has never been committed — and the
importing line is byte-identical in both revisions. The production build still
succeeds because the bundler strips types without typechecking.

The three failing tests are `src/features/project-detail/partner-demo-data.test.ts`
(same missing asset) and three cases in `src/import/importer-preflight.test.ts`.
All reproduce at the merge-base.

### 14.4 One attributable observation: Prettier drift on generated payloads

Not a functional defect, but stated plainly so it is the Owner's call.

| Scope                                    | Merge-base | Head |  Delta |
| ---------------------------------------- | ---------: | ---: | -----: |
| Files differing from Prettier, repo-wide |        129 |  132 | **+3** |
| …of those, inside `forever-data/`        |          2 |    5 |     +3 |

The three are the payloads this PR writes. `JSON.stringify(value, null, 2)`
breaks short arrays across lines where Prettier would inline them — specifically
the `applies_to` arrays introduced by the trust policy's row-level source
records. Reformatting changes only whitespace: the parsed content is identical
and **every `batch_fingerprint` is unaffected**, because the fingerprint is
computed over a key-sorted canonical serialisation, not over file bytes.

It was left as-is deliberately. The repository does not hold this tree to
Prettier cleanliness — 129 files already differ at the merge-base, two of them
inside `forever-data/` — so no existing invariant is broken. The available fix is
to make the builder format its output through Prettier, which would couple a
currently dependency-free script to `node_modules` and lose its ability to run on
a bare checkout. That is a worse trade than the cosmetic gain on generated data.

### 14.5 Structural checks

| Check                                             | Result                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Files changed by the PR                           | 9 — one `.gitignore`, three docs, four payload JSONs, one builder script     |
| Runtime source (`src/`) changed                   | **none**                                                                     |
| Previously-tracked files dropped                  | **none** — verified across the whole tree                                    |
| Studio tests depending on `rainpalm-villas/sip/*` | still resolve; those files remain tracked                                    |
| `.gitignore` sentinels                            | `intake/`, `sip/` and `source/` sentinels ignored; the four payloads allowed |
| Executable, archive or media files added          | none — only `.json`, `.md`, `.mjs`                                           |

### 14.6 Audit conclusion

No PR-owned defect was found, so no corrective code commit was made. This
section is the one documentation change, and it exists to correct a factual
contradiction — the earlier "ESLint not run" claim — not to record the audit for
its own sake.

The branch is locally ready for the interactive staging import. What remains is
unchanged and unchangeable from here: the import itself, database replay safety
and post-import counts all require the interactive password gate in §13.8.
Staging and production were never contacted during this audit.

> **Outcome.** That import then ran successfully against `forever-staging` on
> 2026-07-26 at this exact head, and the replay refusal and post-import counts
> were all confirmed. See §15.

## 15. Wave 1 controlled staging import — COMPLETED 2026-07-26

**FOREVER CATALOGUE WAVE 1 STAGING PASSED — FOUR UNPUBLISHED DRAFTS VERIFIED —
RAINPALM STRUCTURE LOADED, PRICES DEFERRED — REPLAY SAFETY VERIFIED — PUBLIC
CATALOGUE UNCHANGED — PRODUCTION UNTOUCHED.**

This section supersedes §3 and §13. The import ran in an interactive session
that could answer the masked password prompt — the single thing those earlier
sections identified as missing.

This section was written from a sanitized execution record, not from a database
connection: the session that produced this document ran no database command. The
record's arithmetic and its agreement with the committed payloads were
re-derived independently before anything here was written; §15.7 states exactly
what that verification did and did not establish.

### 15.1 Target and payloads

| Item            | Value                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| Staging project | `forever-staging`, ref `garji…zisu`                                       |
| Host            | `db.garji…zisu.supabase.co`                                               |
| Transport       | TLS `verify-full` with the pinned staging CA                              |
| Production      | **not used** — no production ref appears anywhere in the execution record |
| Repository head | `60e59d2316fec826aa1abe242439907e6089c2d6` — the head audited in §14      |
| Branch          | `claude/forever-catalog-10-001`                                           |
| Run window      | 2026-07-26T05:16:53Z → 05:17:39Z (45 s)                                   |

The head in the execution record is byte-identical to the head §14 audited, so
the payloads that landed are the ones whose digests and fingerprints that audit
recomputed from source.

### 15.2 First attempt aborted before any write

An initial read-only orchestration attempt aborted **before reaching any write**
because an empty JSON list was mishandled locally — the well-known PowerShell
behaviour where an empty array deserialises to `$null` rather than an empty
collection. **No database row changed in that attempt.** It is recorded here
because a clean run preceded by an aborted one should never be reported as a
single uneventful success.

The successful run then started from a state with **no Wave 1 slug present**.

### 15.3 Baseline

Recorded staging-only, immediately before the first import.

| Table              | Baseline |
| ------------------ | -------: |
| projects           |       60 |
| buildings          |        7 |
| units              |      290 |
| prices             |      290 |
| ingestion_batches  |      106 |
| ingestion_warnings |        8 |

The pre-import duplicate check for `coralina`, `rainpalm-villas`,
`garden-of-eden` and `the-title-sierra` returned **an empty set**. This is what
resolves §4: Coralina was **absent from staging before the import**, confirming
the repository-evidence classification and confirming that
`docs/CURRENT_STAGE.md`'s "already imported" claim was wrong.

### 15.4 Per-project outcome — expected versus actual

Each project was imported one at a time through the controlled importer, in the
order Coralina → Rainpalm → Garden of Eden → Sierra.

| Project            | Status | Buildings | Units | Prices | Warnings | Batches | Expected? |
| ------------------ | ------ | --------: | ----: | -----: | -------: | ------: | --------- |
| `coralina`         | draft  |         8 |   198 |    198 |        6 |       1 | matches   |
| `rainpalm-villas`  | draft  |         0 |    21 |  **0** |        7 |       1 | matches   |
| `garden-of-eden`   | draft  |         0 |     0 |      0 |       13 |       1 | matches   |
| `the-title-sierra` | draft  |         2 |   180 |    180 |       14 |       1 | matches   |

Every row equals the expected draft result **and** the committed payload's own
counts. Each project reports `public_status = draft` and exactly one ingestion
batch. No Wave 1 slug is duplicated.

Ingestion batch fingerprints, as stored in staging:

| Project            | `batch_fingerprint`                                                | Matches committed payload |
| ------------------ | ------------------------------------------------------------------ | ------------------------- |
| `coralina`         | `9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c` | yes                       |
| `rainpalm-villas`  | `8f84fbecbf31daf2648f879181b3cc4302e1eab7a33530d6e194b09b2ff21a4e` | yes                       |
| `garden-of-eden`   | `de458b059155e971d6bdbe99c521e0009a15ca552d901d12ea02c054fceefbca` | yes                       |
| `the-title-sierra` | `4a3e9c17fb826a8f42ae32f17cac9a30f92a00a19efdf5b0e2872fb12d625b29` | yes                       |

All four fingerprints are identical to the values in the committed payloads at
this head, so what is in staging is provably what is in the pull request.

### 15.5 Replay safety — verified

The exact Coralina import command was repeated once. The importer **refused**
with `draft_import_duplicate_slug` and wrote nothing; total counts were
unchanged afterwards.

This is the stronger of the two acceptable behaviours: the duplicate-slug
preflight fires inside the transaction before the ingestion RPC is reached, so a
second identical import cannot create a second project row, duplicate buildings,
duplicate units, duplicate prices, or a second effective ingestion.

### 15.6 Final counts and exact deltas

| Table              | Baseline | Final |    Delta |
| ------------------ | -------: | ----: | -------: |
| projects           |       60 |    64 |   **+4** |
| buildings          |        7 |    17 |  **+10** |
| units              |      290 |   689 | **+399** |
| prices             |      290 |   668 | **+378** |
| ingestion_batches  |      106 |   110 |   **+4** |
| ingestion_warnings |        8 |    48 |  **+40** |

### 15.7 Independent verification of the execution record

The record was not taken on trust. Every figure above was re-derived before this
section was written.

| Check                                              | Result                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Deltas equal `final − baseline`                    | 6/6 exact                                                                                                                      |
| Deltas equal the **sum of the four imports**       | 6/6 exact — 4 projects, 8+0+0+2=10 buildings, 198+21+0+180=399 units, 198+0+0+180=378 prices, 4 batches, 6+7+13+14=40 warnings |
| Stored fingerprints vs committed payloads          | 4/4 identical                                                                                                                  |
| Stored counts vs committed payload counts          | 4/4 identical                                                                                                                  |
| `IMPORTED AS DRAFT` marker vs post-import snapshot | 4/4 agree                                                                                                                      |
| Final-state snapshot vs imported-state snapshot    | 4/4 agree, all still `draft`                                                                                                   |
| Exactly one ingestion batch per project            | 4/4                                                                                                                            |
| Wave 1 slug duplication                            | none                                                                                                                           |
| Production ref present anywhere in the record      | none                                                                                                                           |
| Execution head vs audited head                     | identical                                                                                                                      |

The second row is the load-bearing one. Because the six deltas are **exactly**
the sum of the four imports, nothing outside Wave 1 changed: no unrelated
project gained or lost a building, unit, price, batch or warning. That is a
stronger statement than "the totals moved by the right amount", and it is what
justifies the claim that no unrelated project was touched.

**What this verification does not establish.** It confirms internal consistency
and agreement with the repository; it is not a fresh query against staging. The
session writing this report ran no database command. A future reader wanting
live confirmation should re-run the read-only checks in §9.

### 15.8 Safety confirmations

| Confirmation                                        | State                                                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| All four projects unpublished                       | `public_status = draft` on all four                                                                                                           |
| Public catalogue output                             | **unchanged** — the public RLS policies require `public_status = 'published'`, so a draft is structurally invisible to anonymous readers (§8) |
| Production contacted                                | **never** — no production ref, host or credential appears in the execution record                                                             |
| Migrations applied                                  | none                                                                                                                                          |
| Booth tables, Booth migrations, Cloudflare, PR #102 | untouched                                                                                                                                     |
| Drafts retained                                     | yes — these are real staging catalogue data and were **not** deleted after the run                                                            |
| Credentials                                         | the password was entered by the Owner at the masked prompt; it is not printed, saved, logged or committed anywhere                            |

### 15.9 Still open: the Rainpalm price-selection decision

Unchanged by the import, and not a blocker.

Rainpalm is loaded with **21 units and zero prices**, and no availability was
activated. The package holds four price-list versions, so no current schedule
can be selected. The soft `multiple_price_list_versions` warning is stored in
staging alongside the draft and names the activation condition: the Owner
selects the current version from the four already in the package, or supplies a
newer developer price list. Availability is deferred with prices because it
moves with the price list.

Nothing was averaged, merged or chosen by filename, and the structural layer is
accepted rather than provisional.

### 15.10 What this does and does not authorise

Wave 1 staging is complete. This authorises nothing further on its own:

- no project is published, and publication remains a separate Owner decision;
- Internal Use Only price data — Coralina's and Sierra's — must not become
  anonymously public without written developer permission;
- production remains untouched and out of scope;
- Waves 2 and 3 are unstarted and reuse the §9 runbook.
