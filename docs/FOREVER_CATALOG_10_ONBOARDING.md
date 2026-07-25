# Forever Catalogue 10 — onboarding register

Task: `FOREVER-CATALOG-10-001`
Branch: `claude/forever-catalog-10-001`
Worktree: `C:\forever-worktrees\catalog-10`
Base SHA: `a9d275fc678065ef70b331aee20f24f1c4f030e6` (`origin/main`, merge commit of PR #100)

Scope of this document: read-only source assessment and draft planning. No
project was imported, no project was published, no production endpoint was
contacted, and no Owner source file was created, deleted, renamed, moved,
normalised or edited.

## 1. Correction to the assumed starting state

The task brief assumes the Forever Database already holds two records, Modeva
and Coralina. Repository evidence does not support that for Coralina.

| Record | Assumed | Evidence-backed state |
| --- | --- | --- |
| Modeva | in database | **Confirmed present.** Seeded by `supabase/migrations/20260707103000_fdb001_seed_title_bang_tao_modeva.sql`, project status `'published'`. |
| Coralina | unpublished draft in database | **Not present.** `RC5_6_CONTROLLED_IMPORT_REPORT_FINAL.md` §14: Coralina is not present in the Forever Database; none of the 405 expected writes exists; V15 failed safely and rolled back. |

`RC5_6P_CORALINA_PREREQUISITE_IMPORT_REPORT_FINAL.md` §11 further records that
both Coralina prerequisites are absent — the required developer row (fresh exact
count `0`) and the `kamala` location (fresh exact count `0`).

Consequence: reaching ten records means preparing **nine** project drafts, not
eight, and Coralina's blocked prerequisite chain is on the critical path rather
than already satisfied. This is tracked as Wave 0 in the roadmap.

This conclusion is drawn purely from committed and untracked repository reports.
Production was not queried to confirm it, because this task forbids production
access. The Owner should treat "Coralina absent" as evidence-backed but
production-unverified.

## 2. Source roots inspected

All inspection was read-only.

| Root | Nature | Outcome |
| --- | --- | --- |
| `C:\forever\forever-data\projects\` | tracked | `coralina`, `modeva`, `rainpalm-villas` |
| `C:\forever\forever-data\incoming\` | tracked | `Coralina`, `Modeva` archives |
| `C:\forever-incoming\` | untracked intake root | `Coralina\updates\2026-07-17`, `Rainpalm\{facts,price-list,raw}`, `TelegramExports\coralinakamala` |
| `C:\Users\konst\Downloads\Rainpalm\` | Owner source | 111 files, 908 MB — full Rainpalm dossier |
| `C:\Users\konst\Downloads\Telegram Desktop\` | Owner source | developer decks and price lists for several projects |
| `C:\Users\konst\Documents\Forever\Investment presentation\` | Owner source | three Layan-area decks, English + Russian |
| `C:\Users\konst\Documents\Title\` | Owner source | `Carolina` (Coralina duplicates), `Legendary`, `The Balcony` |
| `C:\Users\konst\Documents\Forever\Иследование\Rainpalm\` | Owner source | Rainpalm price-list variants and presentation |
| `C:\Users\konst\Documents\проекты\` | Owner source | 2023-era material, unrelated projects, stale |
| `C:\Projects Phuket\` | Owner source | **exists but contains 0 items** |

### 2.1 Excluded private zones

Inspected at directory level only to establish boundaries. Nothing from these
paths is referenced by, or eligible for, any intake package.

- `C:\Users\konst\Documents\Forever\` (root) — passport scans, bank book, DBD
  registration, ID scans, invoices.
- `C:\Users\konst\Documents\Forever\green international\` — invoices, receipts,
  a commercial lease agreement.
- Client and contract documents: `Agreement Rainpalm - Land lease A8.pdf`,
  `Quotation Rainpalm A7.pdf`, `…Draft Lease Agreement - Pawan Property.pdf`,
  `KATABELLO-KKA701-RECEIPT-CONTRACT…pdf`.
- `C:\Users\konst\Documents\{Договоры,Бангкок госпиталь,Стanislav,Евгении Жанна,Константин Виктория The City}` — personal/client folders.
- `C:\Users\konst\Downloads\Photos Adelya google` — personal photographs.

### 2.2 Foreign binary inside a source folder

`C:\forever-incoming\Rainpalm\price-list\tsetup-x64.7.0.2.exe` is a 54 MB
Telegram Desktop installer sitting inside a declared intake source directory. It
is unrelated to the project. It was left untouched. Any future intake invocation
that names `…\Rainpalm\price-list` as a source root must exclude it explicitly;
the 2026-07-19 pilot avoided it only because the CLI classified by extension.

## 3. Cross-cutting publication constraint — Internal Use Only

Every developer price list located during this inventory carries an explicit
internal-distribution marking on page 1:

| Price list | Page-1 marking |
| --- | --- |
| `CORALINA Price List` 03.07.26 and 17.07.26 | `(Internal Use Only)` |
| `THE MODEVA Price list` 03.07.26 | `(Internal Use Only)` |
| `THE TITLE SIERRA Price List` 15.05.26 | `(Internal Use Only)` |
| `CASA DE MONTE VILLA Price List` 28.02.26 | `(Internal Use Only)` |
| `Rainpalm - Price List` (all variants) | `(for In house)` in the filename |

This does not block draft creation — drafts are unpublished. It does mean that
**no unit-level price from any of these documents may be published** without
written developer permission. This applies to Modeva and Coralina as much as to
the new candidates, and is recorded as a publication prerequisite in the
roadmap.

## 4. Provisional list versus available source

The brief permits replacing positions 4–10 when another commercially important
project has materially better and fresher source evidence. Positions 1–3 are
locked and were not touched.

| Provisional entry | Local source found | Disposition |
| --- | --- | --- |
| 1. Modeva Bang Tao | yes — full package | retained |
| 2. The Title Coralina Kamala | yes — 343 source files | retained |
| 3. Rainpalm Villas Bangtao | yes — full dossier | retained |
| 4. Gardens of Eden | yes, as **Garden of Eden (Park Residence)** | retained, name corrected |
| 5. Botanica Four Seasons — Spring I | **none** | not_selected |
| 6. Origin Residence Bangtao | **none** | not_selected |
| 7. Above Patong | **none** | not_selected |
| 8. Vibe Residence Karon | **none** | not_selected |
| 9. La Green Hotel & Residence Layan | **none** under that name | not_selected — see §6.11 |
| 10. MontAzure | **none** | not_selected |
| 10alt. The Title Legendary | video archive only | not_selected — see §6.12 |

Searches were performed by name across `C:\forever`, `C:\forever-incoming`,
`Downloads`, `Documents` and `Desktop`. Positions 5–8 and 10 returned zero
matches of any kind. Five replacements were therefore selected from projects
that do have current, source-backed material.

## 5. Final catalogue of ten

| # | Project | Slug | Type | Location (source-backed) | Depth | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Modeva | `modeva` | Condominium | Bang Tao | deep | `already_in_database` |
| 2 | The Title Coralina Kamala | `coralina` | Residential condo | Kamala | deep | `missing_critical_source` (prerequisites) |
| 3 | Rainpalm Villas | `rainpalm-villas` | Pool Villa | Bang Tao | deep | `duplicate_or_identity_review` |
| 4 | Garden of Eden (Park Residence) | `garden-of-eden` | Apart-hotel | Layan | passport_light | `ready_with_warnings` |
| 5 | The Title Sierra | `the-title-sierra` | Condominium | *not source-backed* | passport_light | `ready_with_warnings` |
| 6 | Layan Green Park | `layan-green-park` | Condominium / apart-hotel | Layan | passport_light | `ready_with_warnings` |
| 7 | AYANA Heights Seaview Residence | `ayana-heights-seaview-residence` | Apart-hotel | Layan | passport_light | `ready_with_warnings` |
| 8 | Casa de Monte Villa | `casa-de-monte-villa` | Villa | *not source-backed* | passport_light | `ready_with_warnings` |
| 9 | The Title Olive | `the-title-olive` | Premium complex | Nai Yang | passport_light | `ready_with_warnings` |
| 10 | Sudara Phuket | `sudara-phuket` | Condominium | Bang Tao | passport_light | `ready_with_warnings` |

Reserve bench, not selected: The Liberty by Wallaya Villas (Cherngtalay,
developer deck present), The Balcony (Title brochure + company profile),
The Ploenjitta Villas (image-only PDF, needs OCR), The Title Legendary
(video only).

Diversity check: condominium 4, apart-hotel 3, villa 2, residential condo 1.
Locations Bang Tao 3, Layan 3, Kamala 1, Nai Yang 1, unresolved 2.

## 6. Per-project register

Source freshness below is taken from statements **inside** each document. File
system timestamps are recorded separately and are never treated as freshness.

### 6.1 Modeva — `modeva`

- Developer/brand: Title (`developers.slug = 'title'`, seeded).
- Location: Bang Tao, Phuket. Type: Condominium.
- Existing database status: **present and published**.
- Source files: `forever-data/projects/modeva/source/**`, plus
  `forever-data/incoming/Modeva/` archives, brochure PDF, two lifestyle videos.
- Source freshness: price list states `Updated : 03.07.26` → 2026-07-03.
- Price list: yes. Brochure: yes. Plans: yes (floor/unit). Media: yes.
- Developer identity confidence: high. Project identity confidence: high.
- Expected depth: deep.
- Disposition: `already_in_database`.
- Gaps: the seeded row carries placeholder commercials. `starting_price_thb` and
  `last_price_update` are `NULL`; `price_range`, `beds_display`, `area_range`,
  `verified_price`, `start_date_display`, `completion_date_display` and
  `last_inspection` are empty strings; `trust_score` and `investment_value` are
  `0`; `market_position` and `rental_demand` read `'Under review'` and `verdict`
  reads `'Under Review'`. `construction_status` is the seeded literal
  `'Planning'`, not a source-verified state. The record is therefore materially
  staler than its own available source.
- Recommended next action: do not overwrite or re-import. Schedule a separate,
  separately-authorised freshness/update task that fills the commercial fields
  from the 2026-07-03 price list. Note this record is already published, so any
  such update is a live-content change and needs its own Owner gate.

### 6.2 The Title Coralina Kamala — `coralina`

- Developer/brand: Rhom Bho Property Public Company Limited (source-verified via
  SEC filing, recorded in `import-status.json`).
- Location: Kamala, Phuket. Type: Residential condominium.
- Existing database status: **absent**. Import attempted and rolled back.
- Source files: 343 files across brochure (4), price-list (2), masterplan (10),
  unit-plans (198), images (116), videos (3), documents (10); six extracted
  datasets; progressive payload present.
- Source freshness: ingested price list states `Updated : 03.07.26`.
  **A fresher list exists and is not ingested**:
  `C:\forever-incoming\Coralina\updates\2026-07-17\price-list\CLK - Price List V.2. - Updated 17.07.26.pdf`
  and the matching master-plan price list, both stating `17.07.26`.
- Price list: yes. Brochure: yes (EN/RU/CN/AR). Plans: yes. Media: yes.
- Developer identity confidence: high. Project identity confidence: high.
- Expected depth: deep.
- Disposition: `missing_critical_source` — not for lack of project material,
  which is the strongest in the catalogue, but because two **database
  prerequisites** are absent: the canonical developer row and the `kamala`
  location row.
- Known remaining gaps: `coordinates_missing`, `construction_status_missing`.
- Recommended next action: preserve unpublished; do not re-import under the
  existing V14/V15 packages. Resolve prerequisites first (Wave 0), then
  regenerate a fresh package that also ingests the 17.07.26 price list.

### 6.3 Rainpalm Villas — `rainpalm-villas`

Full assessment in §7. Summary: identity, inventory and geometry are sound;
the price layer has an unresolved provenance conflict.

- Developer/brand: `Tonsai Company` (raw, unresolved to a canonical row).
- Location: Bang Tao, Phuket. Type: Pool Villa.
- Existing database status: absent; local payload only.
- Source freshness: **conflicting** — four price documents, see §7.2.
- Price list: yes but disputed. Brochure: yes (`For PDF Presentation.pdf`).
  Plans: master plan JPG available, not ingested. Media: available, not ingested.
- Developer identity confidence: medium (raw string only, no registry evidence).
- Project identity confidence: high.
- Expected depth: deep.
- Disposition: `duplicate_or_identity_review`.
- Recommended next action: Owner must nominate the authoritative price list
  before staging. See §7.4.

### 6.4 Garden of Eden (Park Residence) — `garden-of-eden`

- Official name in source: `GARDEN OF EDEN (PARK RESIDENCE)`. The provisional
  list said "Gardens of Eden"; the source says singular, with a parenthetical
  second name. Use the source form.
- Developer/brand: **not stated** in the available deck.
- Location: Layan (stated). Distance to beach 300 m (stated).
- Type: Premium apart-hotel.
- Construction/readiness: Completion `Q4-2027` (stated). Buildings: 6 (stated).
  Total area over 122,000 sqm (stated).
- Source files: `Investment presentation\GARDEN OF EDEN - eng.pdf`
  (`9c4a2abeddf4d1b6…`, 11,156,967 B) and `GARDEN OF EDEN.pdf`
  (`ac5cfa99a55867d8…`, 6,885,501 B, Russian).
- Source freshness: deck states `January 2026` on page 1 → 2026-01.
- Price list: **no**. The deck contains a five-year investment model with
  illustrative entry/exit figures. Those are projections, not a price list, and
  must not be ingested as prices.
- Brochure: yes. Plans: no. Media: embedded in deck only.
- Developer identity confidence: **none**. Project identity confidence: high.
- Expected depth: passport_light.
- Disposition: `ready_with_warnings`.
- Exact missing materials: developer legal identity; unit-type schedule;
  source-backed price list or price range; standalone media; coordinates.
- Recommended next action: create Passport Light draft with
  `developer_unresolved`, `price_list_missing`, `unit_types_missing`,
  `coordinates_missing` warnings. Request the developer price list.

### 6.5 The Title Sierra — `the-title-sierra`

- Official name in source: `THE TITLE SIERRA`. Internal code `SIB`.
- Developer/brand: The Title family by naming convention. **Not asserted** — the
  price list does not name a legal entity, and inferring Rhom Bho from the brand
  prefix would be invention.
- Location: **not source-backed locally**. The master-plan PDF is image-only and
  yields no text.
- Type: Condominium (tower/floor/room structure with 1–2 bedroom types).
- Construction/readiness: not stated in available source.
- Source files: `SIB - Price List V.1. - Updated 15.05.2026.pdf`
  (`8e743d1fb6ba8ea1…`, 248,412 B); `SIB - Master Plan Price list V.1 - updated 15.05.26.pdf`
  (`582c41e3642ae475…`, 1,786,548 B, image-only).
- Source freshness: price list states `Updated : 15.05.26` → 2026-05-15. This is
  the **freshest unit-level price data of any new candidate**.
- Price list: yes, unit-level, with tower, floor, status, room number, type,
  area sqm, price/sqm and selling price. Brochure: no. Plans: image-only master
  plan. Media: no.
- Developer identity confidence: low. Project identity confidence: high.
- Expected depth: passport_light.
- Disposition: `ready_with_warnings`.
- Exact missing materials: location; developer legal identity; construction
  status; brochure; text-extractable or OCR'd master plan.
- Recommended next action: qualify the price list through the SIP pipeline
  (`pdftotext` table mode) exactly as Rainpalm was; create Passport Light draft
  with `location_missing`, `developer_unresolved`, `construction_status_missing`.
  Do not publish prices — Internal Use Only.

### 6.6 Layan Green Park — `layan-green-park`

- Official name in source: `LAYAN GREEN PARK`.
- Developer/brand: not stated in the available deck.
- Location: Layan (stated). Distance to beach 700 m (stated).
- Type: Premium apart-hotel; the financial annex describes the property type as
  `Condominiums`.
- Construction/readiness: Completion `Q1-2026` (stated). Buildings: 4. Total
  units: 377. Units sold: 45% (all stated).
- Source files: `Layan Green Park - eng.pdf` (`1203065c56b0bdbe…`, 7,338,210 B);
  `Layan Green Park.pdf` (`e7beee1d6dce124d…`, 3,066,949 B, Russian).
- Source freshness: deck states `January 2026`.
- Price list: no. Brochure: yes. Plans: no. Media: embedded only.
- Developer identity confidence: none. Project identity confidence: high.
- Expected depth: passport_light.
- Disposition: `ready_with_warnings`.
- Identity caution: this project is **not** the provisional entry "La Green
  Hotel & Residence Layan". Both sit in Layan and both begin with a similar
  token, and the two must not be merged. See §6.11.
- Exact missing materials: developer identity; unit-type schedule; price list;
  current availability (the 45%-sold figure is a January 2026 snapshot);
  coordinates.
- Recommended next action: Passport Light draft. Because completion is stated as
  `Q1-2026` and today is 2026-07-25, the readiness state is likely already
  superseded — request a current construction/handover update before publication.

### 6.7 AYANA Heights Seaview Residence — `ayana-heights-seaview-residence`

- Official name in source: `AYANA HEIGHTS SEAVIEW RESIDENCE`.
- Developer/brand: not stated in the available deck.
- Location: Layan (stated). Distance to beach 400 m (stated).
- Type: Premium apart-hotel.
- Construction/readiness: Completion `Q2-2027` (stated). Buildings: 8. Total
  units: 543 (stated).
- Source files: `AYANA Heights Seaview Residence - eng.pdf`
  (`98c34b692ea1eae5…`, 6,218,924 B); `AYANA Heights Seaview Residence.pdf`
  (`1699bab868e9e59b…`, 1,948,454 B, Russian).
- Source freshness: deck states `January 2026`.
- Price list: no. Brochure: yes. Plans: no. Media: embedded only.
- Developer identity confidence: none. Project identity confidence: high.
- Expected depth: passport_light.
- Disposition: `ready_with_warnings`.
- Exact missing materials: developer identity; unit types; price list;
  coordinates.
- Recommended next action: Passport Light draft with the same warning set as
  Garden of Eden.

### 6.8 Casa de Monte Villa — `casa-de-monte-villa`

- Official name in source: `CASA DE MONTE VILLA`. Internal code `CMK`.
- Developer/brand: not stated in the price list.
- Location: **not source-backed locally** (master plan is image-only).
- Type: Villa. Plot-based inventory with land area in sq.wah and sq.m, villa
  area in sq.m, and 3bed/3bath, 3bed/4bath and 4bed/6bath configurations.
- Construction/readiness: not stated.
- Source files: `CMK Pricelist V1 - 28.02.26 (1).pdf` (`768b2c2b19f644a6…`,
  171,224 B); `CMK Master Plan Price list V.1 - updated 28.02.26.pdf`
  (`33276562243b3235…`, 626,314 B, image-only).
- Source freshness: price list states `Updated : 28.02.26` → 2026-02-28.
- Price list: yes, plot-level, including selling price, land price, villa price,
  an Early Bird discount column, net price and booking deposit.
- Brochure: no. Plans: image-only. Media: no.
- Developer identity confidence: low. Project identity confidence: high.
- Expected depth: passport_light.
- Disposition: `ready_with_warnings`.
- Pricing caution: the sheet carries both a headline `Selling Price` and a
  discounted `Net Price` under an `Early Bird Promotion`. A promotional net
  price is time-bound. Ingest the headline selling price as the price of record
  and carry the promotion as a separate, dated attribute — never silently as the
  price.
- Exact missing materials: location; developer identity; construction status;
  brochure; promotion validity dates.
- Recommended next action: Passport Light draft plus SIP qualification of the
  price list. Confirm whether the Early Bird promotion is still live before any
  publication.

### 6.9 The Title Olive — `the-title-olive`

- Official name in source: `THE TITLE OLIVE`.
- Developer/brand: The Title family by naming; legal entity not stated in deck.
- Location: Nai Yang, Phuket (stated as "Nai Yang — Phuket's hidden oasis").
- Type: Premium complex, modern classic Mediterranean style.
- Construction/readiness: the deck mentions `Q3 2028`, `Q4 2028` and `Q1 2029`;
  which of these is the handover date is not unambiguous from the deck alone and
  must not be guessed.
- Source files: `The Olive_eng.pdf` (`ca1e30fcb068cc2d…`, 7,994,343 B);
  `THE Title Olive_rus.pdf` (`d4e10ea805c2e2be…`, 8,075,754 B).
- Source freshness: **no publication date stated inside the document**. Files
  were received 2026-06-01 by file timestamp; that is transport metadata and is
  recorded as such, not as source freshness.
- Price list: no. Brochure: yes (EN + RU). Plans: no. Media: embedded only.
- Developer identity confidence: low. Project identity confidence: high.
- Expected depth: passport_light.
- Disposition: `ready_with_warnings`.
- Exact missing materials: developer legal identity; explicit completion date;
  unit types; price list; document publication date.
- Recommended next action: Passport Light draft with
  `construction_status_ambiguous` rather than a guessed completion quarter.

### 6.10 Sudara Phuket — `sudara-phuket`

- Official name in source: `SUDARA PHUKET`.
- Developer/brand: not stated in the available deck.
- Location: Bang Tao (stated, "best area of Bang Tao", 400 m to beach).
- Type: Premium condominium.
- Construction/readiness: Completion `Q4 2027` (stated).
- Source files: `Sudara_eng.pdf` (`e1acc90081647cb6…`, 2,304,331 B).
- Source freshness: no publication date stated inside the document; cites CBRE
  data for H2 2024. File received 2026-06-01 (transport metadata only).
- Price list: no formal list. The deck contains five price-shaped figures whose
  role is unverified — they may be indicative from-prices or model inputs.
  **Do not ingest them as prices** without the developer's price list.
- Brochure: yes (EN only; no Russian counterpart found). Plans: no.
- Developer identity confidence: none. Project identity confidence: high.
- Expected depth: passport_light.
- Disposition: `ready_with_warnings`.
- Exact missing materials: developer identity; price list; unit types;
  document publication date; Russian brochure.
- Recommended next action: Passport Light draft; request the price list.

### 6.11 La Green Hotel & Residence Layan — not selected

No file, folder or document anywhere on the inspected machine matches this name.
The nearest match is **Layan Green Park**, which shares the Layan location and a
"Green" token but is a distinct, separately-branded project with its own deck.

These must not be treated as the same record. Disposition:
`duplicate_or_identity_review` for the provisional name,
`not_selected` for the catalogue. If the Owner intended Layan Green Park, that
project is already selected at position 6 under its own name. If a genuinely
separate "La Green Hotel & Residence" exists, its source package is required.

### 6.12 The Title Legendary — not selected

`C:\Users\konst\Documents\Title\Legendary\` contains exactly one file:
`014_VDO_NEW!!!-20260130T154913Z-3-001.zip`, 2,068,202,143 B, a video archive.

There is no brochure, no price list, no facts document and no location
statement. A record built from this would have a name taken from a folder label
and nothing else, which is not a source-backed record. Disposition:
`missing_critical_source`.

Note the sibling folder `C:\Users\konst\Documents\Title\Carolina\` holds older
(2026-01-30) copies of Coralina brochure, facilities, master plan and show-unit
material under a misspelled folder name. These are duplicates of material
already in `forever-data/projects/coralina/source/` and must not be ingested as
a separate project.

### 6.13 Projects with no local source

Botanica Four Seasons — Spring I, Origin Residence Bangtao, Above Patong,
Vibe Residence Karon and MontAzure returned **zero matches** across all
inspected roots. Disposition for each: `missing_critical_source` /
`not_selected`. No record can be created for any of them without the Owner
supplying source material.

## 7. Rainpalm assessment

### 7.1 What is sound

The existing package validates and is deterministic. Re-running the importer's
validator in this worktree reproduced the exact recorded hash:

```text
DRAFT_PAYLOAD_VALID|slug=rainpalm-villas|sha256=c95fb84744d9c067a003284be3fd8de5a2a84a2f9cf03a36b2c78b72d283a9b7|buildings=0|units=21|prices=14|media=0|documents=0|warnings=12
```

This matches `docs/FAST_INTAKE_PILOT_01_RAINPALM.md` byte for byte, and
`payload.project.publish` is `false`.

The SIP comparison report records perfect agreement on the structural layer:
21/21 unit rows recalled, 21/21 exact unit identity, 21/21 unit type, 21/21
bedrooms, 21/21 bathrooms, 21/21 size, 166/166 source references, zero
fabricated rows, zero fabricated prices, zero lost null prices.

Identity is sound: name `Rainpalm Villas`, developer raw `Tonsai Company`,
location `Bang Tao, Phuket`, type `Pool Villa`, all attributed to
`For PDF Presentation.pdf` with page-level references.

### 7.2 The price provenance conflict

The same comparison report records `positive_price_agreement: 9/14` and
`availability_agreement: 18/21`. Those are not rounding artefacts. Four distinct
price documents exist for this project:

| Document | SHA-256 (first 16) | Bytes | Extractable prices |
| --- | --- | --- | --- |
| `Rainpalm - Price List（for In house).pdf` | `08b4ceb9a71c7dc2` | 77,942 | 14 |
| `Rainpalm - Price List（for In house) update 04.2025.pdf` | `4ddee05fe5063bd8` | 77,091 | 9 |
| `Rainpalm - Price List（for In house) update 4_12_2025.pdf` | `ac1c213b547d00d5` | 78,944 | **21, all different values** |
| `Rainpalm - Price List new.pdf` = `…new-1.pdf` | `772c02f01d030a56` | 78,261 | 14 (identical set to the first) |

Three findings follow.

**a. The payload's cited source file does not exist.** Every one of the 21 unit
rows and all 14 price rows in `progressive/payload.json` cite
`Копия Rainpalm - Price List（for In house)-1.pdf`. A full `C:\` scan found no
file of that name anywhere. The currency provenance likewise cites
`Rainpalm Legal and Ownership.pdf (1)-1.pdf`; the real file on disk is
`Rainpalm Legal and Ownership.pdf (1).pdf`, without the `-1`. The `-1` suffix
appears on both cited names and looks like an artefact of whatever tool produced
`price-list.json`, but the effect is that the payload's provenance chain cannot
currently be resolved to a real document.

**b. The qualified source supports only 9 of the 14 prices.** The SIP evidence
chain — `source-proof.json`, `qualification.json`, `reviewed-price-list.json`,
`comparison-report.json` — is bound to `4ddee05f…` (the `04.2025` file). Direct
extraction of that document yields nine selling prices, not fourteen. The five
rows where the payload has a price and the qualified source does not are
**A1, A2, D1, D2 and D4**. SIP correctly declined to resolve them; the payload
asserts them anyway, on the authority of the absent document.

**c. A fourth document contains an entirely different price schedule.** The
`4_12_2025` variant prices all 21 villas with values in the 21.8M–43.1M range,
roughly 8–10% below the 26.4M–47.2M set the payload uses. Whether `4_12_2025`
means 4 December 2025 or 12 April 2025 is not determinable from the filename,
and the document was not opened beyond price extraction. Either reading makes it
a serious candidate for the authoritative list.

There is also a status disagreement: the payload has **D4 available**, while the
`04.2025` document renders D4 as **Reserved**. All of these PDFs share a
column-registration defect under `pdftotext -layout` — the price and status
columns drift relative to the row labels — which is precisely why SIP's
table-mode extraction left cells unresolved instead of guessing.

### 7.3 Other Rainpalm material not yet ingested

`C:\Users\konst\Downloads\Rainpalm\` holds a substantially richer dossier than
the two JSON files that were ingested: `Rainpalm - Master Plan.jpg` (6.4 MB),
`Rainpalm - Payment Terms&Conditions.pdf`, `Rainpalm Legal and Ownership.pdf (1).pdf`,
`For PDF Presentation.pdf` (10.7 MB), `Rainplam Villa Final.mp4` (598 MB),
a 22-file picture set, and three Google Drive exports. The payload currently has
`media=0` and `documents=0`.

The same folder also contains client-specific documents (a land-lease agreement
for villa A8, a quotation for A7) which are excluded.

### 7.4 Verdict

**RAINPALM SOURCES INCOMPLETE.**

The structural layer is staging-ready and could be imported as-is. The price
layer cannot be, because the package asserts 14 prices sourced to a document
that is not present, while the one document with a qualified extraction chain
supports 9 of them, and a fourth document proposes a wholly different schedule.
Importing the current payload would put five unverifiable prices into the
database. Correcting it by silently dropping those five would understate the
project. Neither is acceptable, and inventing a reconciliation is prohibited.

What the Owner must supply to unblock, exactly:

1. The authoritative Rainpalm price list, named unambiguously, ideally with its
   issue date stated inside the document rather than only in the filename.
2. A ruling on whether `Rainpalm - Price List（for In house) update 4_12_2025.pdf`
   supersedes the 14-price schedule, and what `4_12_2025` denotes.
3. The missing `Копия Rainpalm - Price List（for In house)-1.pdf`, or written
   confirmation that `Rainpalm - Price List new.pdf` (`772c02f0…`) is the same
   document under a different name — its 14 values are identical.
4. Confirmation of D4's status: Available or Reserved.
5. Written permission to publish unit-level prices from an "in house" document,
   or a public-facing price list.

Nothing beyond this is blocking. Once item 1 is settled the package can be
regenerated through the existing Fast Intake and SIP contracts without new
tooling.

## 8. Source completeness matrix

`Y` present, `—` absent, `img` present but image-only, `!` present but disputed.

| Project | Facts | Price list | Brochure | Plans | Media | Developer id | Location | Completion | Internal source date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Modeva | Y | Y | Y | Y | Y | Y | Y | — | 2026-07-03 |
| Coralina | Y | Y (stale by 14d) | Y | Y | Y | Y | Y | — | 2026-07-03 / 2026-07-17 available |
| Rainpalm | Y | ! | Y | img | Y | raw only | Y | — | conflicting |
| Garden of Eden | Y | — | Y | — | embedded | — | Y | Q4-2027 | 2026-01 |
| The Title Sierra | partial | Y | — | img | — | — | — | — | 2026-05-15 |
| Layan Green Park | Y | — | Y | — | embedded | — | Y | Q1-2026 | 2026-01 |
| AYANA Heights | Y | — | Y | — | embedded | — | Y | Q2-2027 | 2026-01 |
| Casa de Monte Villa | partial | Y | — | img | — | — | — | — | 2026-02-28 |
| The Title Olive | Y | — | Y | — | embedded | — | Y | ambiguous | none stated |
| Sudara Phuket | Y | — | Y | — | embedded | — | Y | Q4-2027 | none stated |

## 9. Materials the Owner must provide

Blocking for the named record:

| Project | Required |
| --- | --- |
| Rainpalm | Authoritative price list and the four clarifications in §7.4 |
| Coralina | Nothing from the Owner — the blockers are database prerequisites |

Non-blocking but needed before publication:

| Need | Applies to |
| --- | --- |
| Developer legal identity | Garden of Eden, Layan Green Park, AYANA Heights, Sierra, Casa de Monte, Olive, Sudara |
| Location statement in a text-extractable document | The Title Sierra, Casa de Monte Villa |
| Price list | Garden of Eden, Layan Green Park, AYANA Heights, Olive, Sudara |
| Brochure | The Title Sierra, Casa de Monte Villa |
| Text-extractable or OCR'd master plan | Sierra, Casa de Monte |
| Written permission to publish unit-level prices | Modeva, Coralina, Rainpalm, Sierra, Casa de Monte |
| Current construction status | all ten |
| Coordinates | all ten |
| Early Bird promotion validity dates | Casa de Monte Villa |
| Confirmation of intent | "La Green Hotel & Residence Layan" vs Layan Green Park |
| Full source packages | Botanica Four Seasons Spring I, Origin Residence Bangtao, Above Patong, Vibe Residence Karon, MontAzure, The Title Legendary |

## 10. Identity conflicts

| Conflict | Detail | Resolution |
| --- | --- | --- |
| Gardens of Eden vs Garden of Eden (Park Residence) | Source says singular with a second registered name | Use the source form; keep both as search aliases |
| La Green Hotel & Residence Layan vs Layan Green Park | No source for the former; the latter is a distinct project | Keep separate; ask the Owner which was meant |
| `Title\Carolina\` folder | Misspelled duplicate of Coralina material | Do not create a record; duplicates of existing source |
| Rainpalm price-list lineage | Four documents, cited file absent | See §7.4 |
| Rainpalm D4 status | Payload `available`; `04.2025` document `Reserved` | Owner ruling required |
| `Копия …-1.pdf` / `…(1)-1.pdf` naming | `-1` suffix on both cited provenance filenames | Likely a tooling artefact; verify before regenerating |

## 11. Validation performed

| Check | Result |
| --- | --- |
| `git fetch origin` and base SHA capture | `a9d275fc678065ef70b331aee20f24f1c4f030e6` |
| PR #100 merged | Confirmed, merge commit `a9d275fc`, merged 2026-07-25T02:13:22Z |
| PR #102 dependency | Open draft; not used, not merged, not referenced |
| Worktree isolation | `C:\forever-worktrees\catalog-10` on `claude/forever-catalog-10-001`; `C:\forever` untouched |
| Rainpalm `-ValidateOnly` | `DRAFT_PAYLOAD_VALID`, sha256 `c95fb847…`, matches the recorded pilot hash |
| Rainpalm payload `publish` flag | `false` |
| Deterministic fingerprint | `2ef6931168fc7b4c…` unchanged |
| Owner source files | Read-only throughout; no create, delete, rename, move or edit |
| Private data | No client, financial or personal file referenced by any package |
| Invented values | None. Every field above is either quoted from source or marked absent |
| Production | Not contacted. No connection string, credential or endpoint used |
