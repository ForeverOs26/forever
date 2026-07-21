# FOREVER-TRUTH-001A — Public Truth Audit and Fail-Closed Cleanup

Status: Repository implementation completed and canonical after PR #94 merge.
The prepared production cleanup plan remains unexecuted and Owner-gated.

Base: authoritative main `35541a2e9bcc3b8ca737f0ff129b76487e57de90`
Last updated: 2026-07-21

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

| Missing field         | Fabricated as                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `forever_verified`    | `true` → "Forever Verified" badge + inspection claims                                                                   |
| `verdict`             | `"Strong Buy"`                                                                                                          |
| `market_position`     | `"In line with market"`                                                                                                 |
| `rental_demand`       | `"Moderate"`                                                                                                            |
| `sales_status`        | `"Available"`                                                                                                           |
| `construction_status` | `"Planning"`                                                                                                            |
| `project_type`        | `"Villa"`                                                                                                               |
| `verified_price`      | fell back to the unverified `price_range` behind a "Forever Verified Price" badge (also in `project-detail-mappers.ts`) |
| project photo         | bundled stock villa photos via `image_key`, final fallback another project's photo (`villa-surin.jpg`)                  |

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

### Additional defects confirmed in the corrective review pass

- Discovery still ranked publicly by unproven signals: "Forever Recommended"
  default sort and "Forever Score high to low" ordered by
  `foreverVerified`/`trustScore`/`investmentValue`, and a "Forever Verified
  only" filter keyed on the placeholder boolean.
- The JSON-LD builder mapped every non-empty status except "Sold Out" to
  `schema.org/InStock` (including unknown values), hardcoded
  `addressRegion: Phuket` / `addressCountry: TH` without a recorded source
  field, and re-emitted the legacy advisory scalars as structured facts.
- The legacy `forever_verified === true` scalar was treated as sufficient
  proof for a public "Forever Verified" badge although the canonical Modeva
  seed stores it as a placeholder next to "Awaiting full Forever inspection
  data."; the same applies to trust/investment scores, verdicts, market
  position, rental demand/yield, growth estimates, inspection dates,
  promotions, and the verified-price string — none are bound to an evidence
  contract.
- The first source-scan test compared unnormalized `path.relative` output and
  would have scanned its own forbidden-name list on Windows.
- Unconfirmed contact/office claims remained public (Cherng Talay office,
  `advisors@forever.property`, WhatsApp availability, appointment days,
  "Forever Private Office", a response-time promise in the contact form).
- The retained area descriptions still carried unverifiable factual claims
  (sheltered beaches, travel times, international schools, branded resorts,
  deep-water access, residence patterns).
- The home page still promised title checks, developer track-record review,
  EIA approvals, and occupancy/net-yield benchmarks that the repository does
  not contain, and linked a "Decision Guide" that does not exist.
- Catalogue-wide "source-backed project records" phrasing overstated the
  current per-record source coverage (Modeva knowledge readiness is
  incomplete).

### Defects corrected in the final review pass

- The ordinary public header still linked `/advisory`, whose route hardcoded
  the legacy `the-modeva-bang-tao` slug, loaded every active candidate, and
  publicly exposed a ranked project list, a top pick, "ranked first"
  language, and "verified evidence signals" — all derived from the same
  legacy scalars this PR classifies as evidence-unproven. `/advisory` and
  `/advisory/report` are now neutral, noindex, data-free placeholders out of
  public navigation; the canonical Advisory modules under
  `src/features/advisory/` are retained unchanged for the later Advisor
  Workflow phase (per the Strategic North Star sequencing).
- The prepared rollback in the cleanup plan hardcoded migration-history
  values, relied on manual SELECT comparison before COMMIT, and could
  therefore not be called an exact fail-closed restoration. It is now
  snapshot-bound and database-enforced: a transaction-local snapshot table
  carries the exact reviewed Step 1b values (id, slug, name, is_active,
  is_featured, public_status); identity checks RAISE before any
  modification; exact restored values are verified inside the transaction
  before COMMIT; and the shipped template is inert — its placeholder ids can
  never match production UUIDs, so an unedited template always aborts. The
  deactivation now also snapshots every untargeted row before the update and
  aborts (not merely notices) if any unrelated row changed, compared
  value-by-value.

### Defects corrected in the independent Windows audit

- `/offers`, `/reviews`, and `/areas` were correctly absent from navigation
  and the sitemap, but their reachable evidence-dependent empty states had no
  `robots: noindex, nofollow` metadata. They now use the same truth-first
  indexing boundary as the Advisory placeholders.
