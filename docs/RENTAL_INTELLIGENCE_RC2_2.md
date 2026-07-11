# RC2.2 — Rental Intelligence Foundation

> Additive layer on the Advisory Workspace. It surfaces a **Rental
> Intelligence** section derived **only** from verified `ProjectDetail` data,
> following exactly the same architectural principles as the Investment
> Intelligence foundation (RC2.1, `src/features/advisory/investment-intelligence.ts`).

---

## 1. Purpose

Give an advisor an evidence-only rental view of the loaded project: what the
verified record can support, and — just as importantly — what it cannot. Every
field is traceable to an existing `ProjectDetail` field. Missing data renders as
**"Not available"**. Nothing is estimated, interpolated, or fabricated.

---

## 2. Anti-fabrication contract

The spec is explicit: **never fabricate occupancy, ADR, ROI, revenue, rental
demand, seasonality, competition, or any numeric rental metric.** The
derivation enforces this structurally:

1. Every field is derived strictly from existing `ProjectDetail` data.
2. **Sensitive rental figures are never surfaced as raw numbers.** Occupancy %,
   ADR, ROI, and rent amounts are reported only as the *presence* of verified
   records (e.g. `"2 investment record(s) with occupancy data"`), exactly as the
   Investment Intelligence layer reports evidence counts. The raw values never
   reach the UI.
3. Absent data renders as the shared `NOT_AVAILABLE` sentinel (reused verbatim
   from the Investment Intelligence module so both foundations match).
4. **Seasonality and competition have no verified `ProjectDetail` source**, so
   they are *always* `NOT_AVAILABLE` — never estimated.
5. **No numeric Rental Score** is produced. No approved, evidence-backed rule
   exists, so the score is always `RENTAL_SCORE_UNAVAILABLE`
   (`"Rental score not available"`).
6. `trust.trustScore` is **never** reused as a rental or match score.
7. The layer is **deterministic** and pure: identical input → identical output
   (no clocks, no randomness, no I/O).

These guarantees are locked down by the module tests (no-fabrication,
trustScore-isolation, determinism, verdict tiers).

---

## 3. Structure

```
src/features/advisory/
  rental-intelligence.ts              # deriveRentalIntelligence() — pure, deterministic
  components/
    RentalIntelligence.tsx            # presentational section (data -> UI)
  tests/
    rental-intelligence.test.ts       # derivation unit tests (11)
    RentalIntelligenceSection.test.tsx # component + integration tests (7)
docs/
  RENTAL_INTELLIGENCE_RC2_2.md        # this file
```

Data flow (identical shape to Investment Intelligence):

```
ProjectDetail ─▶ deriveRentalIntelligence() ─▶ RentalIntelligence ─▶ <RentalIntelligence data={…} />
   (verified)         (pure derivation)          (evidence-only)          (presentational only)
```

### View model

| Field | Source | Behaviour |
|---|---|---|
| `demandContext` | `investment.rentalDemand` | Verbatim rating, else `NOT_AVAILABLE` |
| `incomeEvidence` | `investment.rows[].expected*Rent/Rate` | Count of records with rent figures |
| `occupancyEvidence` | `investment.rows[].occupancyRate` | Count of records with occupancy data |
| `returnEvidence` | `investment.rows[].annualRoiPercent` | Count of records with ROI data |
| `guaranteeEvidence` | `units[].rentalGuarantee`, `rows[].guaranteed*` | Count of guarantee units/records |
| `managementContext` | `investment.rows[].managementCompany` | Distinct operator names |
| `seasonalityEvidence` | — (no source) | Always `NOT_AVAILABLE` |
| `competitionEvidence` | — (no source) | Always `NOT_AVAILABLE` |
| `keyDataGaps` | derived signals | Deterministically ordered list |
| `rentalScore` | — | Always `RENTAL_SCORE_UNAVAILABLE` |
| `readinessVerdict` / `verdictRationale` / `signals` | derived | Conservative verdict (below) |

### Readiness verdict (deterministic, conservative)

- **Foundational** (all three required): income evidence · rental demand · management company.
- **Depth**: occupancy data · ROI data · rental guarantee.
- Rules: any foundational missing → `Insufficient verified data`; all
  foundational + ≥2 depth → `Ready for preliminary review`; all foundational +
  <2 depth → `More evidence required`.

---

## 4. Integration

`AdvisoryWorkspace` gains one **optional** prop, mirroring `investmentIntelligence`:

```tsx
<AdvisoryWorkspace
  session={session}
  investmentIntelligence={investmentIntelligence}
  rentalIntelligence={rentalIntelligence}
/>
```

When present, the Rental Intelligence section renders directly after the
Investment Intelligence section; when absent, it is simply not rendered. The
`/advisory` route derives it from the loaded project via
`deriveRentalIntelligence(project)`. All existing sections and call sites are
unchanged.

---

## 5. Public API (`@/features/advisory`)

```ts
import {
  RentalIntelligence,          // presentational component
  deriveRentalIntelligence,    // pure derivation entry point
  RENTAL_SCORE_UNAVAILABLE,    // score sentinel
} from "@/features/advisory";

import type {
  RentalIntelligenceData,      // the derived view model
  RentalReadinessVerdict,
  RentalReadinessSignals,
  RentalIntelligenceProps,
} from "@/features/advisory";
```

`NOT_AVAILABLE` is shared with the Investment Intelligence module (a single
exported sentinel — not redefined).

---

## 6. Scope boundaries honoured

- **No Supabase schema / database change.** Reads existing fields only.
- **Navigator, Passport, Discovery, Import Engine, Website architecture:** untouched.
- **Additive only** — new files plus one optional prop, barrel exports, and the route wiring.
- **All existing functionality preserved** — the full pre-existing test suite passes unchanged.
- No new brand accents; the frozen Forever palette is reused.

---

## 7. Validation

- `npm test` (`vitest run`): 44 tests pass — 11 rental derivation + 7 rental
  section + the 26 pre-existing tests, all green.
- Type-check: the advisory feature is strict-clean.
- `git diff --check`: clean.
