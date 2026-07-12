# RC5.1 — Project Knowledge Platform

Task ID: RC5.1

Date: 2026-07-12

Status: Architectural report for the RC5.1 change

## Summary

RC5.1 turns the RC5.0 Coralina vertical slice from a one-project demo into a
project-agnostic platform capability, and proves it by onboarding a second
real project (Modeva) as pure data.

- New engine module `src/features/forever-project-knowledge`: a declarative
  `ProjectKnowledgeDefinition` (sources, facts, gaps, graph declarations,
  readiness profile — statements only) plus one generic orchestration,
  `buildProjectKnowledgeSlice`, that runs any definition through the
  RC4.4–RC4.9 foundation chain, and one generic inspection view + page.
- `coralina-knowledge` (RC5.0) now states its data as
  `CORALINA_KNOWLEDGE_DEFINITION` and delegates to the engine. Its public
  API, judgements, and artifacts are unchanged — all 61 RC5.0 tests pass
  without modification, and a golden-pin suite holds the concrete RC5.0
  artifact values in place (see "Adversarial review" for the two deliberate
  wording generalisations).
- New `src/features/modeva-knowledge`: Modeva stated as a definition, built
  exclusively from committed repository artifacts (the FDB-001 canonical
  seed migration, the FDB-002C reviewed price-list import migration, and the
  FDB-003C real-run verification report).
- New generic internal route `/internal/projects/$slug` serving every
  catalogued project (`coralina`, `modeva`); `/internal/coralina` keeps its
  URL and behaviour, its loader now served through the same catalog cache.

## Why this step (and not another foundation)

The study of the repository before this change found:

1. The RC4.4–RC4.9 foundations are complete, connected, pure, and heavily
   tested (they form a single dependency chain: sources → extraction →
   database → cross-validation → knowledge-graph → readiness). Nothing in
   the chain is missing for the current stage. A seventh foundation would
   add architecture with no additional consumer — the exact
   "isolated foundation" anti-pattern this step was instructed to avoid,
   and the pattern the repository audits already flagged
   (`docs/REPOSITORY_HEALTH_REVIEW.md`, `CODEX_REPOSITORY_AUDIT.md`).
2. The chain had exactly ONE consumer: `coralina-knowledge`, which was 100%
   hardcoded to Coralina. Onboarding any second project meant copying the
   whole module — orchestration included. The missing architecture was not
   another foundation; it was the seam that makes a project DATA instead of
   CODE.
3. The platform vision ("One Engine, Many Interfaces",
   `docs/FOREVER_BRAIN_V1.md`) and the audits' open question ("second-project
   repeatability is unproven") both point at the same next step: make the
   engine generic and run a second real project through it.

Alternatives considered and rejected:

- **Another foundation (RC5.x)** — rejected: no consumer, deepens the
  orphaned-tower pattern; the chain already covers intake source →
  readiness.
- **Wiring the chain into the public product pages** — rejected for now: the
  live pages are Supabase-backed at runtime; the chain is pure and works
  over committed statements with provenance. Bridging live database rows
  (which carry no evidence/locator provenance) into extraction facts would
  either fabricate provenance or require a new persistence layer — a larger,
  riskier step that becomes NATURAL once multiple projects flow through the
  generic engine. The generic route is the stepping stone.
- **Onboarding rainpalm / gardens-of-eden** — rejected: their
  `database/projects/*/README.md` templates are blank. There is no committed
  source data, so a knowledge definition for them could only be fabricated,
  which `docs/DATA_STANDARD.md` forbids ("Absent facts must remain absent").
- **Import Engine hardening (the FOREVER_BRAIN RC4/RC5 track)** — deferred,
  not rejected: it needs a live Supabase connection to validate and is
  orthogonal to the foundation chain this task was asked to build on.

Modeva was chosen as the second project because it is the only other project
with real, committed, source-backed data: the canonical seed migration
(developer Title, Bang Tao/Thalang/Phuket/Thailand, Condominium, Freehold,
Planning), the reviewed price-list import migration (289 unit rows with
per-row provenance, buildings A–G, THB, price-list date 2026-07-03), and the
FDB-002D/FDB-003C verification reports.

## Architecture