- The prepared deactivation transaction took its untargeted snapshot before
  locking the table and locked only the six targets after their identity
  check. Under PostgreSQL `READ COMMITTED`, an untargeted row could therefore
  be inserted, updated, or deleted after final verification and before
  `COMMIT`; a target could also change between the first identity check and
  its row lock. Both write templates now take `LOCK TABLE public.projects IN
SHARE ROW EXCLUSIVE MODE` immediately after `BEGIN`, before snapshots and
  identity checks. That lock conflicts with concurrent project inserts,
  updates, and deletes through commit or rollback. The rollback uses the same
  boundary, so its snapshot identity is checked while protected.
- Production-reachable shells statically imported the Partner Demo mode helper.
  Although every call was DEV-gated, that import still emitted a named helper
  chunk in the production client. Public modules now use Vite-foldable literal
  DEV checks; the helper remains only behind the existing DEV-gated dynamic
  data adapter. A production build confirms no Partner Demo helper, data, or
  demo-preview chunk and no demo environment marker in client assets.

### Already fail-closed (verified, unchanged)

Passport and Intelligence internal scoring thresholds, Navigator matching
(NAV-001 sentinels), Advisory derivations and their "Not available"
handling, Partner Demo data modules, and the demo-preview production-bundle
boundary. These derive from the (now suppressed) public model and degrade to
their honest empty states.

## Chosen policy and architecture

One small truth-policy module, `src/lib/public-truth.ts`, plus alignment of
every public boundary with the fail-closed conventions the rest of the
codebase already uses (`"Not available"` sentinels, empty string / 0 / null):

1. **Fail-closed mapping** — `mapToProperty` and `mapProjectDetail` map every
   missing descriptive field to its absence sentinel.
2. **Evidence-unproven scalar suppression** — the legacy advisory scalars
   (`forever_verified`, `verified_price`, `trust_score`, `investment_value`,
   `verdict`, `market_position`, `rental_demand`, `rental_yield`,
   `capital_growth_estimate`, `last_inspection`, `promotion`, `trust_note`)
   are suppressed in BOTH public mappers even when the row carries values:
   the canonical Modeva seed proves they are placeholders: it stores
   `forever_verified = true` next to "Awaiting full Forever inspection data.",
   and no
   code binds them to a source, inspection record, or Owner-recorded
   verification action. Raw values stay in the database; the public claim is
   withheld until a real evidence contract exists. Passport/Intelligence
   derive from the suppressed model and therefore degrade to their honest
   empty states.
3. **Fail-closed media** — a project image is only the project's own recorded
   URL; the bundled stock villa photos and the `image_key` mechanism were
   deleted; cards show "Media preview pending".
4. **Quarantine of known-fictitious entities** — `ProjectService.listActive`,
   `getBySlug`, `listActiveSlugs`, and `ProjectDetailService.getBySlug` refuse
   the six seeded slugs, so catalogue, detail URLs, sitemap, Navigator, Booth,
   and Advisory candidate lists cannot render them regardless of current
   production contents.
5. **Removal of fabricated content and behavior** — static offers, reviews,
   and the area guide removed entirely; `/offers`, `/reviews`, `/areas`, and
   the public Advisory Workspace (`/advisory`, `/advisory/report`) are honest
   empty-state or placeholder pages, out of primary navigation and the
   sitemap (Advisory pages are additionally noindex);
   Discovery's positional "Forever Recommended" banner, its "Forever
   Recommended"/"Forever Score" sorts, its "Forever Verified only" filter,
   and its non-functional intent tiles are removed — sorting is neutral
   (catalogue order, name, recorded price with missing prices last).
6. **Truthful structured data** — the JSON-LD builder
   (`src/features/project-detail/project-structured-data.ts`) emits only
   recorded descriptive facts; availability uses a closed whitelist
   (recorded `Available`/`Selling` → InStock, recorded `Sold Out` → SoldOut,
   everything else omitted); no region/country is inferred; the absence
   sentinel is never serialized; the evidence-unproven scalars have no code
   path into structured data.
