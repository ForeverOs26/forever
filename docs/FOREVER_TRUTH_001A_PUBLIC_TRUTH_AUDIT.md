# FOREVER-TRUTH-001A — Public Truth Audit and Fail-Closed Cleanup

Status: Repository implementation complete, pending independent review and
merge. This document does not mark the checkpoint canonical or closed.

Base: authoritative main `35541a2e9bcc3b8ca737f0ff129b76487e57de90`
Last updated: 2026-07-20

## Governing rule

```text
missing evidence → false / null / "Not available" / hidden claim
```

Never:

```text
missing evidence → verified badge / positive score / Strong Buy /
                   assumed image / invented review / invented offer
```

## Defects proven from repository code

### 1. Optimistic mapping defaults (`src/lib/project-service.ts`, mapToProperty)

The card/list mapper — feeding home, catalogue, Discovery, Navigator, Booth —
fabricated claims for every missing field:

| Missing field       | Fabricated as                    |
| ------------------- | -------------------------------- |
| `forever_verified`  | `true` → "Forever Verified" badge + inspection claims |
| `verdict`           | `"Strong Buy"`                   |
| `market_position`   | `"In line with market"`          |
| `rental_demand`     | `"Moderate"`                     |
| `sales_status`      | `"Available"`                    |
| `construction_status` | `"Planning"`                   |
| `project_type`      | `"Villa"`                        |
| `verified_price`    | fell back to the unverified `price_range` behind a "Forever Verified Price" badge (also in `project-detail-mappers.ts`) |
| project photo       | bundled stock villa photos via `image_key`, final fallback another project's photo (`villa-surin.jpg`) |

### 2. Fabricated static content (`src/lib/data.ts`)

- 4 invented "Verified Offer" promotions with invented savings figures, tied to
  projects that do not exist; rendered on `/` and `/offers`.
- 5 invented client testimonials with names and star ratings; rendered on `/`
  and `/reviews`, where they were aggregated into a "4.8 average · 5 verified
  reviews" trust statistic.
- 6 invented per-area `listings` counts on `/` and `/areas`.

### 3. Fictitious database entities (migration history)

Migration `20260704060123` seeded 6 fictitious projects, 6 fictitious
developers, and 6 media rows, all `is_active = true`. No migration removes
them; the `20260718113000` backfill set every active project to
`public_status = 'published'`. Net repository-proven state: the fictitious
catalogue is publicly served unless production was manually cleaned.

### 4. Fabricated presentation behavior

- `/discovery` marked the first three results "Forever Recommended" purely by
  list position, and its intent tiles claimed "We will tune the discovery
  accordingly" while filtering nothing.
- `/discovery`, `/projects`, `/about`, root metadata, and the advisory heads
  claimed "verified project data" / "independently reviewed" catalogue-wide.
- `/contact` promised a response "within one business day" with no measured
  response baseline.
- The root metadata claimed a Twitter handle (`@ForeverProperty`) with no
  evidence it exists.
- The unused `src/components/ProjectCard.tsx` rendered "Forever Score 0.0"
  and empty "Verified Offer"/"Forever Verified Price" labels unconditionally.

### Already fail-closed (verified, unchanged)

Passport, Intelligence scoring/verdict thresholds, Navigator matching
(NAV-001 sentinels), Advisory derivations, `mapProjectDetail`, Project Detail
components, `projects/$slug` JSON-LD guards, Partner Demo data modules, and
the demo-preview production-bundle boundary.

## Chosen policy and architecture

One small truth-policy module, `src/lib/public-truth.ts`, plus alignment of
the single optimistic layer with the fail-closed conventions the rest of the
codebase already uses (`"Not available"` sentinels, empty string / 0 / null,
strict `=== true` verification):

1. **Fail-closed mapping** — `mapToProperty` now maps every missing field to
   its absence sentinel; `verifiedPrice` comes only from `verified_price` in
   both mappers; `foreverVerified` requires an explicit `true`.
2. **Fail-closed media** — a project image is only the project's own recorded
   URL; the bundled stock villa photos and the `image_key` mechanism were
   deleted; cards show "Media preview pending".
3. **Quarantine of known-fictitious entities** — `ProjectService.listActive`,
   `getBySlug`, `listActiveSlugs`, and `ProjectDetailService.getBySlug` refuse
   the six seeded slugs, so catalogue, detail URLs, sitemap, Navigator, Booth,
   and Advisory candidate lists cannot render them regardless of current
   production contents.
4. **Removal of fabricated content** — offers, reviews, and area listing
   counts removed from `src/lib/data.ts` and all rendering components;
   `/offers` and `/reviews` are honest empty-state pages, out of the primary
   navigation and sitemap; `/areas` is an editorial orientation without counts
   or performance claims.
5. **Honest framing copy** — "verified project data" → "source-backed project
   records" and equivalents across root metadata, home, catalogue, Discovery,
   About, and Advisory heads; positional "Forever Recommended" and the
   non-functional intent-tile theater removed from Discovery.
6. **Sentinel-aware display** — the card treats `"Not available"` as absent
   (hidden), never as displayable data.

## Regression protection added

- `src/lib/project-service.test.ts` — missing fields cannot become positive
  claims; recorded evidence is preserved; fictitious slugs are excluded from
  lists, slug enumeration, and direct lookup.
- `src/lib/public-truth.test.ts` — a full `src/` source scan proving no
  fictitious project, reviewer, or developer name appears anywhere in
  application source, fictitious slugs appear only inside the quarantine
  policy, fabricated exports are gone, and the stock villa photos are gone.
- `src/lib/sitemap.test.ts` — sitemap advertises only real surfaces and the
  provided project slugs.
- `src/components/premium-project-card.truth.test.tsx` — a record without
  evidence renders no badge, verdict, verified price, score, inspection date,
  or substitute imagery, and never displays the sentinel itself.

## What cannot be known from the repository

- Actual current production rows (the fictitious six may or may not still be
  active/published; a legacy `the-modeva-bang-tao` Modeva record may exist
  alongside `modeva`).
- Actual production media URLs and whether genuine projects have real photos.
- Whether the deployed site currently runs this code.

These require the separately authorized read-only inventory in
`docs/FOREVER_TRUTH_001A_PRODUCTION_CLEANUP_PLAN.md` (Step 1).

## Prepared but not executed

The exact production inventory queries, single-transaction deactivation of the
six fictitious projects, verification, and rollback are prepared in
`docs/FOREVER_TRUTH_001A_PRODUCTION_CLEANUP_PLAN.md`. No production
connection, migration, or write occurred in this checkpoint.

## Coralina and Rainpalm

Coralina remains an unpublished draft; its records and adapters were not
modified. Publication is a separate Owner-gated checkpoint
(Coralina Publication Readiness). Rainpalm remains unimported and unpublished.

## Remaining Owner / Codex work

1. Owner: authorize and run the read-only production inventory (Step 1).
2. Owner: decide and execute the prepared deactivation (Step 3) — production
   truth currently relies on the repository quarantine alone.
3. Owner: confirm or correct the public contact details
   (`advisors@forever.property`, the Cherng Talay office line) — kept in the
   UI but unverifiable from the repository.
4. Codex/Owner (Windows): reproduce the two inherited baseline failures
   (`partner-demo-data` imports and `importer-preflight` Coralina dry-run)
   that depend on untracked local source files, and confirm they pass there.
5. Codex: regenerate `src/integrations/supabase/types.ts` when a connection
   is next authorized (missing `public_status` and post-FDB tables).
6. Owner: Partner Demo presentation and guest walkthroughs — the business
   half of this stage — remain open; code alone does not close it.