```
ProjectKnowledgeDefinition          (stated per project — data, not code)
  identity, sources, planTargets,
  facts, gaps, entities, relations,
  readinessProfile, provenance, copy
        │
        ▼
buildProjectKnowledgeSlice          (engine — the RC5.0 orchestration, generalised)
  RC4.4 register sources → RC4.5 plans+facts → RC4.7 validation
  → admissibility routing → RC4.6 merge/record/snapshot/timeline
  → RC4.8 graph → RC4.9 readiness
        │
        ▼
describeProjectKnowledgeInspection  (serialisable view-model + stated copy)
        │
        ▼
ProjectKnowledgePage                (one presentational page for all projects)
        │
        ▼
/internal/projects/$slug            (generic route; catalog lazy-loads definitions)
```

Design rules the engine preserves from RC5.0:

- **Statements vs judgements.** The definition carries only statements;
  consensus, standings, admissibility, and verdicts come exclusively from
  the foundations. The engine's only caller-side act is the RC4.7-defined
  routing: non-admissible facts are withheld from the canonical record and
  reported, never silently resolved or dropped.
- **Anti-fabrication, structurally.** A value the sources do not state gets
  no fact — it goes in `gaps`, and `validateProjectKnowledgeDefinition`
  reports a path that is both stated and declared missing.
- **Determinism.** Caller-stated clocks, no I/O; the same definition yields
  deep-equal slices on every build.
- **Code-splitting.** The catalog lazy-imports each definition; the barrel
  exports neither the catalog nor the page component, so the foundation
  chain stays out of the shared client bundle (same posture as RC5.0's
  route).

### The Modeva definition's honesty posture

Modeva has no committed developer package (`forever-data/projects/modeva/`
was never committed). Its definition therefore registers the repository's own
canonical artifacts as sources and states only what they literally state:

- Confidence is a documented policy, not per-fact invention: seed-only facts
  are `medium` (the seed records "Awaiting full Forever inspection data");
  reviewed-import and observed-run facts are `high`.
- The seed's placeholder strings (trust score 0, "Under Review", empty
  display fields) are NOT facts; the corresponding paths are declared gaps.
- Corroboration is only claimed where two artifacts independently state the
  same value (project name, developer, area — seed vs. real-run
  observation). Single-artifact subjects stay `uncorroborated`.
- Expected verdict: **BLOCKED** — Modeva is live in the product database,
  yet its committed knowledge package would not pass the Forever intake bar
  (no developer brochure). That finding is the point, and it mirrors the
  audits' "verified but sparse" observation about Modeva.

## Evidence

- Full suite before the change: 218 files / 1,613 tests passing. After:
  225 files / 1,661 tests passing (48 added).
- All 61 RC5.0 `coralina-knowledge` tests pass UNCHANGED against the
  delegated implementation.
- `tests/equivalence.test.ts` pins GOLDEN RC5.0 artifact values (judgements,
  merge/timeline provenance strings, record identity, chain wording) against
  the engine — a delegation-aware pin, since comparing the delegated RC5.0
  API with the engine directly would be tautological.
- Modeva through the engine: 3 sources registered cleanly, 18 facts stated,
  3 corroborated subjects, 0 disputes, 18/18 admitted, 6 explicit
  `missing_information` findings, readiness `blocked` with exactly one
  blocker (`source_present: brochure`).
- `tsc --noEmit` clean; ESLint clean on every touched file (the repository's
  pre-existing lint debt in untouched files is unchanged).

## What did NOT change

- No foundation module was modified.
- `/internal/coralina` keeps its URL, loader contract, judgements, and
  artifacts; its loader now goes through the RC5.1 catalog so both internal
  routes share one per-process build. Two sentences of rendered wording are
  deliberately project-agnostic now (the RC4.4 chain-summary and the
  "Extraction facts" section note) — pinned as deliberate in the golden-pin
  test suite.
- No public route, no Supabase schema, no import engine code.
- `coralina-knowledge`'s public exports remain (plus the new
  `CORALINA_KNOWLEDGE_DEFINITION`).

## Adversarial review

An eight-angle adversarial review (line-by-line, removed-behavior audit,
cross-file trace, reuse, simplification, efficiency, altitude, conventions)
ran over the change before commit. Confirmed findings and their fixes, all
applied in this change:

