# RC2.4 — Forever Passport Integration

> The executive summary of the Advisory Workspace. It **aggregates** the four
> already-merged Intelligence foundations — Trust, Investment (RC2.1), Rental
> (RC2.2), and Location (RC2.3) — into one unified, **evidence-based** project
> passport. It introduces **no new scoring engine**, duplicates no derivation,
> and surfaces only verified information.

---

## 1. Purpose

Give an advisor a single at-a-glance passport for the loaded project that pulls
together everything the existing Intelligence foundations already report:
what the verified record supports, what it does not, how complete the data is,
where the gaps are, and one deterministic overall readiness verdict. It is the
top-of-workspace executive summary.

The Passport **aggregates existing verified information only**. It never invents
scores, averages scores, calculates new ratings, creates AI opinions, or
fabricates missing information. Anything that cannot be supported by verified
`ProjectDetail` data renders as **"Not available"**.

---

## 2. Architecture (mirrors the Intelligence foundations)

```
ProjectDetail
  ↓  project.trust (verified fields)        ─┐
  ↓  deriveInvestmentIntelligence()          │  consumed, never recalculated
  ↓  deriveRentalIntelligence()              │
  ↓  deriveLocationIntelligence()           ─┘
deriveForeverPassport()   ← this layer (pure, deterministic aggregation)
  ↓
<ForeverPassport data={…} />  (presentational only)
  ↓
Advisory Workspace (executive-summary section, top of workspace)
```

The Passport **consumes intelligence outputs instead of recalculating raw
`ProjectDetail`**. `deriveForeverPassport()` calls each foundation's own
derivation exactly once and reads only the verified `project.trust` fields for
the Trust summary. No derivation logic, rule, or data-shape is duplicated.

---

## 3. Required sections (all ten present)

| # | Section | Source | Behaviour |
|---|---|---|---|
| 1 | **Project Identity** | `core.*`, `developer.name` | Verbatim verified identity; missing → `NOT_AVAILABLE` |
| 2 | **Trust Intelligence Summary** | `project.trust` | Verification status, verdict, market position, inspection, note — evidence only |
| 3 | **Investment Intelligence Summary** | `deriveInvestmentIntelligence()` | Foundation verdict + headline evidence + gaps |
| 4 | **Rental Intelligence Summary** | `deriveRentalIntelligence()` | Foundation verdict + headline evidence + gaps |
| 5 | **Location Intelligence Summary** | `deriveLocationIntelligence()` | Foundation verdict + headline evidence + gaps |
| 6 | **Overall Data Completeness** | aggregated signals | Count of present evidence signals (presence, not quality) |
| 7 | **Combined Key Data Gaps** | union of foundation gaps | Domain-prefixed, deterministically ordered |
| 8 | **Overall Advisory Readiness Verdict** | four foundation verdicts | Deterministic: the most conservative of the four |
| 9 | **Evidence Coverage Summary** | per-foundation signals | Readiness + signal coverage + source per foundation |
| 10 | **Passport Metadata** | static + record | Versions, provenance, verified dates; timestamp never invented |

---

## 4. Anti-fabrication contract

The Passport enforces the strict rules structurally (locked down by the module
tests):

1. **No new scoring engine.** The Passport never invents, averages, or
   calculates a score, rating, yield, ROI, or any numeric quality metric.
2. **Aggregation only.** Investment / Rental / Location facts come exclusively
   from the existing derivation layers; Trust facts come exclusively from the
   verified `project.trust` fields. Nothing is recalculated.
3. **`trust.trustScore` is never surfaced or reused** as any passport score —
   consistent with all three foundations. The Passport carries no numeric score
   field of its own (`overallScore` / `score` do not exist on it).
4. **Missing data → `NOT_AVAILABLE`.** The shared sentinel is reused verbatim
   from the Investment Intelligence module, so every layer renders identically.
5. **The overall verdict is deterministic** (see §6) — no averaging, no new
   rule, no AI opinion, no recommendation unsupported by evidence.
6. **Overall Data Completeness is a data-presence measure, not a rating.** It
   counts how many verified evidence signals are present across all four
   foundations (23 total: 5 trust + 6 investment + 6 rental + 6 location). It
   never expresses, and never implies, a judgement of quality.
7. **The generation timestamp is never computed internally.** It is surfaced
   only when the caller supplies it, keeping the derivation pure and
   deterministic; otherwise it reads `NOT_AVAILABLE`.

---

## 5. Trust readiness (deterministic, evidence-only)

Trust has no separate advisory derivation layer, so the Passport derives a Trust
**summary** directly from the verified `project.trust` fields — surfaced as
status/evidence only, mirroring the foundation verdict pattern exactly:

- **Foundational** (both required to leave `Insufficient verified data`):
  Forever verification (`foreverVerified === true`) · Forever verdict.
