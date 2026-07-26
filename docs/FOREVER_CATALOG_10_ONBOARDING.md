# Forever Catalogue 10 — onboarding register

Companion to [`FOREVER_CATALOG_10_WAVE_ROADMAP.md`](FOREVER_CATALOG_10_WAVE_ROADMAP.md)
and [`FOREVER_CATALOG_10_WAVE1_STAGING_REPORT.md`](FOREVER_CATALOG_10_WAVE1_STAGING_REPORT.md).

This document records which projects Catalogue 10 covers, what source material
each one rests on, and what is still missing. It authorises nothing: no import,
no publication, no production action.

## 1. How source material is described here

This is a public document in a public repository. It therefore describes source
material by **role**, never by location.

Every source reference below uses one of these terms:

| Term                                      | Meaning                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| **tracked project source**                | Material already committed to this repository under a project's own directory      |
| **bounded external intake source**        | A directory the Owner designated for intake, supplied to the builder at build time |
| **Owner-provided project dossier**        | A package the Owner assembled for one project and supplied deliberately            |
| **official developer material**           | A developer-issued brochure, guide, price list or master plan                      |
| **excluded private Owner area**           | A directory of the Owner's personal records — never read, never ingested           |
| **excluded client or contract material**  | Third-party commercial and contractual documents — never read, never ingested      |
| **unrelated binary excluded from intake** | A file inside a source folder that belongs to no project and was skipped           |

Concrete file locations are supplied to the build through the
`FOREVER_CATALOG_SOURCE_ROOTS` environment variable and are never written into
this repository. Local filesystem layout is not part of the catalogue record and
does not belong in public history.

Every document the catalogue actually depends on is pinned in
`scripts/catalog/build-wave1-payloads.mjs` by **filename, SHA-256 digest and byte
length**. The pin — not a path — is what identifies a source, so the record stays
reproducible without disclosing where anything is stored.

### 1.1 Excluded areas

Some directories adjacent to the intake sources hold material that is not project
data and must never enter an ingestion path. They are excluded as whole
categories:

| Category                                | Handling                                                         |
| --------------------------------------- | ---------------------------------------------------------------- |
| Excluded private Owner area             | Not read. No file inspected, no filename recorded.               |
| Excluded client or contract material    | Not read. No party named, no document title recorded.            |
| Personal media unrelated to any project | Not read.                                                        |
| Unrelated binary inside a source folder | Skipped by the builder; belongs to no project in this catalogue. |

The exclusion decision is what matters to the audit trail. Enumerating the
excluded material in public would defeat the purpose of excluding it, so this
register records the categories and their disposition and nothing further.

The builder's own design enforces the same boundary from the other side: it
resolves a source only by exact filename **and** pinned digest, so no
neighbouring file can be drawn into a build even if it sits in a configured root.

### 1.2 Repository tracking boundary

`.gitignore` carries a narrow, fail-closed allow-list: exactly **six** payload
JSON files across five projects are trackable, and every surrounding directory —
`intake/`, `sip/`, `source/`, `media/` and the rest — stays ignored. A newly
added PDF, image, extracted-text file or media asset under a project tree cannot
become committable by accident.

No source PDF, no extracted text and no temporary build artefact is tracked by
this work.

## 2. Intake policy

Catalogue 10 follows the Owner Upload Trust Policy. A first import is not a
forensic due-diligence exercise:

```text
Owner-approved source
→ extract supported data
→ create unpublished Draft
→ leave missing data null
→ record contradictions as warnings
→ continue
```

Consequences that matter when reading the register below:

- An unresolved developer ID, location ID or optional field is **not** a
  rejection. It is recorded as a `*_unresolved` warning and the draft proceeds.
- A contradiction between two source documents is **preserved**, not resolved.
  Conflicting figures are recorded side by side with their evidence.
- Nothing is invented. Where a source states a count but supplies no identifier,
  the count is recorded as a warning and **no row is created**. Several projects
  below therefore have zero building, unit and price rows on purpose.
- Every draft is born `mode: create`, `publish: false`. Publication is always a
  separate, later, explicitly authorised action.

## 3. Cross-cutting constraint — Internal Use Only

