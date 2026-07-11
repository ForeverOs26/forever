# RC2.5 — Project Summary

> A concise, **evidence-only** executive summary of the project inside the
> Advisory Workspace. It **summarises** the existing verified project data and
> the already-derived Advisory intelligence outputs (Trust, Investment, Rental,
> Location) and the **Forever Passport** (RC2.4). It is **not** a new scoring
> system, **not** a new intelligence foundation, and **not** a marketing
> description. It introduces **no new scoring engine**, duplicates no derivation,
> and surfaces only verified information.

---

## 1. Purpose

Help an advisor or client understand the project quickly — without reading every
Intelligence foundation individually. The summary pulls together, in one
restrained section:

1. **Executive overview** — controlled, factual sentence + the main
   evidence-backed signals per domain.
2. **Key project facts** — present-only verified fields.
3. **Principal strengths** — aggregated evidence-backed strengths, deduplicated.
4. **Principal considerations** — evidence-backed cautions, deduplicated, never
   exaggerated.
5. **Suitable buyer profile** — evidence-linked suitability notes only; no
   fabricated demographic persona.
6. **Decision readiness** — the Forever Passport readiness verdict, reused
   verbatim.
7. **Data limitations** — the deduplicated union of the foundations' data gaps.

Anything not supported by verified data renders as the shared **"Not
available"** convention.

---

## 2. Architecture (one layer above the Passport)

```
ProjectDetail
  ↓  project.trust (verified fields, via the Passport)      ─┐
  ↓  deriveInvestmentIntelligence()                          │  consumed,
  ↓  deriveRentalIntelligence()                              │  never
  ↓  deriveLocationIntelligence()                            │  recalculated
deriveForeverPassport()                                     ─┘
  ↓
deriveProjectSummary()   ← this layer (pure, deterministic summarisation)
  ↓
<ProjectSummary data={…} />  (presentational only)
  ↓
Advisory Workspace  (Forever Passport → Project Summary → Intelligence foundations)
```

The data flow is preserved exactly. The Project Summary **consumes existing
project facts and existing derived outputs** — the Forever Passport is its
primary source, and the Intelligence foundation outputs supply the per-domain
evidence signals. No existing derivation logic is duplicated or replaced.

---

## 3. Derivation contract

`deriveProjectSummary({ project, passport, investment?, rental?, location?,
generatedAt? })` is a **pure, deterministic** function:

- **Reuses** the already-derived Forever Passport and the Intelligence
  foundation outputs. When the optional `investment` / `rental` / `location`
  outputs are omitted, the existing `derive*Intelligence` functions are reused
  (never re-implemented) so the canonical derived output is always the source.
- **Never recalculates verdicts.** Decision readiness is the Passport overall
  verdict, verbatim — there is no second readiness engine.
- **Never fabricates.** No new ROI, yield, appreciation, occupancy, liquidity,
  or location metric is derived. No qualitative verdict is converted into a
  number. The hidden numeric `trust.trustScore` (and every foundation score
  sentinel) is never surfaced or reused.
- **Deduplicates** strengths, considerations, and data gaps case-insensitively,
  preserving a stable, deterministic domain order (trust → investment → rental →
  location).
- **Handles partial data safely** — absent fields drop out of the key facts and
  surface in the data-limitations union instead.
- **Deterministic timestamp.** The only non-deterministic value — the generation
  timestamp — is never computed internally; it is surfaced only when the caller
  supplies `generatedAt`, otherwise it is `"Not available"`.

### Deduplication detail

Semantically-equal gaps surfaced by different foundations collapse to one. For
example the Investment "Rental / income evidence" gap and the Rental "Rental
income evidence" gap canonicalise to a single "Rental income evidence" data
limitation. Likewise, when both the Investment and Rental foundations report
rent evidence, the single "Rental income evidence on record." strength appears
once.

---

## 4. Anti-fabrication guarantees

- No new score, rating, or numeric quality metric is ever produced.
- The hidden `trust.trustScore` is never surfaced or reused.
- No ROI, yield, appreciation, occupancy, liquidity, or location metric is
  derived.
- No qualitative verdict is converted into an artificial numeric rating.
- Missing information renders through the shared **"Not available"** convention.
- Every statement is traceable to verified project data or an existing derived
  Advisory output.
- No promotional or sales language is used (asserted in the tests).
- The suitable buyer profile never invents a demographic persona and never
  claims universal suitability; when no evidence supports it, it renders as
  unavailable.

---

## 5. UI

`<ProjectSummary data={…} />` is presentational only and renders directly
beneath the Forever Passport and above the detailed Intelligence foundations. It
is **optional**: when no summary data is supplied the section is not rendered and
existing Advisory behaviour is unchanged. It never replaces the Forever Passport
or the detailed Intelligence sections.

---

## 6. Scope

Changes are confined to `src/features/advisory/**`, the advisory route wiring,
advisory-specific tests, advisory barrel exports, and this document. No changes
to Supabase, the database schema, migrations, the import engine, the scoring
engine, the existing Trust/Investment/Rental/Location derivation logic, the
pre-existing score-based `src/features/passport` module, the Navigator, or
Discovery.

---

## 7. Tests

`src/features/advisory/tests/project-summary.test.ts` and
`src/features/advisory/tests/ProjectSummarySection.test.tsx` cover: complete,
partially populated, and absent-field records; no fabricated values; no new
numeric score; reuse of the Passport readiness verdict; stable deterministic
output; deduplication of strengths, considerations, and data gaps; optional
rendering behaviour; correct placement in the Advisory Workspace; no regression
to the existing Intelligence sections; and controlled executive-summary wording.
