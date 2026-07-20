# FOREVER-TRUTH-001A — Prepared Production Cleanup Plan

Status: PREPARED ONLY — NOT EXECUTED. Every statement below requires a separate
explicit Owner approval before any production connection or write.

Last updated: 2026-07-20

## Why this plan exists

Repository migration history proves that migration `20260704060123` seeded six
fictitious demo projects, six fictitious developers, and six cover-media rows,
all `is_active = true`. No later migration deletes or deactivates them, and the
`20260718113000` progressive-ingestion migration contains a backfill:

```sql
UPDATE public.projects
  SET public_status = 'published'
  WHERE is_active = true AND public_status IS DISTINCT FROM 'published';
```

which (re)published every active project. If production ran these migrations in
order and nothing was cleaned manually, the six fictitious projects are active,
published, and publicly readable.

Repository presence does not prove current production contents. The repository
now quarantines these slugs at every public data boundary
(`src/lib/public-truth.ts`), so the public product no longer renders them even
if the rows still exist. This plan removes them at the source.

## Entities in scope

Fictitious projects (slugs):

| Project name            | Slug                       |
| ----------------------- | -------------------------- |
| Surin Ridge Villas      | `surin-ridge-villas`       |
| Kamala Beach Residences | `kamala-beach-residences`  |
| Layan Forest Villas     | `layan-forest-villas`      |
| Bang Tao Garden Villas  | `bangtao-garden-pool-villas` |
| Kata Cliff Residences   | `kata-cliff-residences`    |
| Rawai Courtyard Villas  | `rawai-courtyard-villas`   |

Fictitious developers (names as seeded): Andaman Ridge Developments, Andara
Signature Group, Layan Estate Co., Laguna Property Partners, Cape Kata Estates,
South Cape Homes.

Genuine records that must NOT be touched: project `modeva` (and the legacy
`the-modeva-bang-tao` record if present — see Step 1), developer `Title`,
location `Bang Tao`, the unpublished Coralina draft and its graph, all
buildings/units/price history, leads.

## Step 1 — Read-only inventory (separately authorized, no writes)

Run with a read-only role. Record full output before any decision.

```sql
-- 1a. All projects and their public visibility state
SELECT id, slug, name, is_active, is_featured, public_status, created_at
FROM public.projects
ORDER BY created_at;

-- 1b. The fictitious six, exactly
SELECT id, slug, name, is_active, public_status
FROM public.projects
WHERE slug IN (
  'surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
  'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas'
);

-- 1c. Modeva identity check, including the legacy RC2-era slug
SELECT id, slug, name, is_active, public_status
FROM public.projects
WHERE slug IN ('modeva', 'the-modeva-bang-tao');

-- 1d. Developers
SELECT id, name FROM public.developers ORDER BY name;

-- 1e. Media attached to the fictitious six
SELECT pm.id, p.slug, pm.media_type, pm.url
FROM public.project_media pm
JOIN public.projects p ON p.id = pm.project_id
WHERE p.slug IN (
  'surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
  'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas'
);

-- 1f. Confirm no units / price history / leads reference the fictitious six
SELECT count(*) FROM public.units u
JOIN public.projects p ON p.id = u.project_id
WHERE p.slug IN (
  'surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
  'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas'
);
```

The inventory must also record anything unexpected (projects not in the
repository's known set, additional developers, media pointing at bundled
`villa*` image keys).

## Step 2 — Owner decision point

Proceed only if the inventory confirms the fictitious rows exist and nothing
genuine references them. If `1f` returns non-zero, or `1c` shows an unexpected
Modeva state (for example both `modeva` and `the-modeva-bang-tao` active), stop
and resolve with the Architect first.

## Step 3 — Deactivation (Owner-approved write, single transaction)

Deactivation, not deletion: reversible, preserves history, and immediately
removes public visibility (RLS shows only `is_active = true AND public_status =
'published'`).

```sql
BEGIN;

UPDATE public.projects
SET is_active = false,
    is_featured = false,
    public_status = 'draft'
WHERE slug IN (
  'surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
  'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas'
);
-- Expect: UPDATE 6 (or the exact count found in Step 1b)

-- Verification inside the transaction
SELECT count(*) AS still_public
FROM public.projects
WHERE slug IN (
  'surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
  'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas'
)
AND (is_active = true OR public_status = 'published');
-- Must be 0, otherwise ROLLBACK.

COMMIT;
```

Optional follow-up (separate approval; only if the inventory shows the six
fictitious developers have no remaining active project): rename is not needed —
developers are only rendered through project joins, so deactivated projects
already remove them from the public surface. Physical deletion of developers
and media rows can be decided later; it is not required for public truth.

## Step 4 — Post-cleanup verification (read-only)

```sql
SELECT slug FROM public.projects
WHERE is_active = true AND public_status = 'published'
ORDER BY slug;
-- Expected: only genuine published projects (currently: modeva; Coralina
-- remains draft/unpublished).
```

Also re-check the live site: `/projects`, `/sitemap.xml`, and one fictitious
detail URL (must be a not-found page).

## Rollback

```sql
UPDATE public.projects
SET is_active = true, public_status = 'published'
WHERE slug IN ( ...same six slugs... );
```

Note: even after rollback, the repository quarantine keeps these slugs hidden
from the public product. Rollback only restores database state.

## Guardrail for future migrations

The `20260718113000` backfill pattern (`publish everything active`) must not be
repeated: any future migration that changes `public_status` must target
explicit slugs. This plan does not modify the historical migration.

## Explicitly out of scope

- Any Coralina publication or update (separate checkpoint).
- Rainpalm import or publication.
- Deleting rows, schemas, or media files.
- Regenerating Supabase types (`src/integrations/supabase/types.ts` is stale —
  missing `public_status` and post-FDB tables — but regeneration requires a
  Supabase connection and is Owner/Codex work).
