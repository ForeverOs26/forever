# Forever Catalogue 10 — batch roadmap

Companion to `FOREVER_CATALOG_10_ONBOARDING.md`. Same base SHA
`a9d275fc678065ef70b331aee20f24f1c4f030e6`, same branch
`claude/forever-catalog-10-001`.

No production action is authorised by this document. Every wave below ends at a
staging boundary. Nothing here permits a publish.

> **Status update — FOREVER-CATALOG-10-002, 2026-07-26.** The Owner reshaped
> Wave 1 to four members: Coralina, Rainpalm, Gardens of Eden and The Title
> Sierra. All four packages are prepared, validated and staging-ready; none is
> loaded, because no staging database credential exists in the working
> environment. See
> [`FOREVER_CATALOG_10_WAVE1_STAGING_REPORT.md`](FOREVER_CATALOG_10_WAVE1_STAGING_REPORT.md).
>
> Two structural corrections to the plan below, both material:
>
> - **Wave 0 is dissolved.** It assumed Coralina was blocked on a prerequisite
>   migration for the developer and `kamala` location rows. It is not. The
>   progressive ingestion contract accepts null developer and location IDs,
>   keeps the raw names and emits `*_unresolved` warnings — which Coralina's
>   package already does. Canonical resolution is a publication prerequisite,
>   not an import one, so the pinned migration is not on the Wave 1 path.
> - **Rainpalm is no longer blocked on the price ruling.** It ships as a
>   structural draft with 21 units and zero prices, carrying
>   `authoritative_price_list_unresolved`. The Owner ruling is now required
>   before Rainpalm gets *prices*, not before it gets a record.
>
> The gate table below still applies to Waves 2 and 3 unchanged. G1 is the gate
> Rainpalm previously failed; the structural draft passes it by citing the
> presentation document, which resolves, and by carrying no price rows at all.

## Wave 0 — Coralina prerequisites (blocking, ahead of everything else)

Wave 0 is not in the original three-wave shape. It exists because the Coralina
record the brief assumes is already present does not exist, and its blockers sit
in the database rather than in source material.

| Item | State |
| --- | --- |
| Canonical developer row for Rhom Bho Property PCL | absent, fresh exact count `0` |
| `kamala` location row | absent, fresh exact count `0` |
| Coralina project row | absent, 0 of 405 expected writes |
| V15 approval | unconsumed; single-use locks must remain untouched |

Sequence:

1. Apply the pinned prerequisite migration through an interactive secure
   credential channel. This is platform maintenance, not a project import, and
   carries its own review and validation.
2. Verify the developer and `kamala` location rows exist.
3. Regenerate a fresh, unexpired Coralina package. Do not reuse V13/V14/V15
   approvals or the expired digests.