- **Depth**: market position · last inspection · trust note.
- Rules, in order:
  1. Any foundational missing → `Insufficient verified data`.
  2. Both foundational present AND ≥ 2 depth signals → `Ready for preliminary review`.
  3. Both foundational present AND < 2 depth signals → `More evidence required`.

---

## 6. Overall Advisory Readiness Verdict (deterministic)

All four foundations report on the **same** three-level readiness scale
(`Insufficient verified data` < `More evidence required` < `Ready for
preliminary review`). The overall verdict is the **single most conservative
(lowest)** of the four foundation verdicts:

```
overall = min(trust, investment, rental, location)   // by the shared ordinal scale
```

Nothing is averaged; no new rule is introduced. The rationale enumerates each
foundation's verdict so the result is fully explainable and directly testable.

---

## 7. Structure

```
src/features/advisory/
  forever-passport.ts                    # deriveForeverPassport() — pure, deterministic
  components/
    ForeverPassport.tsx                  # presentational executive-summary section
  tests/
    forever-passport.test.ts             # derivation unit tests (14)
    ForeverPassportSection.test.tsx      # component + integration tests (8)
docs/
  FOREVER_PASSPORT_RC2_4.md              # this file
```

Data flow (identical shape to the Intelligence foundations):

```
ProjectDetail ─▶ deriveForeverPassport() ─▶ ForeverPassport ─▶ <ForeverPassport data={…} />
   (verified)      (pure aggregation)         (evidence-only)        (presentational only)
```

---

## 8. Integration

`AdvisoryWorkspace` gains one **optional** prop, mirroring the foundation props:

```tsx
<AdvisoryWorkspace
  session={session}
  passport={passport}
  investmentIntelligence={investmentIntelligence}
  rentalIntelligence={rentalIntelligence}
  locationIntelligence={locationIntelligence}
/>
```

When present, the Forever Passport renders as the **executive-summary section at
the top of the workspace** (directly after the header); when absent, it is
simply not rendered. The `/advisory` route derives it from the loaded project
via `deriveForeverPassport(project)`, reusing the already-loaded `ProjectDetail`
for the canonical `the-modeva-bang-tao` slug. All existing sections and call
sites are unchanged.

---

## 9. Public API (`@/features/advisory`)

```ts
import {
  ForeverPassport,          // presentational component
  deriveForeverPassport,    // pure aggregation entry point
} from "@/features/advisory";

import type {
  ForeverPassportData,      // the derived view model
  DeriveForeverPassportOptions,
  PassportReadinessVerdict,
  PassportProjectIdentity,
  PassportTrustSummary,
  PassportInvestmentSummary,
  PassportRentalSummary,
  PassportLocationSummary,
  PassportDataCompleteness,
  PassportCombinedGaps,
  PassportOverallVerdict,
  PassportEvidenceCoverage,
  PassportMetadata,
  ForeverPassportProps,
} from "@/features/advisory";
```

`NOT_AVAILABLE` is shared with the Investment Intelligence module (a single
exported sentinel — not redefined).

> Note: this is distinct from the pre-existing score-based passport in
> `src/features/passport/` (the `intelligence-engine` scoring artefact). The
> RC2.4 Forever Passport is the **evidence-only** executive summary of the
> Advisory Workspace and deliberately introduces no scoring.

---

## 10. Known data gaps (verified Modeva seed)

The canonical Modeva record (`the-modeva-bang-tao`) is verified but sparse:
identity (name, slug, type, location, ownership, construction status,
developer) and Forever verification are present, but most investment, rental,
occupancy, income, guarantee, and richer location fields are empty. The Passport
therefore surfaces the recorded identity, reports each foundation's conservative
readiness verdict, combines the per-foundation gaps, reports the data-presence
completeness count, and returns the most conservative overall verdict — without
inventing any missing figure or score.

---

## 11. Scope boundaries honoured

- **No Supabase schema / migration / database change.** Reads existing fields only.
- **No new scoring engine.** No score is invented, averaged, or calculated.
- **No duplicated derivation, rule, or logic** — the foundations are consumed.
- **Import Engine, Navigator, Discovery, the score-based `features/passport`,
  Project Detail architecture, Investment/Rental/Location logic, scoring
  engines, AI integrations, unrelated UI:** untouched.
- **Additive only** — new files plus one optional prop, barrel exports, and the
  route wiring. All existing functionality is preserved.
- No new brand accents; the frozen Forever palette is reused.

---

## 12. Validation

- `npm ci`: clean install.
- Focused Passport tests (`vitest run … forever-passport … ForeverPassportSection`):
  22 tests pass (14 derivation + 8 section/integration).
- `npm test` (`vitest run`): full suite passes.
- `npx tsc --noEmit`: clean.
- ESLint on changed files: clean.
- `npm run build`: succeeds.
- `git diff --check`: clean.
