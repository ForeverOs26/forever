# RC2.7 — Project Recommendations

> The **recommendation layer** for Forever Advisor. It ranks a set of projects
> using **already-verified evidence only**. It is **not** a new intelligence
> foundation and **not** a new scoring engine — it is a thin, descriptive
> recommendation layer built on top of the already-derived Forever Passport
> (RC2.4), Project Summary (RC2.5) and Project Comparison (RC2.6). It calculates
> **no** match score, rating, or ranking value, duplicates **no** derivation
> logic, and surfaces only verified information.

---

## 1. Purpose

Let an advisor see, at a glance, which of the available projects currently carry
the strongest **verified evidence coverage**, answering:

- **Which project is the leading candidate?** — the one furthest along the
  documented advisory readiness scale, with the most present verified evidence
  signals and the fewest recorded data gaps.
- **Why is each project ranked where it is?** — a controlled, evidence-only
  rationale grounded in the reused readiness verdict and the present-evidence /
  recorded-gap counts.
- **What are each project's strengths, considerations and suitable buyer
  profile?** — reused verbatim from the already-derived Project Summary.
- **How do the top two compare head-to-head?** — reuses the RC2.6 Project
  Comparison output for the two leading candidates.

The ranking reflects **data coverage and documented readiness only — never
project quality or suitability for any particular buyer**. Anything not supported
by verified data renders as the shared **"Not available"** convention.

---

## 2. Architecture (a recommendation layer on top of Passport + Summary + Comparison)

```
Project 1 ─┐
Project 2 ─┼─→ deriveForeverPassport() → deriveProjectSummary()
   …       ┘              ↓ (top two)
                   deriveProjectComparison()
                          ↓
             deriveProjectRecommendations()   ← this layer (pure, deterministic)
                          ↓
             <ProjectRecommendations data={…} />  (presentational only)
                          ↓
             Advisory Workspace
             (Passport → Summary → Comparison → Recommendations → …)
```

The recommendation **consumes existing derived outputs** — the Forever Passport
and the Project Summary for each candidate, and (for the top two) the Project
Comparison. When those optional inputs are omitted, the canonical
`deriveForeverPassport` / `deriveProjectSummary` / `deriveProjectComparison`
derivations are reused (never re-implemented), so the recommendation always
reflects the same evidence the rest of the workspace shows. No existing
derivation logic is duplicated or replaced.

---

## 3. Derivation contract

`deriveProjectRecommendations({ candidates, generatedAt? })` is a **pure,
deterministic** function. Each candidate is `{ project, passport?, summary? }`.

- **Reuses** the already-derived Forever Passport and Project Summary. Missing
  `passport` / `summary` are derived via the canonical functions.
- **Never recalculates verdicts.** Each entry's readiness is the Passport overall
  verdict, verbatim — there is no second readiness engine.
- **Never fabricates and never ranks by a hidden value.** No new score, rating,
  match score, ranking metric, ROI, yield, appreciation, occupancy, or
  buyer-match value is produced. No qualitative verdict is converted into a
  number. The hidden numeric `trust.trustScore` is never surfaced or reused. The
  `rank` field is an ordinal **position**, never divided by a total and never a
  percentage.
- **Descriptive ordering only.** The order is a deterministic sort over three
  already-derived, evidence-only measures: (a) the documented advisory readiness
  stage, (b) the count of present verified evidence signals (data presence, never
  quality), and (c) the count of recorded data gaps. Ties break on slug then name
  so identical input always yields identical output. Every rationale states that
  the order reflects data coverage, not quality.
- **Handles partial data safely** — absent fields surface as "Not available"; an
  empty candidate set yields an empty ranking, a `null` leading candidate, and no
  head-to-head comparison.
- **Deterministic timestamp.** The only non-deterministic value — the generation
  timestamp — is never computed internally; it is surfaced only when the caller
  supplies `generatedAt`, otherwise it is `"Not available"`.

---

## 4. Output object

`ProjectRecommendations` contains:

1. **`entries`** — the ranked candidates, best evidence coverage first. Each entry
   carries its ordinal `rank`, the reused Passport `identity`, the reused overall
   `readinessVerdict` + rationale, `coverage` counts (present signals, recorded
   gaps, foundations ready — all reused from the Passport), the reused Summary
   `strengths` / `considerations`, the reused Summary buyer-profile `suitability`,
   and a controlled evidence-only `rationale`.
2. **`topRecommendation`** — the rank-1 candidate (slug, name, position, note), or
   `null` when there are no candidates.
3. **`headline`** — descriptive statements restating the ranking in plain language.
4. **`comparison`** — the RC2.6 Project Comparison of the top two candidates,
   reused verbatim; `null` when fewer than two candidates exist.
5. **`basis`** — a controlled explanation of how the order is derived
   (evidence-only, deterministic, reused outputs).
6. **`metadata`** — provenance: schema/version, ranked slugs, candidate count, the
   consumed layers (`Forever Passport`, `Project Summary`, `Project Comparison`),
   and the caller-supplied `generatedAt` (or "Not available").

---

## 5. Anti-fabrication guarantees

- No new score, rating, match score, ranking metric, or numeric quality value.
- No ROI, yield, appreciation, rental-income, or occupancy estimate.
- The hidden `trust.trustScore` is never surfaced or reused.
- "Leading" / ordering is only ever data coverage — a further readiness stage,
  more present verified evidence, or fewer recorded gaps — and every rationale
  states that it reflects data coverage, not quality.
- Strengths, considerations and the buyer profile reuse only the already-verified
  Project Summary outputs; no strength, risk, or demographic persona is invented.
- Missing information renders through the shared **"Not available"** convention.
- No promotional or sales language (asserted in the tests).

---

## 6. UI

`<ProjectRecommendations data={…} />` is presentational only and renders directly
beneath the Project Comparison and above the client-facing advisory sections. It
is **optional**: when the advisory route supplies no recommendations the section
is simply not rendered — existing Advisory behaviour is unchanged. It never
replaces the Forever Passport, Project Summary, Project Comparison, or the
detailed Intelligence sections.

---

## 7. Scope

Changes are confined to `src/features/advisory/**`, the advisory route wiring,
advisory-specific tests, advisory barrel exports, and this document. No changes
to Supabase, the database schema, migrations, the import engine, the scoring
engine, the Navigator, Discovery, or the existing
Trust/Investment/Rental/Location derivations, Forever Passport, Project Summary,
or Project Comparison.

---

## 8. Tests

`src/features/advisory/tests/project-recommendations.test.ts` and
`src/features/advisory/tests/ProjectRecommendationsSection.test.tsx` cover:
evidence-coverage ordering independent of input order; deterministic slug/name
tie-breaking; non-mutation of the caller's array; verbatim reuse of the Passport
verdict, coverage counts, and Summary strengths/considerations/buyer-profile;
derivation of a missing Passport / Summary; reuse of the RC2.6 comparison for the
top two; the empty and single-candidate cases; missing fields rendered as "Not
available"; no fabricated values; no numeric score; no hidden trust score; no
promotional language; deterministic output and timestamp handling; correct
placement in the Advisory Workspace; optional rendering; and no regression to the
existing Advisory sections.
