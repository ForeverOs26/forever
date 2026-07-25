# Forever Catalogue 10 — Wave 1 staging report

Task: `FOREVER-CATALOG-10-002`
Branch: `claude/forever-catalog-10-001`
Worktree: `C:\forever-worktrees\catalog-10`
Base SHA: `a9d275fc678065ef70b331aee20f24f1c4f030e6`
Planning commit continued from: `72454e3`

## Verdict

**FOREVER CATALOGUE WAVE 1 STAGING BLOCKED**
**— FOUR SOURCE-BACKED DRAFTS PREPARED AND VALIDATED**
**— NO STAGING DATABASE CREDENTIAL EXISTS IN THIS ENVIRONMENT**
**— RAINPALM PRICES DEFERRED**
**— PRODUCTION UNTOUCHED**

None of the three verdicts offered by the task brief applies, and adopting one
would misdescribe what happened. Nothing was loaded, so "STAGING PASSED" is
false. Coralina was not found to already exist, so "CORALINA REUSED" is false.
No individual project is source-blocked, so "WAVE 1 PARTIAL" is false — all four
packages are complete and validated. The single blocker sits between the
prepared work and the database, and it affects all four projects equally.

## 1. Exact base and branch

| Item | Value |
| --- | --- |
| Branch | `claude/forever-catalog-10-001` |
| Base SHA | `a9d275fc678065ef70b331aee20f24f1c4f030e6` (`origin/main`, merge commit of PR #100) |
| Continued from | `72454e3` — planning-only commit, unpushed at task start |
| Worktree | `C:\forever-worktrees\catalog-10`; `C:\forever` was read but never modified |

## 2. Staging target verification

The task requires the authorized staging project to be identified explicitly and
never inferred from the locally linked project. Both were enumerated read-only
through the authenticated Supabase CLI project inventory.

| Role | Ref (sanitized) | Name | Region | Linked locally |
| --- | --- | --- | --- | --- |
| **Authorized staging** | `garji…zisu` | `forever-staging` | `ap-southeast-2` | **no** |
| Production — forbidden | `abtvs…jeed` | `ForeverOs26's Project` | `ap-northeast-1` | **yes** |

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

## 3. The blocker — no staging database credential

Baseline counts, the Coralina state query, and every import in this task require
authenticated access to the staging Postgres database. That access does not
exist in this environment.

| Channel | State |
| --- | --- |
| `scripts/import/Import-ForeverProjectDraft.ps1` | Requires `-HostName`, `-SslRootCert` and a password. Line 153 prompts interactively (`Read-Host -AsSecureString`). This session is non-interactive. |
| `FOREVER_IMPORT_HOST/PORT/DATABASE/USER/SSLROOTCERT` | Absent from the process, User and Machine environments. |
| `.env` | Only one exists, at `C:\forever\.env`. It holds a **production** URL and a publishable (anon) key. No staging URL, no staging key, no service-role key. |
| `supabase migration list` / `db` commands | Both `--db-url` and `--password` are declared required. There is no access-token-only read path. |
| `SUPABASE_ACCESS_TOKEN` | Not set. The CLI's token lives in the Windows Credential Manager and is reachable only by the CLI itself; extracting it to run ad-hoc SQL would mean handling a secret in plaintext and is not something this task will do. |

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

**Consequently: baseline counts were not recorded, no project was loaded, no
acceptance check was run against a live database, and no final staging counts
exist.** Everything in this report that concerns database state is labelled as
not performed. Nothing is asserted that was not observed.

## 4. Coralina actual-state resolution

The brief asks which of the contradictory documents is right. The contradiction
was resolved from repository evidence; it could not be closed by query.

| Document | Claim |
| --- | --- |
| `docs/CURRENT_STAGE.md` (canonical, 2026-07-23) | "Coralina imported as an unpublished draft: 1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch" |
| `RC5_6_CONTROLLED_IMPORT_REPORT_FINAL.md` (2026-07-18 01:34) | Coralina absent; 0 of 405 expected writes; V15 rolled back |

Four later reports, all from 2026-07-18 and all newer than RC5.6, settle it:

| Report | Time | Outcome |
| --- | --- | --- |
| `CORALINA_PROGRESSIVE_DRAFT_IMPORT_REPORT_FINAL.md` | 19:27 | not imported |
| `CORALINA_TEMP_PAYLOAD_ROLE_BOUNDARY_REPAIR_REPORT_FINAL.md` | 19:55 | repair only |
| `CORALINA_PROGRESSIVE_DRAFT_IMPORT_REPORT_FINAL_V2.md` | 20:16 | stopped fail-closed at TLS attestation; "The committed Coralina import was not attempted." |
| `CORALINA_SIMPLE_DRAFT_IMPORT_REPORT_FINAL.md` | 20:31 | "IMPORT FAILED AND ROLLED BACK … no database connection was made"; counts all zero |

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
- This classification is **evidence-backed but not query-verified**, and it must
  be treated as such. The read-only confirmation the brief asked for is exactly
  what the missing credential prevented. Before any Coralina load, run the
  duplicate check in §9 — the importer performs it in-transaction anyway and
  fails closed on `draft_import_duplicate_slug`.

Because Coralina is classified absent rather than partial, no idempotent update
variant was prepared. The existing canonical package is a clean `create`.

## 5. What was prepared

Four complete, validated, staging-ready draft packages. All four are
unpublished by construction, deterministic, and free of invented values.

| Project | Slug | Buildings | Units | Prices | Media | Docs | Warnings |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| The Title Coralina Kamala | `coralina` | 8 | 198 | 198 | 0 | 0 | 6 |
| Rainpalm Villas | `rainpalm-villas` | 0 | 21 | **0** | 0 | 0 | 10 |
| Garden of Eden (Park Residence) | `garden-of-eden` | 0 | 0 | 0 | 0 | 0 | 13 |
| The Title Sierra | `the-title-sierra` | 2 | 180 | 180 | 0 | 0 | 14 |

Payload digests and idempotency keys:

| Slug | `payload.json` SHA-256 | `batch_fingerprint` |
| --- | --- | --- |
| `coralina` | `2d5613a35705b251f20208aa4273038c2d8001bebe5d2c5bab5e55cb653e6605` | `9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c` |
| `rainpalm-villas` | `793d6d705c42092813878bc6fd39a0ce6d9230389e2a9e1b45f81ed0e7c4bf12` | `5174d429c1893bd715df4756d59cff2c14dbfa5737ce5f923d9f3444a5e82a31` |
| `garden-of-eden` | `49f4c999591f0d244a9c8817a76de33171b2ddda38dcbbf30e0e2a5e7493e18d` | `f85ca779274234a3a55356dacc876eb44ba69cc3b5dc69116d783f30b289d63b` |
| `the-title-sierra` | `317755bc5656633bf7f4f00bbd4e6b0959a438de92672bd206fe740b0c990706` | `f38928f22470cc5e00ec736aa0c3396561979be4adf6487f150a0c40e0fd59e1` |

All four pass the canonical offline validator:

```text
DRAFT_PAYLOAD_VALID|slug=coralina|sha256=2d5613a3…|buildings=8|units=198|prices=198|media=0|documents=0|warnings=6
DRAFT_PAYLOAD_VALID|slug=rainpalm-villas|sha256=793d6d70…|buildings=0|units=21|prices=0|media=0|documents=0|warnings=10
DRAFT_PAYLOAD_VALID|slug=garden-of-eden|sha256=49f4c999…|buildings=0|units=0|prices=0|media=0|documents=0|warnings=13
DRAFT_PAYLOAD_VALID|slug=the-title-sierra|sha256=317755bc…|buildings=2|units=180|prices=180|media=0|documents=0|warnings=14
```

### 5.1 Coralina — local canonical payload reused unchanged; staging presence query-unverified

"Reused" here means exactly one thing: the **local canonical payload** at
`forever-data/projects/coralina/progressive/payload.json` was re-validated and
carried forward unchanged. It does **not** mean an existing Coralina record was
found in staging and adopted. **No staging row was read, matched, or reused,
because no staging query was possible.** Whether Coralina exists in
`forever-staging` remains **query-unverified**; §4 classifies it as absent on
repository evidence alone, and that classification must be confirmed by the
duplicate check in §9 before this package is loaded.

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

| Document | SHA-256 | Bytes |
| --- | --- | --- |
| `CLK - Price List V.2. - Updated 17.07.26.pdf` | `268c2fa30e39e89c7dd5e3d7751326e3cf958ec2783e5953eabccbece9b3f3c0` | 251,902 |
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

### 5.2 Rainpalm Villas — structural draft, prices deferred

Built exactly to §4. The verified structural layer is present; the price layer
is absent by decision, not by omission.

- Identity retained verbatim from the validated Fast Intake v1 package:
  `Rainpalm Villas`, developer raw `Tonsai Company`, `Bang Tao, Phuket`,
  `Pool Villa`, all attributed to `For PDF Presentation.pdf` with page refs.
- All 21 units with identifier, type, bedrooms, bathrooms and size.
- **0 prices.** The 14-price payload was not carried over.
- The original package is retained unchanged as
  `forever-data/projects/rainpalm-villas/progressive/payload.fast-intake-v1.json`
  (SHA-256 `c95fb84744d9c067a003284be3fd8de5a2a84a2f9cf03a36b2c78b72d283a9b7`),
  so the previous evidence is preserved and the rebuild has a stable input.

`authoritative_price_list_unresolved` is recorded as required, carrying all four
conflicting documents with their real digests and byte lengths:

| Document | SHA-256 | Bytes | Extractable prices |
| --- | --- | --- | ---: |
| `Rainpalm - Price List（for In house).pdf` | `08b4ceb9a71c7dc292cbfec6bf5d34c419687e6097c2d75e25b865ed0a459faf` | 77,942 | 14 |
| `Rainpalm - Price List（for In house) update 04.2025.pdf` | `4ddee05fe5063bd8548ca8d2833c20bb4ca9b6b81a23aee8f21b065e1b5260b6` | 77,091 | 9 |
| `Rainpalm - Price List（for In house) update 4_12_2025.pdf` | `ac1c213b547d00d5c620cf152a0855c350cb4e193d302ac370ede971f8ae9535` | 78,944 | 21 |
| `Rainpalm - Price List new.pdf` | `772c02f01d030a56dd03512298bb881ccf3d0b7764bd665877a4f6a9ddaf4441` | 78,261 | 14 |

None of them states an issue date inside the document. Nothing was averaged,
merged, or selected by filename.

Two further warnings were added rather than glossed over:

- `cited_source_file_absent` — every unit and price row in the previous package
  cited `Копия Rainpalm - Price List（for In house)-1.pdf`. A fresh search across
  every inspected source root confirms no such file exists.
- `availability_unverified` plus a unit-level `availability_conflict` for D4.
  Availability was deliberately **not** imported: every availability value in
  the source package derives from the disputed price documents, and D4 is
  Available in the package but Reserved in the one document with a qualified
  extraction chain. All 21 units will carry the schema default, and that default
  must not be read as a verified availability state.

The seven `price_missing` warnings from the original package were dropped. They
each said a named unit had no price "so the price row was omitted", which in a
zero-price draft would falsely imply the other fourteen units do have prices.

Media and documents are 0. Media rows require a hosted URL and no Storage upload
was performed; `media_not_ingested` records the dossier contents, including that
the 598 MB video exceeds the 300 MiB intake limit.

**RAINPALM STRUCTURAL DRAFT READY — PRICE UPDATE REQUIRED.**

### 5.3 Garden of Eden (Park Residence) — highest honest draft

The source is two January 2026 decks. Everything the deck states is recorded;
everything it does not state is absent and warning-marked.

| Item | Source-stated value |
| --- | --- |
| Official name | `GARDEN OF EDEN (PARK RESIDENCE)` — singular, as the source has it |
| Property type | `PREMIUM APART-HOTEL` |
| Location | `Layan`; 300 m to beach |
| Completion | `Q4-2027` |
| Buildings | 6 |
| Total area | over 122,000 sqm |
| Source date | `January 2026`, stated on the title page |

Notable decisions:

- **Developer is not merely unresolved — it is unstated.** Both decks are agency
  investment presentations produced by Sunthai Property, not developer material.
  No raw developer name was preserved, because there is none to preserve.
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

| Gate | Result |
| --- | --- |
| Rows parsed / unresolved | 180 / **0** |
| Unique room numbers | 180 of 180 |
| Tower letter agrees with room-number prefix | 180 of 180 |
| Floor agrees with room-number encoding | 180 of 180 |
| Price/sqm × area agrees with selling price (±0.5%) | 180 of 180 |
| Non-integer selling prices | 0 |

Verified content:

| Item | Value |
| --- | --- |
| Official name | `THE TITLE SIERRA` (internal code `SIB`) |
| Buildings | Towers `A` and `C`, taken from the Tower column |
| Units | 180 — 128 in Tower A, 52 in Tower C; floors 3–8 |
| Bedrooms | 157 one-bedroom, 23 two-bedroom, read from the stated Room Type |
| Areas | 28.40 – 58.10 sqm |
| Prices | 180, THB 3,145,400 – 7,713,800 |
| Price-list date | `2026-05-15`, from the in-document header `Updated : 15.05.26` |
| Availability | all 180 stated `Available`; no conflicts |

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
- Building rows carry no floor or unit counts. A price list enumerates offered
  units, not a building's inventory, so deriving counts from it would overstate.

**Internal Use Only handling.** Every page is stamped `(Internal Use Only)`.
`internal_use_only_source` records that the data may be held in this internal
draft, that unit-level prices and the document itself must not become
anonymously public, and that no publication permission is implied. §8 explains
why the draft state enforces this structurally.

## 6. Warnings summary

| Project | Warnings |
| --- | --- |
| `coralina` | `developer_unresolved`, `location_unresolved`, `coordinates_missing`, `construction_status_missing`, `media_processing_deferred`, `document_processing_deferred` |
| `rainpalm-villas` | `country_missing`, `coordinates_missing`, `construction_status_missing`, `developer_unresolved`, `location_unresolved`, **`authoritative_price_list_unresolved`**, `cited_source_file_absent`, `availability_unverified`, `availability_conflict`, `media_not_ingested` |
| `garden-of-eden` | `developer_unresolved`, `location_unresolved`, `country_missing`, `coordinates_missing`, `construction_status_missing`, `completion_quarter_only`, `building_inventory_missing`, `unit_types_missing`, `price_list_missing`, `investment_projections_not_prices`, `stated_facts_not_modelled`, `media_not_ingested`, `source_date_recorded` |
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

Source identity is pinned. Each source document is resolved by filename against
`FOREVER_WAVE1_SOURCE_ROOTS` and then verified by SHA-256; a substituted or
edited source fails closed instead of silently producing a different draft.

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

| Guarantee | Mechanism |
| --- | --- |
| Drafts are never public | `public.projects` public SELECT policy is `is_active = true AND public_status = 'published'`. The RPC's create path hard-codes `'draft'` and cannot publish. |
| Draft units, prices and media are never public | Every project-scoped child table — `units`, `buildings`, `unit_price_history`, `project_media`, `documents`, `images`, `videos` — requires a published, active parent. |
| Warnings and batches are never public | `ingestion_warnings` and `ingestion_batches` have RLS enabled and **no public policy at all**. |
| Never born verified | The RPC hard-codes `forever_verified = false` on create. |
| No automatic media publication | All four payloads carry `media: 0` and `documents: 0`. No asset was uploaded and no Storage object was created or made public. |

So Sierra's Internal Use Only unit prices are structurally unreachable
anonymously for as long as the project stays `draft`. **Public catalogue absence
was not confirmed by query** — that requires the missing credential — but the
policy chain makes a draft's public visibility impossible by construction rather
than by convention.

Nothing was published. No `publish` flag is `true` in any payload.

## 9. Runbook — what the Owner runs to complete Wave 1

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

| Check | Result |
| --- | --- |
| Production database connection | **None.** No psql, no client, no query. |
| Production credential used | **None.** The production anon key in `C:\forever\.env` was never read into any command. |
| Production migration applied | None. |
| Production write | None. |
| Locally linked project | Remains production, unlinked and unused; `supabase/config.toml` unmodified. |
| Supabase CLI use | One read-only `projects list` for identity comparison. |
| Publication | None. No public catalogue output changed. |
| Owner source files | Read-only throughout. No create, delete, rename, move or edit. |
| Private zones | Not entered. No client, contract, financial or personal file referenced. |
| Committed secrets | None. No credential, no connection string, no Owner absolute path, no Internal Use Only document. |

## 11. What the Owner must supply

Blocking Wave 1 entirely:

1. **Staging database access** — an interactive session where the password
   prompt can be answered, or the four `FOREVER_IMPORT_*` settings plus a way to
   supply the password that does not require an agent to handle it.

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
