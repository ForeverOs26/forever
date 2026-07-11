# RC2.6 — Project Comparison

> The first **comparison engine** for Forever Advisor. It compares **two**
> projects using **already-verified evidence only**. It is **not** a new
> intelligence foundation and **not** a new scoring engine — it is a thin,
> descriptive comparison layer built on top of the already-derived Forever
> Passport and Project Summary. It calculates **no** new score, rating, ranking,
> or tie-breaker, duplicates **no** derivation logic, and surfaces only verified
> information.

---

## 1. Purpose

Let an advisor compare two projects side by side, answering:

- **What is different?** — field-level status per domain (identical / different /
  present-in-A / present-in-B / absent-in-both).
- **What is stronger / weaker?** — expressed strictly as data coverage: more
  verified evidence signals on record, fewer recorded data gaps, or further along
  the documented advisory readiness scale. Never a quality score.
- **Where is evidence missing?** — the combined key data gaps of both projects,
  compared as a set.
- **Which buyer profile suits each project?** — reuses only the existing
  Project Summary buyer-profile output.
- **Which project currently has stronger decision readiness?** — reuses the
  Passport overall readiness verdict; the "lead" is the side further along the
  documented, public readiness scale.

Anything not supported by verified data renders as the shared **"Not available"**
convention.

---

## 2. Architecture (a comparison layer on top of the Passport + Summary)

```
Project A ─┐
           ├─→ deriveForeverPassport() → deriveProjectSummary()
Project B ─┘
                    ↓
             deriveProjectComparison()   ← this layer (pure, deterministic)
                    ↓
             <ProjectComparison data={…} />  (presentational only)
                    ↓
             Advisory Workspace
             (Forever Passport → Project Summary → Project Comparison → Detailed Intelligence)
```

The comparison **consumes existing derived outputs** — the Forever Passport
(RC2.4) and the Project Summary (RC2.5) for each side. When those optional inputs
are omitted, the canonical `deriveForeverPassport` / `deriveProjectSummary`
derivations are reused (never re-implemented), so the comparison always reflects
the same evidence the rest of the workspace shows. No existing derivation logic
is duplicated or replaced.

---

## 3. Derivation contract

`deriveProjectComparison({ a, b, generatedAt? })` is a **pure, deterministic**
function. Each side is `{ project, passport?, summary? }`.

- **Reuses** the already-derived Forever Passport and Project Summary. Missing
  `passport` / `summary` are derived via the canonical functions.
- **Never recalculates verdicts.** Decision readiness is the Passport overall
  verdict, verbatim — there is no second readiness engine.
- **Never fabricates and never ranks by a hidden value.** No new score, rating,
  ranking, tie-breaker, ROI, yield, appreciation, occupancy, or location metric
  is produced. No qualitative verdict is converted into a number. The hidden
  numeric `trust.trustScore` is never surfaced or reused.
- **Descriptive comparison only.** The only comparative statements made are
  grounded in (a) the documented, public readiness scale, (b) counts of present
  evidence signals (data presence, never quality), and (c) counts of recorded
  data gaps. Data coverage never implies quality — every coverage note says so.
- **Deduplicates** strengths, considerations, buyer-profile notes, and gaps
  case-insensitively into disjoint shared / only-A / only-B buckets, preserving a
  stable, deterministic order.
- **Handles partial data safely** — absent fields surface as "Not available" and
  are marked `present-in-a` / `present-in-b` / `absent-in-both`.
- **Deterministic timestamp.** The only non-deterministic value — the generation
  timestamp — is never computed internally; it is surfaced only when the caller
  supplies `generatedAt`, otherwise it is `"Not available"`.

---

## 4. Output object

`ProjectComparison` contains exactly the required sections:

1. **Compared projects** — identity of A and B, reused from the Passport.
2. **Passport comparison** — overall readiness verdicts, evidence-signal presence,
   and combined data-gap set-diff.
3. **Investment comparison** — entry price, price verification, rental evidence,
   investment readiness.
4. **Rental comparison** — demand, income evidence, guarantee, rental readiness.
5. **Location comparison** — location, beach proximity, lifestyle, readiness.
6. **Trust comparison** — verification status, verdict, market position,
   last inspection, trust readiness.
7. **Strength comparison** — shared / only-A / only-B verified strengths.
8. **Consideration comparison** — shared / only-A / only-B considerations.
9. **Buyer profile comparison** — availability flags + shared / only-A / only-B
   suitability notes, reused from the Project Summary.
10. **Decision readiness comparison** — the Passport overall verdict per side plus
    a descriptive "lead" on the documented readiness scale.
11. **Evidence completeness comparison** — per-foundation and overall counts of
    present evidence signals (data coverage only, not quality).

A descriptive `headline` restates the readiness, coverage, gap, and difference
counts in plain language.

---

## 5. Anti-fabrication guarantees

- No new score, rating, ranking, tie-breaker, or numeric quality metric.
- No ROI, yield, appreciation, rental-income, or occupancy estimate.
- The hidden `trust.trustScore` is never surfaced or reused.
- "Stronger" / "weaker" is only ever data coverage — more verified evidence,
  fewer recorded gaps, or a further readiness stage — and every coverage note
  states that it reflects data presence, not quality.
- Strengths and considerations are compared only from the already-verified
  Project Summary outputs; no risk or strength is invented.
- The buyer profile reuses only the existing buyer-profile output and never
  invents a demographic persona.
- Missing information renders through the shared **"Not available"** convention.
- No promotional or sales language (asserted in the tests).

---

## 6. UI

`<ProjectComparison data={…} />` is presentational only and renders directly
beneath the Project Summary and above the detailed Intelligence foundations. It
is **optional**: when fewer than two projects are available the advisory route
supplies no comparison and the section is simply not rendered — existing Advisory
behaviour is unchanged. It never replaces the Forever Passport, the Project
Summary, or the detailed Intelligence sections.

---

## 7. Scope

Changes are confined to `src/features/advisory/**`, the advisory route wiring,
advisory-specific tests, advisory barrel exports, and this document. No changes
to Supabase, the database schema, migrations, the import engine, the scoring
engine, the Navigator, Discovery, or the existing
Trust/Investment/Rental/Location derivations, Forever Passport, or Project
Summary.

---

## 8. Tests

`src/features/advisory/tests/project-comparison.test.ts` and
`src/features/advisory/tests/ProjectComparisonSection.test.tsx` cover: identical
projects; different projects; missing fields; a missing (unsupplied) Passport;
a missing (unsupplied) Summary; no fabricated values; no numeric score; no
duplicate comparison entries (unique row keys, disjoint set-diff buckets);
deterministic ordering; optional rendering; correct placement in the Advisory
Workspace; and no regression to the existing Advisory sections.
