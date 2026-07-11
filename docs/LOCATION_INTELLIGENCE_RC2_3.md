# RC2.3 — Location Intelligence Foundation

> Additive layer on the Advisory Workspace. It surfaces a **Location
> Intelligence** section derived **only** from verified `ProjectDetail` data,
> following exactly the same architectural principles as the Investment
> Intelligence (RC2.1, `src/features/advisory/investment-intelligence.ts`) and
> Rental Intelligence (RC2.2, `src/features/advisory/rental-intelligence.ts`)
> foundations.

---

## 1. Purpose

Give an advisor an evidence-only location view of the loaded project: what the
verified record can support about the **location**, and — just as importantly —
what it cannot. Every field is traceable to an existing `ProjectDetail` field
(recorded in the `sources` map on the returned view model). Missing data renders
as **"Not available"**. Nothing is estimated, interpolated, or fabricated.

The module explains what the existing project record supports about the location
**without inventing** distances, travel times, demand, growth, infrastructure
quality, neighbourhood quality, or market performance.

---

## 2. Data sources (canonical `ProjectDetail` only)

The derivation reads **only** from the already-loaded `ProjectDetail` view model
(`src/features/project-detail/project-detail-types.ts`). It creates no new
project or location model and touches no schema, migration, or table.

| Derived field | `ProjectDetail` source | Behaviour |
|---|---|---|
| `locationIdentity` | `location.area` (fallback `core.location`) | Verbatim area name, else `NOT_AVAILABLE` |
| `locationDescription` | `core.address` | Verbatim recorded address, else `NOT_AVAILABLE` |
| `beachProximity` | `location.distanceToBeach` | Verbatim recorded value only, else `NOT_AVAILABLE` |
| `airportProximity` | `location.distanceToAirport` | Verbatim recorded value only, else `NOT_AVAILABLE` |
| `lifestyleEvidence` | `location.lifestyle` | Count + distinct recorded amenity labels, else `NOT_AVAILABLE` |
| `infrastructureEvidence` | `location.nearbySchools`, `location.nearbyHospitals` | Presence counts only, else `NOT_AVAILABLE` |
| `rentalLocationEvidence` | `distanceToBeach`, `distanceToAirport`, `lifestyle` | Lists which factors are recorded — no demand claim |
| `resaleLocationEvidence` | `distanceToBeach`, `distanceToAirport`, `nearbySchools`, `nearbyHospitals` | Lists which factors are recorded — no liquidity claim |
| `keyDataGaps` | derived signals | Deterministically ordered list |
| `readinessVerdict` / `verdictRationale` / `signals` | derived | Conservative verdict (below) |
| `locationScore` | — | Always `LOCATION_SCORE_UNAVAILABLE` |
| `sources` | static | Source-field reference for every surfaced value |

The full field → source map is also exported at runtime via the `sources`
property on the derived view model, making the anti-fabrication contract
auditable in code and tests.

---

## 3. Derivation rules (exact)

1. **`locationIdentity`** — `location.area` if non-blank, else `core.location`
   if non-blank, else `NOT_AVAILABLE`. Trimmed verbatim; never invented.
2. **`locationDescription`** — `core.address` trimmed if non-blank, else
   `NOT_AVAILABLE`.
3. **`beachProximity`** — `"Recorded: " + location.distanceToBeach` if the field
   is non-blank, else `NOT_AVAILABLE`. The value is **only** the stored string;
   it is never computed from coordinates, the area name, or any estimate.
4. **`airportProximity`** — same rule against `location.distanceToAirport`.
5. **`lifestyleEvidence`** — distinct, first-seen-ordered `location.lifestyle`
   entries; rendered as `"N recorded lifestyle/amenity feature(s): a, b, …"`, else
   `NOT_AVAILABLE`.
6. **`infrastructureEvidence`** — counts of distinct `location.nearbySchools`
   and `location.nearbyHospitals`; rendered as `"X recorded nearby school(s); Y
   recorded nearby hospital(s)"` (only the present parts), else `NOT_AVAILABLE`.
   Presence only — never an access, quality, or distance claim.
7. **`rentalLocationEvidence`** — enumerates which of {beach proximity, airport
   proximity, lifestyle & amenities} are recorded: `"Location factors on record:
   …"`. If none, `NOT_AVAILABLE`. **No demand/tourism claim is ever made.**
8. **`resaleLocationEvidence`** — enumerates which of {beach proximity, airport
   proximity, nearby infrastructure} are recorded. If none, `NOT_AVAILABLE`.
   **No growth/appreciation/liquidity claim is ever made.**
9. **`keyDataGaps`** — deterministic order: Area identity, Address, Beach
   proximity, Airport proximity, Lifestyle & amenities, Nearby schools/hospitals
   (only the missing ones).
10. **`readinessVerdict`** — conservative, rule-based (§5).
11. **`locationScore`** — always `LOCATION_SCORE_UNAVAILABLE`
    (`"Location score not available"`). No approved, evidence-backed rule exists.

The layer is **deterministic** and pure: identical `ProjectDetail` input →
identical output (no clocks, no randomness, no I/O).

---

## 4. Anti-fabrication contract

The spec is explicit: **never invent or estimate** distance to beach, distance
to airport, travel time, walkability, infrastructure quality, rental demand,
tourism demand, capital growth, area appreciation, neighbourhood safety,
school/hospital access, traffic conditions, future infrastructure, market
averages, or a location score. The derivation enforces this structurally:

1. Every field is derived strictly from an existing `ProjectDetail` field, and
   the source path is recorded in `sources`.