4. Ingest the 2026-07-17 price list and master-plan price list from
   `C:\forever-incoming\Coralina\updates\2026-07-17\` so the draft is not born
   two weeks stale.
5. Import as an unpublished draft. Run the canonical post-write verifier.

Gate: Coralina draft present, unpublished, with the 17.07.26 price data and its
two known warnings (`coordinates_missing`, `construction_status_missing`).

Until Wave 0 closes, the catalogue holds one record, not two.

## Wave 1 — Rainpalm plus the two most source-ready new projects

Members: **Rainpalm Villas**, **Garden of Eden (Park Residence)**,
**The Title Sierra**.

Rationale. Rainpalm is Owner-locked to this position. Garden of Eden is the only
provisional entry from positions 4–10 with real local source and it carries the
most complete identity backbone of the new candidates — name, location,
property type, completion quarter, building count and a stated document date.
The Title Sierra brings the freshest unit-level price data in the whole intake
(2026-05-15) and shares the Title lineage already modelled for Modeva and
Coralina, so its developer resolution work is reusable.

### Staging upload order

1. `garden-of-eden` — Passport Light, no price layer, lowest risk. Proves the
   Passport Light path end to end before anything harder runs.
2. `the-title-sierra` — Passport Light plus a SIP-qualified price list.
   Exercises price ingestion on a clean, single-source document.
3. `rainpalm-villas` — **only after §7.4 of the register is answered.** If the
   Owner has not ruled on the price list, Rainpalm ships structure-only or waits.

### Validation gates

| Gate | Requirement |
| --- | --- |
| G1 Source integrity | Every cited source file resolves to a real file whose SHA-256 matches the manifest. This is the gate Rainpalm currently fails. |
| G2 Determinism | Two consecutive intake runs produce byte-identical payload, classification and extracted facts, and the same batch fingerprint. |
| G3 Draft-only | `payload.project.publish === false` and `Import-ForeverProjectDraft.ps1 -ValidateOnly` returns `DRAFT_PAYLOAD_VALID`. |
| G4 No invention | Every populated field traces to a source reference. Every absent field is a warning, never a default. |
| G5 Privacy | No client, contract, financial or personal file in the package. For Rainpalm this specifically excludes the A8 land lease, the A7 quotation and `tsetup-x64.7.0.2.exe`. |
| G6 Archive limits | Package respects the PR #100 intake limits (300 MiB ZIP, resumable). The 598 MB Rainpalm video exceeds this and must be split or deferred. |
| G7 Count parity | Post-commit unit, price and warning counts equal the payload counts. |

### Production-draft eligibility

- `garden-of-eden`: eligible once G1–G7 pass on staging.
- `the-title-sierra`: eligible once G1–G7 pass **and** the location gap is
  either filled or accepted as a `location_missing` warning on the draft.
- `rainpalm-villas`: **not eligible** until the price provenance is resolved.

### Expected warnings

| Project | Warnings |
| --- | --- |
| Garden of Eden | `developer_unresolved`, `price_list_missing`, `unit_types_missing`, `coordinates_missing`, `country_missing` |
| The Title Sierra | `location_missing`, `developer_unresolved`, `construction_status_missing`, `brochure_missing`, `coordinates_missing` |
| Rainpalm | the existing 12, plus `price_source_unresolved` until §7.4 is answered |

### Publication prerequisites

None of the three may be published in this wave. Publication additionally needs:
written developer permission for any Internal Use Only price data; a current
construction status; and for Garden of Eden, confirmation that the deck's
five-year investment model is not rendered anywhere as a price or a yield
promise.

## Wave 2 — the next three

Members: **Layan Green Park**, **AYANA Heights Seaview Residence**,
**Casa de Monte Villa**.

Rationale. Layan Green Park and AYANA Heights come from the same January 2026
deck family as Garden of Eden, so Wave 1 will have already proven the exact
extraction path — these two are near-mechanical repeats. Casa de Monte Villa
adds the second villa product and a second unit-level price list, but its
promotional pricing structure needs the extra care described below, which is why
it follows Sierra rather than accompanying it.

### Staging upload order

1. `layan-green-park`
2. `ayana-heights-seaview-residence`
3. `casa-de-monte-villa`

### Validation gates

G1–G7 as in Wave 1, plus:

| Gate | Requirement |
| --- | --- |
| G8 Promotion separation | For Casa de Monte, the headline `Selling Price` is the price of record. The `Early Bird` discount and `Net Price` are stored as a separate, dated promotional attribute. A promotional price must never be written as the price. |
| G9 Superseded readiness | Layan Green Park states completion `Q1-2026`, already in the past as of 2026-07-25. The draft must carry `construction_status_stale` rather than presenting a lapsed quarter as current. |
| G10 Snapshot honesty | The "45% sold" figure is a January 2026 snapshot. It is recorded with its date or not at all. |

### Production-draft eligibility

All three eligible after G1–G10, as unpublished drafts with warnings.

### Expected warnings

| Project | Warnings |
| --- | --- |
| Layan Green Park | `developer_unresolved`, `price_list_missing`, `unit_types_missing`, `construction_status_stale`, `coordinates_missing` |
| AYANA Heights | `developer_unresolved`, `price_list_missing`, `unit_types_missing`, `coordinates_missing` |
| Casa de Monte Villa | `location_missing`, `developer_unresolved`, `construction_status_missing`, `brochure_missing`, `promotion_validity_unknown` |

### Publication prerequisites

Developer legal identity for all three. A current construction update for Layan
Green Park. For Casa de Monte, confirmation that the Early Bird promotion is
still live, plus permission for Internal Use Only prices.

## Wave 3 — the final two

Members: **The Title Olive**, **Sudara Phuket**.

Rationale. Both are brochure-only with no internal publication date, which makes
them the weakest on source freshness. They are still honest Passport Light
records — name, location, type and completion signal are all source-stated — but
they should land last so that the freshness warning pattern is already
established by the earlier waves.

### Staging upload order

1. `the-title-olive`
2. `sudara-phuket`

### Validation gates

G1–G7, plus:

| Gate | Requirement |
| --- | --- |
| G11 No inferred date | Neither record may carry a source date derived from a file timestamp. Absent an in-document date, `source_date_unknown` is the correct value. |
| G12 Ambiguous completion | The Olive's deck mentions Q3 2028, Q4 2028 and Q1 2029. The draft records `construction_status_ambiguous`; it does not pick one. |
| G13 Unverified figures | Sudara's five price-shaped figures are not ingested as prices. `price_list_missing` stands. |

### Production-draft eligibility

Both eligible after G1–G13.

### Expected warnings

| Project | Warnings |
| --- | --- |
| The Title Olive | `developer_unresolved`, `price_list_missing`, `construction_status_ambiguous`, `source_date_unknown`, `coordinates_missing` |
| Sudara Phuket | `developer_unresolved`, `price_list_missing`, `unit_types_missing`, `source_date_unknown`, `coordinates_missing` |

### Publication prerequisites

Developer identity, a price list, and a dated document for each.

## Cross-wave publication prerequisites

These apply to the catalogue as a whole and none is satisfied today.

1. **Internal Use Only clearance.** Every price list in the intake is marked for
   internal distribution. Publishing unit-level prices from any of them —
   including Modeva's and Coralina's — requires written developer permission.
2. **Developer canonicalisation.** Seven of ten records have no resolved
   developer. Passport Light tolerates a raw name; a published record should not.
3. **Construction status.** No record in the catalogue has a source-verified
   current construction state. Modeva's `'Planning'` is a seeded literal, not an
   extracted fact.
4. **Coordinates.** Absent for all ten.
5. **Media rights.** Brochure imagery and the Rainpalm and Legendary video
   archives need a use-permission decision before any public rendering.
6. **Commission neutrality.** No commission, margin or partner-economics field
   may appear in public product data or influence public ordering, in line with
   the task constraint.

## Modeva follow-up, separately gated

Modeva is the one published record and its commercial fields are placeholders:
`starting_price_thb` and `last_price_update` are `NULL`; `price_range`,
`beds_display`, `area_range`, `verified_price`, `start_date_display`,
`completion_date_display` and `last_inspection` are empty strings;
`trust_score` and `investment_value` are `0`; `market_position` and
`rental_demand` read `'Under review'`. Its own source package contains a
2026-07-03 price list that would fill most of these.

This is a live-content change to an already-published record, so it is not part
of the draft waves and needs its own Owner authorisation. Recommended shape:
read-only diff of source against the seeded row, then a targeted field update
that leaves identity, slug and publication state untouched.

## Summary

Superseded for Wave 1 by the 2026-07-26 update above; retained for Waves 2–3.

| Wave | Members | Blocking dependency |
| --- | --- | --- |
| 0 | ~~Coralina~~ | **dissolved** — not a real blocker; folded into Wave 1 |
| 1 | Coralina, Rainpalm, Gardens of Eden, The Title Sierra | **staging database credential** (all four prepared, none loaded) |
| 2 | Layan Green Park, AYANA Heights, Casa de Monte Villa | none |
| 3 | The Title Olive, Sudara Phuket | none |

Plus Modeva, already present, on a separate update track.

Total: ten records. Two need Owner input before they can move; eight can proceed
on existing source as unpublished drafts with explicit warnings.