Some developer price lists are stamped "(Internal Use Only)" on every page. Where
that marking exists it is recorded on the project as an
`internal_use_only_source` warning and the payload stays `publish: false`.

The data may be held in an internal draft. The document itself and its unit-level
prices must not become anonymously public, and importing such a source implies no
publication permission. This constraint is per-project and is noted in the
register where it applies.

## 4. The catalogue of ten

| #   | Project                         | Slug                              | Wave | State                                     |
| --- | ------------------------------- | --------------------------------- | ---- | ----------------------------------------- |
| 1   | Modeva                          | `modeva`                          | —    | Already present; separate update track    |
| 2   | The Title Coralina Kamala       | `coralina`                        | 1    | Draft payload; reported loaded to staging |
| 3   | Rainpalm Villas                 | `rainpalm-villas`                 | 1    | Draft payload; reported loaded to staging |
| 4   | Garden of Eden (Park Residence) | `garden-of-eden`                  | 1    | Draft payload; reported loaded to staging |
| 5   | The Title Sierra                | `the-title-sierra`                | 1    | Draft payload; reported loaded to staging |
| 6   | Layan Green Park                | `layan-green-park`                | 2    | Draft payload prepared **offline only**   |
| 7   | AYANA Heights Seaview Residence | `ayana-heights-seaview-residence` | 2    | Draft payload prepared **offline only**   |
| 8   | Casa de Monte Villa             | `casa-de-monte-villa`             | 2    | Not started — no payload, no project      |
| 9   | The Title Olive                 | `the-title-olive`                 | 3    | Not started                               |
| 10  | Sudara Phuket                   | `sudara-phuket`                   | 3    | Not started                               |

Two further projects were considered and **not selected**: La Green Hotel &
Residence Layan (no distinct current source; the name appears only as residue in
a superseded deck) and The Title Legendary (tracked separately).

"Reported loaded to staging" is exactly that — a result recorded by the session
that performed the Wave 1 import, not a live query. See §7.

## 5. Per-project register

Counts are measured from the committed payloads.

| Project                           | Bldgs | Units | Prices | Warn | Payload SHA-256 | `batch_fingerprint` |
| --------------------------------- | ----: | ----: | -----: | ---: | --------------- | ------------------- |
| `coralina`                        |     8 |   198 |    198 |    6 | `2d5613a35705…` | `9ceb05d2daa5…`     |
| `rainpalm-villas`                 |     0 |    21 |      0 |    7 | `4e5f5d4d56ea…` | `8f84fbecbf31…`     |
| `garden-of-eden`                  |     0 |     0 |      0 |   13 | `c8a5156779a7…` | `de458b059155…`     |
| `the-title-sierra`                |     2 |   180 |    180 |   14 | `e0b8b8c01906…` | `53f569ffe002…`     |
| `layan-green-park`                |     0 |     0 |      0 |   24 | `75384d9bf131…` | `396feb209fa5…`     |
| `ayana-heights-seaview-residence` |     0 |     0 |      0 |   14 | `1efa6fa45587…` | `823e618b8d66…`     |

### 5.1 Coralina — `coralina`

Prepared by earlier work and untouched by Catalogue 10's builder; it has no
builder entry, and `--only=coralina` is refused as `unknown_project`. Developer
and `kamala` location IDs are unresolved and recorded as warnings; canonical
resolution is a **publication** prerequisite, not an import one.

### 5.2 Rainpalm Villas — `rainpalm-villas`

Owner-provided project dossier. The 21-unit structure is accepted as source-backed.
**Prices are withdrawn**, not lost: the dossier holds four price-list versions
whose contents disagree, so a `multiple_price_list_versions` warning is recorded
and zero price rows are emitted until the Owner selects the current version. The
withdrawn 14-price layer is preserved verbatim as
`progressive/payload.fast-intake-v1.json` for audit — it is byte-identical to the
payload this work replaced.

### 5.3 Garden of Eden — `garden-of-eden`

Official developer material in two language editions. The deck states building
and unit counts but carries no per-unit or per-building identifier, so the record
is project-only: 13 warnings, zero rows. Materialising rows from bare counts
would be invention.