2. **Beach / airport proximity is surfaced only as the verbatim recorded
   string.** If the field is empty it is `NOT_AVAILABLE` — never interpolated
   from latitude/longitude or the area name.
3. **Travel time has no verified source and is never produced in any form.**
4. **Lifestyle, schools, and hospitals are reported as presence/labels only** —
   never as a quality, access, safety, or distance judgement.
5. **Rental / resale location evidence only lists which recorded factors exist**
   — it makes no demand, growth, appreciation, or liquidity claim, and never
   calls a location good, premium, strategic, high-demand, or investment-grade.
6. Absent data renders as the shared `NOT_AVAILABLE` sentinel (reused verbatim
   from the Investment Intelligence module so all three foundations match).
7. **No numeric Location Score** is produced. No approved, evidence-backed rule
   exists, so the score is always `LOCATION_SCORE_UNAVAILABLE`.
8. `trust.trustScore` (and `matchScore`, investment/rental scores) is **never**
   reused as a location score.

These guarantees are locked down by the module tests (no-fabrication,
score-isolation, traceability, determinism, verdict tiers).

---

## 5. Readiness verdict (deterministic, conservative)

- **Foundational** (BOTH required to leave `Insufficient verified data`):
  area identity · address.
- **Depth**: beach proximity · airport proximity · lifestyle · nearby
  infrastructure (schools or hospitals).
- Rules, in order:
  1. Any foundational missing → `Insufficient verified data` (this includes the
     "only the location name exists" case — no address).
  2. Both foundational present AND ≥ 2 depth signals → `Ready for preliminary review`.
  3. Both foundational present AND < 2 depth signals → `More evidence required`.

The verdict reports only whether the record carries enough verified location
**data** for a preliminary review. It is never expressed as, and never implies,
a quality judgement of the location itself.

---

## 6. Structure

```
src/features/advisory/
  location-intelligence.ts               # deriveLocationIntelligence() — pure, deterministic
  components/
    LocationIntelligence.tsx             # presentational section (data -> UI)
  tests/
    location-intelligence.test.ts        # derivation unit tests (15)
    LocationIntelligenceSection.test.tsx # component + integration tests (8)
docs/
  LOCATION_INTELLIGENCE_RC2_3.md         # this file
```

Data flow (identical shape to Investment / Rental Intelligence):

```
ProjectDetail ─▶ deriveLocationIntelligence() ─▶ LocationIntelligence ─▶ <LocationIntelligence data={…} />
   (verified)         (pure derivation)            (evidence-only)            (presentational only)
```

---

## 7. Integration

`AdvisoryWorkspace` gains one **optional** prop, mirroring
`investmentIntelligence` / `rentalIntelligence`:

```tsx
<AdvisoryWorkspace
  session={session}
  investmentIntelligence={investmentIntelligence}
  rentalIntelligence={rentalIntelligence}
  locationIntelligence={locationIntelligence}
/>
```

When present, the Location Intelligence section renders directly after the
Rental Intelligence section; when absent, it is simply not rendered. The
`/advisory` route derives it from the loaded project via
`deriveLocationIntelligence(project)`, reusing the already-loaded
`ProjectDetail` for the canonical `the-modeva-bang-tao` slug. All existing
sections and call sites are unchanged.

---

## 8. Public API (`@/features/advisory`)

```ts
import {
  LocationIntelligence,          // presentational component
  deriveLocationIntelligence,    // pure derivation entry point
  LOCATION_SCORE_UNAVAILABLE,    // score sentinel
} from "@/features/advisory";

import type {
  LocationIntelligenceData,      // the derived view model
  LocationReadinessVerdict,
  LocationReadinessSignals,
  LocationIntelligenceSources,
  LocationIntelligenceProps,
} from "@/features/advisory";
```

`NOT_AVAILABLE` is shared with the Investment Intelligence module (a single
exported sentinel — not redefined).

---

## 9. Known data gaps (verified Modeva seed)

The canonical Modeva record (`the-modeva-bang-tao`) currently carries an area
(`Bang Tao`), an address (`Bang Tao, Phuket, Thailand`), and a recorded
beach-proximity string (`Bang Tao area`); airport proximity, lifestyle,
schools, hospitals, and coordinates are not populated. The module therefore
reports beach proximity as its recorded value, marks the rest **"Not
available"**, lists them under **Key location data gaps**, and — with both
foundational signals present but only one depth signal — returns **"More
evidence required"**. No distance, travel time, demand, or score is invented for
the missing fields.

Structurally missing location signals (no verified `ProjectDetail` source, so
always `NOT_AVAILABLE` or unmodelled): travel times, walkability, infrastructure
quality, rental/tourism demand, capital growth, area appreciation, neighbourhood
safety, traffic conditions, future infrastructure, market averages, and any
numeric location score.

---

## 10. Scope boundaries honoured

- **No Supabase schema / migration / database change.** Reads existing fields only.
- **Import Engine, Navigator, Discovery, Passport, Project Detail architecture,
  Investment/Rental logic, scoring engines, AI integrations, unrelated UI:** untouched.
- **Additive only** — new files plus one optional prop, barrel exports, and the route wiring.
- **All existing functionality preserved** — the full pre-existing test suite passes unchanged.
- No new brand accents; the frozen Forever palette is reused.

---

## 11. Validation

- `npm test` (`vitest run`): 67 tests pass — 15 location derivation + 8 location
  section + the 44 pre-existing tests, all green.
- `npx tsc --noEmit`: clean.
- Targeted ESLint on changed files: clean.
- `npm run build`: succeeds.
- `git diff --check`: clean.