7. **Honest framing copy** — catalogue-wide "verified project data" /
   "independently reviewed" / blanket "source-backed" claims replaced with
   language that is true for every record capable of appearing ("structured
   project records", "honest missing-data handling"); unsupported service
   promises (title checks, EIA approvals, occupancy/net-yield benchmarks,
   response-time promises) removed or reworded to advisor-dependent topics.
8. **No unconfirmed contact claims** — the office line, email address,
   WhatsApp availability, opening days, and Twitter handle are removed until
   the Owner confirms exact details; the contact form is the supported
   channel.
9. **Sentinel-aware display** — the card treats `"Not available"` as absent
   (hidden), never as displayable data.

## Regression protection added

- `src/lib/project-service.test.ts` — missing fields cannot become positive
  claims; the evidence-unproven scalars are suppressed even when present,
  proven against the real Modeva legacy placeholder shape; fictitious slugs
  are excluded from lists, slug enumeration, and direct lookup.
- `src/lib/public-truth.test.ts` — a full `src/` source scan proving no
  fictitious project, reviewer, or developer name and no unconfirmed contact
  claim appears anywhere in application source; fictitious slugs appear only
  inside the quarantine policy; fabricated exports are gone; the stock villa
  photos are gone; path comparison is Windows-safe (backslash-normalized,
  with its own regression test).
- `src/lib/sitemap.test.ts` — sitemap advertises only real surfaces and the
  provided project slugs; `/offers`, `/reviews`, `/areas` are absent and their
  route metadata is `noindex, nofollow`.
- `src/features/discovery/discovery-filters.test.ts` — no recommendation,
  score, or verification sort/filter exists; catalogue order ignores
  verification/score signals; price sorts put missing prices last.
- `src/features/project-detail/project-structured-data.test.ts` — JSON-LD
  availability whitelist, no inferred geography, no sentinel serialization,
  no channel for suppressed scalars, and an end-to-end check with the real
  Modeva legacy row shape.
- `src/lib/production-cleanup-plan.test.ts` — the prepared cleanup plan stays
  prepared-only, slug-scoped, transactional, and ellipsis-free; the rollback
  is snapshot-bound with database-enforced aborts (inert placeholder ids,
  identity checks before modification, exact-value verification before
  COMMIT, no manual compare-then-commit step); unrelated projects are
  compared value-by-value; leads, developers, media, units, and prices are
  untouched.
- `src/lib/advisory-public-boundary.test.ts` — `/advisory` and
  `/advisory/report` query no project data, import no advisory engine,
  contain no legacy slug or ranking/evidence-signal language, are noindex,
  and appear in neither public navigation nor the sitemap; no ordinary
  public route hardcodes the legacy Advisory slug.
- `src/components/premium-project-card.truth.test.tsx` — display gating over
  the `Property` model: absent values render no badge, verdict, verified
  price, score, inspection date, or substitute imagery, and the sentinel is
  never displayed.

## What cannot be known from the repository

- Actual current production rows (the fictitious six may or may not still be
  active/published; a legacy `the-modeva-bang-tao` Modeva record may exist
  alongside `modeva`).
- Actual production media URLs and whether genuine projects have real photos.
- Whether the deployed site currently runs this code.

These require the separately authorized read-only inventory in
`docs/FOREVER_TRUTH_001A_PRODUCTION_CLEANUP_PLAN.md` (Step 1).

## Browser-tooling limitation

The controlled CDP browser matrix did not complete because its temporary runner
exceeded the shell execution ceiling. No reproducible PR-owned browser defect
was identified, no code was changed during that attempt, and all task-owned
listeners were removed. The Owner and Architect accepted this tooling
limitation; it is not a product blocker. Any later visual issue may be
corrected through an ordinary follow-up PR.

## Prepared but not executed

The exact production inventory (dynamic foreign-key discovery via
`pg_constraint`, per-relation counts, pre-change snapshot), the
single-transaction fail-closed deactivation (a `SHARE ROW EXCLUSIVE`
projects-table mutation boundary before snapshot/identity checks, then a
value-by-value untargeted-row invariant that aborts via RAISE), and a
snapshot-bound rollback (inert placeholder template, database-enforced
identity and restored-value verification before COMMIT) are prepared in
`docs/FOREVER_TRUTH_001A_PRODUCTION_CLEANUP_PLAN.md`. No production
connection, migration, or write occurred in this checkpoint.

## Coralina and Rainpalm

Coralina remains an unpublished draft; its records and adapters were not
modified. Publication is a separate Owner-gated checkpoint
(Coralina Publication Readiness). Rainpalm remains unimported and unpublished.

## Remaining Owner / Codex work

1. Owner: authorize and run the read-only production inventory (Step 1).
2. Owner: decide and execute the prepared deactivation (Step 3) — production
   truth currently relies on the repository suppression alone.
3. Owner: confirm the exact public contact details (office, email, phone,
   hours) — they were removed from the UI until confirmed; the contact form
   remains the supported channel.
4. Owner: correct the stored Modeva copy at the source when next editing it —
   its tagline/highlights still contain legacy "Verified" wording (see the
   cleanup plan's recommended follow-up corrections).
5. Owner/Architect: define the future evidence contract that would allow
   verification badges, scores, verdicts, market positions, yields,
   inspections, verified prices, and the Advisor Workspace (with its
   evidence-coverage views) to return publicly.
6. Codex/Owner (Windows): reproduce the two inherited baseline failures
   (`partner-demo-data` imports and `importer-preflight` Coralina dry-run)
   that depend on untracked local source files, and confirm they pass there.
7. Codex: regenerate `src/integrations/supabase/types.ts` when a connection
   is next authorized (missing `public_status` and post-FDB tables).
8. Owner: Partner Demo presentation and guest walkthroughs — the business
   half of this stage — remain open; code alone does not close it.