1. The RC5.0→RC5.1 "equivalence" test was tautological (both sides ran the
   same delegated code). Replaced with golden pins of concrete RC5.0
   artifacts (judgements, merge/timeline provenance strings, record
   identity, chain wording).
2. Two rendered sentences on `/internal/coralina` had silently changed
   during generalisation, contradicting this report's original
   "byte-identical" claim. The drift is kept (the generic wording is
   correct for a multi-project engine) but is now pinned in tests and
   documented here and in the module comments.
3. Unknown slugs on `/internal/projects/$slug` fell through to the bare
   root 404; the route now has a styled `notFoundComponent`, and its head
   title derives from loader data instead of echoing an uncatalogued slug.
4. `buildProjectKnowledgeSlice` now gates on
   `validateProjectKnowledgeDefinition` and throws on a malformed
   definition. This matters because RC4.7 silently skips an expected path
   that a fact also states — without the gate, a definition declaring a
   path both stated and missing would render a self-contradicting
   inspection.
5. The catalog cache stored values across an `await` (a benign
   check-then-set race); it now caches the build promise, set
   synchronously, with failed builds evicted so a transient error is not
   cached forever.
6. The Coralina inspection was cached twice (once by the RC5.0 accessor,
   once by the catalog); `/internal/coralina`'s loader now uses the catalog
   so one cache serves both routes.
7. Reuse: the engine now uses the chain's shared `isNonEmptyString` helper
   and the shared `SourceIssue` vocabulary (`ProjectKnowledgeIssue =
ProjectSourceIssue`, with codes and severities) instead of inventing a
   second issue shape; `CoralinaKnowledgeGap` is now a type alias of the
   engine's `ProjectKnowledgeGap` so the two cannot drift; the `describedAt`
   check is a strict ISO-instant test instead of `Date.parse`.

Findings deliberately deferred (documented, not fixed here):

- The "Forever intake standard" is stated in both project profiles; a
  shared profile builder in the engine is the right RC5.2 refactor (doing it
  now would churn Coralina's pinned readiness artifacts inside an already
  large change).
- `coralinaFact`/`modevaFact` are near-twin helpers; a shared
  fact-statement helper in the engine is a natural follow-up for project #3.
- Page-copy defaults resolve in the page component rather than the
  inspection; consolidating them into the view-model is worth doing if a
  second renderer (API/report surface) appears.
- Definitions are shared module constants (the RC5.0 posture); the engine
  copies arrays but not inner objects. All current consumers are read-only;
  freezing or cloning definitions is a candidate hardening step.

## Governance note

`docs/CURRENT_STAGE.md` (last updated 2026-07-11) still describes the
Coralina-intake documentation stage and declares route/application changes
out of scope; it predates the RC4.4–RC5.0 commits (2026-07-12) as well as
this change. Updating the canonical stage document is an owner decision and
is deliberately not done unilaterally here; a `docs/CHANGELOG.md` entry for
RC5.1 is included so the milestone log stays truthful. Reconciling
CURRENT_STAGE/FOREVER_STATUS with the RC4.4–RC5.1 chain remains follow-up
item 3 below.

## Risks and follow-ups

- The catalog is a hand-maintained map (slug → lazy definition import). At
  two projects this is the right size; if intake accelerates, a generated
  registry could replace it.
- The readiness profiles are caller-stated per project. The shared "Forever
  intake standard" (brochure + price list required, master/unit plans
  recommended, identity fields present) is now stated twice (Coralina's
  mirrors its manifest; Modeva's states the standard). Extracting a shared
  profile builder is a natural RC5.2 refactor once a third project arrives.
- Recommended next steps, in value order:
  1. Onboard the next real intake (Coralina unblocks when `developer` and
     `country` become source-backed — the same two fields its manifest
     already tracks).
  2. Bridge the canonical record produced by the engine to the persistence
     layer (the FOREVER_BRAIN RC6/RC7 track), now that the record is
     produced generically per project.
  3. Update `docs/CURRENT_STAGE.md` / `docs/FOREVER_STATUS.md` to
     acknowledge the RC4.4–RC5.1 chain (they predate it).