### 5.4 The Title Sierra — `the-title-sierra`

Official developer price list and master plan. Two buildings — the source's own
tower letters, with no derived display name — 180 units and 180 prices, every one
traceable to a row of the price list. The price list is marked
**"(Internal Use Only)"** on all three pages; the constraint in §3 applies.
Currency is recorded as THB at medium confidence: the price rows carry no
currency symbol, and THB is stated in the document's additional-cost block on
page 3.

### 5.5 Layan Green Park — `layan-green-park`

**Phase 1 only.** Two strictly pinned documents: the Phase 1 project guide and
the Phase 1 price list, both official developer material.

The strict pin is mandatory here. The developer's Phase 1 and Phase 2 folders
each contain a file with the _same_ filename; only the digest distinguishes them.
An ordinary newest-file fallback could substitute Phase 2 content into a Phase 1
record with nothing looking wrong, so these two sources refuse to resolve at all
unless the pinned digest matches.

Zero rows: neither document carries a per-unit or per-building identifier. Five
**type-level** price bands are recorded as warning evidence, never as unit rows.
Phase 2 figures are stated in the source and are explicitly _not_ ingested; a
build-time guard fails if a Phase 2 figure reaches any warning outside the three
that exist to explain the phase boundary.

Two source characteristics are recorded rather than smoothed over: the price list
prints **two conflicting price-validity dates** (one of them in Russian), and its
duplex band is the sole row printed with a Cyrillic character and a comma decimal
separator. Neither is normalised. The descriptive project fields carry **no**
source date, because neither document states one for them — borrowing the
price-validity date would make a descriptive fact look as current as a price.

### 5.6 AYANA Heights Seaview Residence — `ayana-heights-seaview-residence`

Official developer material, two editions. Project-only for the same reason as
Garden of Eden: stated counts, no identifiers, so zero rows and 14 warnings.

### 5.7 Casa de Monte Villa, The Title Olive, Sudara Phuket

Not started. No payload exists and no project record is created by this work.

### 5.8 Modeva — `modeva`

Already present in the repository on a separate update track. Catalogue 10 does
not modify it.

## 6. Source completeness — what is still missing

| Project             | Outstanding Owner input                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| `rainpalm-villas`   | A ruling on which price-list version is current, or a newer developer price list        |
| `coralina`          | Canonical developer and location records — required for publication, not for import     |
| `the-title-sierra`  | Confirmation of publication handling given the Internal Use Only marking                |
| `layan-green-park`  | The developer entity, which no current source names; a per-unit inventory if one exists |
| `ayana-heights…`    | A unit inventory or price list; the deck has neither                                    |
| Waves 2–3 remainder | Source material for Casa de Monte Villa, The Title Olive and Sudara Phuket              |

None of these blocks an unpublished draft. All of them bear on publication.

## 7. Wave 1 staging — how to read the result

Wave 1 is **reported** to have loaded four unpublished drafts to a dedicated
staging project on 2026-07-26. The evidence footings are set out in full in
`FOREVER_CATALOG_10_WAVE1_STAGING_REPORT.md` §15 and are not restated here.

What matters for this register:

- the arithmetic in that record was **recomputed** against the committed payloads
  and agrees exactly;
- the live staging state is **not reverified** by this document — no database was
  contacted to write it;
- **production was untouched**, and nothing was published.

## 8. Validation

Performed against the committed payloads and the builder:

- every payload parses, is `schema_version: "1"`, `mode: create`,
  `publish: false`, and carries no duplicate warning code;
- every declared `batch_fingerprint` reproduces through the canonical production
  `fingerprintBatch`;
- every payload passes the canonical TypeScript draft validator and the
  PowerShell importer's `-ValidateOnly` path;
- all five generated payloads rebuild **byte-identically** from their pinned
  sources across repeated runs, and `--check` reports `UNCHANGED`;
- no source citation points past the end of the document it cites — the bound is
  measured from the pinned PDF on every build;
- the builder has focused test coverage in
  `src/intake/tests/catalog-wave1-builder.test.ts`, including the source-pin
  refusal cases, the same-filename phase collision, and the no-invented-rows
  guarantees.
