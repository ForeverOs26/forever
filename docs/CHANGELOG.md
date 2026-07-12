# Changelog

## v0.1.0

- FDB-001 completed.
- FDB-002 completed for Modeva import foundation and validation.
- FDB-003A completed: Forever Import Engine v1 created.
- FDB-003B completed: Modeva dry-run passed.
- FDB-003C completed: Modeva real import/idempotency test passed.
- RC3-001 completed: Import Engine architecture skeleton added with explicit import plans, relationship validation, rollback contract, and state machine.
- RC3-002 completed: first Project-only import stage added with Coralina dry-run blocked safely by readiness validation.
- RC3-003 completed: Buildings-only Import Engine stage added after Project for source-backed dry-run planning.
- RC3-004 completed: Canonical Unit Import dry-run stage added after Buildings.
- RC3-005 completed: Price History dry-run import stage added after Units.
- FDM-001 completed.
- FDM-002 completed.
- RC2.5 completed: Advisory Project Summary — a concise, evidence-only executive summary that summarises the verified project data and the already-derived Forever Passport and Intelligence outputs, with no new scoring engine.
- RC2.6 completed: Advisory Project Comparison — the first comparison engine, a descriptive, evidence-only comparison of two projects built on top of the already-derived Forever Passport and Project Summary, with no new scoring engine, ranking, or fabricated values.
- RC2.7 completed: Advisory Project Recommendations — an evidence-only recommendation layer that ranks the available projects using the already-derived Forever Passport, Project Summary and Project Comparison. Ordering is a deterministic sort over documented readiness stage, present verified evidence-signal counts, and recorded data-gap counts only; it introduces no new scoring engine or match score, duplicates no derivation logic, fabricates no values, uses no marketing language, and renders missing data as "Not available".
- RC5.1 completed: Project Knowledge Platform — the RC5.0 Coralina vertical slice generalised into a project-agnostic engine (`forever-project-knowledge`): a declarative `ProjectKnowledgeDefinition` (sources, verbatim facts, declared gaps, graph declarations, readiness profile — statements only) run through the RC4.4–RC4.9 foundation chain by one shared orchestration. Coralina re-stated as a definition with all 61 RC5.0 tests passing unchanged; Modeva onboarded as the second real project purely from committed artifacts (FDB-001 seed migration, FDB-002C reviewed price-list import, FDB-003C real-run report) with an honestly BLOCKED intake verdict (no committed brochure); one generic internal inspection route `/internal/projects/$slug` serving every catalogued project. See `docs/RC5_1_PROJECT_KNOWLEDGE_PLATFORM.md`.
- RC2.8 completed: Advisory Advisor Report — a professional, client-facing, print-ready advisory report that composes the already-derived Forever Passport (RC2.4), Project Summary (RC2.5), Investment / Rental / Location Intelligence (RC2.1–RC2.3) and, when present, Project Comparison (RC2.6) and Project Recommendations (RC2.7) into one coherent document. It is a pure, deterministic presentation-and-composition layer: it adds no new score, verdict, ranking, persona or financial metric, never recalculates existing conclusions, never exposes the hidden numeric trustScore, and renders missing data as "Not available". Optional sections stay absent when their data is unavailable, the report date appears only when explicitly supplied, and printing uses the browser's own print flow (Print / Save as PDF) with no heavy PDF dependency. Delivered as an isolated `/advisory/report` route; the existing Advisory Workspace is unchanged.

## Notes

- FDB-001 added the Forever Core Database foundation as additive Supabase migrations.
- FDB-002 established Modeva extraction, unit import prerequisites, import migration, and validation.
- FDB-003 created the reusable Import Engine and proved Modeva remains idempotent at 7 buildings, 289 units, and 289 price history rows with no duplicates.
- RC3-001 hardened the Import Engine boundary around manifest validation, extracted dataset loading, import planning, relationship validation, dry-run safety, rollback preparation, and database insertion separation.
- RC3-002 loads Coralina extracted datasets, creates a canonical internal Project object only after readiness passes, returns a blocked summary when readiness fails, and does not import units, buildings, media, relationships, Intelligence, or Passport data.
- RC3-003 derives canonical Building objects from source-backed price-list building facts, appends Building operations after Project in dry-run plans, keeps Units and Prices at zero, and leaves Coralina blocked until readiness blockers are resolved.
- RC3-004 loads `extracted/unit-plans.json`, creates canonical Unit operations after Buildings, keeps Prices at zero, blocks execute mode, plans Modeva as Project + 7 Buildings + 289 Units, and leaves Coralina blocked until readiness blockers are resolved.
- RC3-005 derives canonical Price History operations from source-backed price-list rows after Units, validates unit references, numeric prices, price dates, currency presence or explicit null warnings, and duplicate source keys, blocks execute mode, plans Modeva as Project + 7 Buildings + 289 Units + 289 Price History rows, and leaves Coralina blocked until readiness blockers are resolved.
- FDM-001 created the Modeva source material folder structure.
- FDM-002 created the Forever project import manifest standard.
