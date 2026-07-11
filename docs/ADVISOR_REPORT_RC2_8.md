# RC2.8 — Forever Advisor Report

> The **presentation and composition layer** for Forever Advisor. It composes the
> already-derived Advisory outputs into one professional, client-facing,
> **print-ready** advisory report. It is **not** a new scoring engine, **not** a
> new intelligence foundation, **not** a new recommendation engine, and **not** a
> place to recalculate existing conclusions. Every substantive statement is
> traceable to an existing project fact or a previously derived Advisory output.

---

## 1. Purpose

Give an advisor a single, coherent, printable document that presents a project's
verified evidence and the conclusions Forever has already derived, suitable for
sharing with a client and for **browser printing / Save as PDF**.

The report answers, in order:

- **Is this project ready for review?** — the Forever Passport readiness verdict,
  reused verbatim.
- **What is it, and what is verified?** — Passport identity + Project Summary key
  facts, surfacing only verified values.
- **What stands out, and what to weigh?** — Project Summary strengths and
  considerations.
- **Who is it suitable for?** — the Project Summary buyer-profile output (never an
  invented persona).
- **What do the Intelligence foundations show?** — the derived Investment, Rental
  and Location outputs, reused verbatim (no ROI, yield, occupancy, nightly rate or
  distance is ever recalculated).
- **How trustworthy is the evidence?** — the Passport Trust summary (never the
  hidden numeric `trustScore`).
- **How does it compare, and how is it ranked?** — the RC2.6 Project Comparison
  and RC2.7 Project Recommendations, when present, reused without recalculation or
  reordering.
- **What is missing, and what are the limits?** — the deduplicated Passport +
  Summary data gaps and a restrained advisory disclaimer.

---

## 2. Architecture (a composition layer over the derived outputs)

```
ProjectDetail
  → deriveInvestmentIntelligence()   (RC2.1)
  → deriveRentalIntelligence()       (RC2.2)
  → deriveLocationIntelligence()     (RC2.3)
  → deriveForeverPassport()          (RC2.4)
  → deriveProjectSummary()           (RC2.5)
  → deriveProjectComparison()?       (RC2.6, optional)
  → deriveProjectRecommendations()?  (RC2.7, optional)
        ↓
  deriveAdvisorReport()  ← pure, deterministic composition
        ↓
  <AdvisorReport />      ← print-ready UI (browser print flow)
```

`deriveAdvisorReport` **consumes** the derived outputs; it never re-implements
Passport, Summary, Comparison, Recommendation or any Intelligence / Trust logic.

### Files

| File | Role |
| --- | --- |
| `src/features/advisory/advisor-report.ts` | Pure `deriveAdvisorReport` derivation + types. |
| `src/features/advisory/components/AdvisorReport.tsx` | Print-ready report component. |
| `src/routes/advisory.report.tsx` | Isolated `/advisory/report` route wiring. |
| `src/features/advisory/tests/advisor-report.test.ts` | Derivation tests. |
| `src/features/advisory/tests/AdvisorReport.test.tsx` | Component + Workspace-regression tests. |

The component **reuses** the existing `InvestmentIntelligence`, `RentalIntelligence`,
`LocationIntelligence`, `ProjectComparison` and `ProjectRecommendations` section
components rather than re-rendering their content.

---

## 3. Derivation contract

```ts
deriveAdvisorReport({
  project,          // ProjectDetail
  passport,         // ForeverPassport            (RC2.4, required)
  summary,          // ProjectSummary             (RC2.5, required)
  investment,       // InvestmentIntelligence     (RC2.1, required)
  rental,           // RentalIntelligence         (RC2.2, required)
  location,         // LocationIntelligence       (RC2.3, required)
  comparison?,      // ProjectComparison          (RC2.6, optional)
  recommendations?, // ProjectRecommendations     (RC2.7, optional)
  generatedAt?,     // string, surfaced verbatim only when supplied
}): AdvisorReport
```

Guarantees:

- **No new score** — the report adds no numeric quality or match score. The only
  score fields carried through are the foundations' own `NOT_AVAILABLE` sentinels.
- **No new verdict** — the readiness verdict is the Passport's, reused verbatim.
- **No new ranking** — recommendation ordering is the RC2.7 order, untouched.
- **No hidden trust score** — the report carries the Passport Trust summary, which
  never contains `trustScore`; the raw numeric value never appears anywhere.
- **No fabricated facts / metrics** — nothing is invented or recalculated;
  anything not on record renders as the shared `"Not available"` convention.
- **Deterministic** — identical input yields identical output. The report date is
  never computed internally; `reportDate` / `metadata.generatedAt` appear **only**
  when `generatedAt` is supplied, and are entirely absent otherwise.
- **Optional sections stay absent** — `comparison` / `recommendations` (and their
  `sections` entries) are present only when their data is supplied.
- **Data limitations** are the case-insensitive, first-seen-order **deduplication**
  of the Passport combined gaps and the Summary data limitations — no new gap is
  invented.

Section order (the `sections` array is the single source of truth):

```
cover · executive-overview · identity · strengths · considerations ·
buyer-profile · investment · rental · location · trust ·
[comparison] · [recommendations] · data-limitations · disclaimer
```

---

## 4. Print / PDF behaviour

- A single **"Print / Save as PDF"** action calls the browser's own
  `window.print()` — no heavy PDF-generation dependency is added.
- Interactive controls carry the `advisor-report__noprint` class and are hidden
  under `@media print`.
- A local print stylesheet sets `@page { size: A4; margin: 16mm; }`, forces a
  white background, and applies `break-inside: avoid` to each major section so
  sections are not split across pages where reasonably possible.
- Headings are accessible and hierarchical: a single `<h1>` on the cover and
  `<h2>` section headings, each `aria-labelledby` its heading.

---

## 5. Scope & isolation

- Delivered under `src/features/advisory/**` plus one isolated route
  (`/advisory/report`). The existing Advisory Workspace (`/advisory`) is
  **unchanged** — the report is a separate view, not injected into the Workspace.
- No changes to the Supabase schema, migrations, import engine, scoring engine, or
  any existing Intelligence / Passport / Summary / Comparison / Recommendation
  derivation.

---

## 6. Tests

`advisor-report.test.ts` and `AdvisorReport.test.tsx` cover: complete report;
partial project data; missing optional sections; Passport verdict reused verbatim;
Summary facts reused; Comparison reused without recalculation; Recommendations
reused without reordering; hidden `trustScore` absent; no fabricated numeric score;
no fabricated financial metric; `"Not available"` convention; `generatedAt` only
when supplied; deterministic output; print action exists; print-only / screen-only
behaviour; correct section ordering; no promotional wording; and no regression to
the Advisory Workspace.
