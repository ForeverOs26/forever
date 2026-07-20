# FOREVER-TRUTH-001A — Prepared Production Cleanup Plan

Status: PREPARED ONLY — NOT EXECUTED. Every statement below requires a separate
explicit Owner approval before any production connection or write. Nothing in
this document authorizes a connection, a read, or a write by itself.

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
now suppresses these slugs at every public data boundary
(`src/lib/public-truth.ts`), so the public product no longer renders them even
if the rows still exist. This plan removes them at the source.

## Entities in scope

Fictitious projects (slugs, as seeded):

| Project name            | Slug                         |
| ----------------------- | ---------------------------- |
| Surin Ridge Villas      | `surin-ridge-villas`         |
| Kamala Beach Residences | `kamala-beach-residences`    |
| Layan Forest Villas     | `layan-forest-villas`        |
| Bang Tao Garden Villas  | `bangtao-garden-pool-villas` |
| Kata Cliff Residences   | `kata-cliff-residences`      |
| Rawai Courtyard Villas  | `rawai-courtyard-villas`     |

Fictitious developers (names as seeded): Andaman Ridge Developments, Andara
Signature Group, Layan Estate Co., Laguna Property Partners, Cape Kata Estates,
South Cape Homes.

Genuine records that must NOT be touched: project `modeva` (and the legacy
`the-modeva-bang-tao` record if present — see Step 1e), developer `Title`,
location `Bang Tao`, the unpublished Coralina draft and its whole graph, all
buildings/units/price history, all leads.

Throughout this document, `:fictitious_slugs` means exactly:

```sql
('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
 'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
```

## Step 1 — Read-only inventory (separately authorized, no writes)

Run with a read-only role in a session where no write is possible. Record the
complete output of every query before any decision.

### 1a. Full project and developer inventory

```sql
SELECT id, slug, name, is_active, is_featured, public_status, created_at
FROM public.projects
ORDER BY created_at;

SELECT id, name, created_at FROM public.developers ORDER BY created_at;
```

### 1b. Exact pre-change state of the targeted rows (the rollback baseline)

```sql
SELECT id, slug, name, is_active, is_featured, public_status, updated_at
FROM public.projects
WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
               'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
ORDER BY slug;
```

This output is the authoritative pre-change snapshot. The deactivation in
Step 3 and the rollback in Step 5 both depend on it; do not proceed without it.

### 1c. Complete relation discovery — every table that references projects

Do not assume a hand-written table list. Discover every declared reference,
including the `leads.project_slug → projects.slug` foreign key:

```sql
SELECT
  con.conname                           AS constraint_name,
  src.relname                           AS referencing_table,
  ARRAY(SELECT attname FROM pg_attribute
        WHERE attrelid = con.conrelid AND attnum = ANY (con.conkey)) AS referencing_columns
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_namespace nsp ON nsp.oid = src.relnamespace
WHERE con.contype = 'f'
  AND tgt.relname = 'projects'
  AND nsp.nspname = 'public';
```

### 1d. Per-relation counts for the fictitious six

For **every** table returned by 1c, count rows referencing the six projects.
From the canonical migration set the expected referencing tables are at least:
`project_media`, `units`, `buildings`, `facilities` (via `project_facilities`),
`project_assets` (`images`/`videos`/`documents` variants as created),
`project_intelligence`, `investment_data`, `price_updates`,
`project_translations`, `project_tags`, `project_amenities`, `project_seo`,
`project_status_history`, `nearby_places`, `sources`, `ingestion_batches`,
`ingestion_warnings`, and `leads` (by `project_slug`). Run for each id-keyed
table:

```sql
SELECT '<table>' AS relation, count(*) AS rows
FROM public.<table> t
JOIN public.projects p ON p.id = t.project_id
WHERE p.slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                 'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas');
```

and for `leads`:

```sql
SELECT 'leads' AS relation, count(*) AS rows
FROM public.leads
WHERE project_slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                       'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas');
```

Expected from migration history: `project_media` = 6, every other relation = 0.
Any `leads` count above 0 means a real person asked about a fictitious project
— record it for the Owner; it blocks nothing here because deactivation does not
touch `leads` (the FK is `ON UPDATE CASCADE ON DELETE SET NULL` and this plan
neither updates slugs nor deletes rows).

### 1e. Modeva identity check, including the legacy RC2-era slug

```sql
SELECT id, slug, name, is_active, public_status
FROM public.projects
WHERE slug IN ('modeva', 'the-modeva-bang-tao');
```

### 1f. Unexpected-surface check

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

Compare against the canonical migration table list. Any table not created by a
committed migration is recorded and treated as uninspected.

### What this inventory cannot see

- Rows in tables that reference projects without a declared foreign key
  (none exist in the canonical migrations, but drift is possible — mitigated,
  not eliminated, by 1c + 1f).
- Supabase Storage objects (bucket contents are outside SQL inventory).
- Database state in non-`public` schemas beyond the declared FK graph.
- Anything created after the inventory snapshot is taken.

## Step 2 — Owner decision point

Proceed only if:

- 1b returns exactly the expected six rows (slug + name pairs matching the
  table in "Entities in scope");
- every 1d count matches expectation, or every discrepancy has been reviewed
  and explicitly accepted by the Owner;
- 1e shows no surprising Modeva state (for example both `modeva` and
  `the-modeva-bang-tao` active at once must be understood first).

Otherwise stop and resolve with the Architect.

## Step 3 — Deactivation (Owner-approved write, single transaction, fail-closed)

Deactivation, not deletion: reversible, preserves history, and removes public
visibility (public RLS shows only `is_active = true AND public_status =
'published'`). The transaction verifies identities and row counts in place and
aborts on any mismatch:

```sql
BEGIN;

-- Fail closed unless the six targeted rows are exactly the expected
-- slug/name identities discovered in Step 1b — nothing more, nothing less.
DO $$
DECLARE
  mismatched integer;
  matched integer;
BEGIN
  SELECT count(*) INTO matched
  FROM public.projects
  WHERE (slug, name) IN (
    ('surin-ridge-villas',        'Surin Ridge Villas'),
    ('kamala-beach-residences',   'Kamala Beach Residences'),
    ('layan-forest-villas',       'Layan Forest Villas'),
    ('bangtao-garden-pool-villas','Bang Tao Garden Villas'),
    ('kata-cliff-residences',     'Kata Cliff Residences'),
    ('rawai-courtyard-villas',    'Rawai Courtyard Villas')
  );

  SELECT count(*) INTO mismatched
  FROM public.projects
  WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                 'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
    AND (slug, name) NOT IN (
    ('surin-ridge-villas',        'Surin Ridge Villas'),
    ('kamala-beach-residences',   'Kamala Beach Residences'),
    ('layan-forest-villas',       'Layan Forest Villas'),
    ('bangtao-garden-pool-villas','Bang Tao Garden Villas'),
    ('kata-cliff-residences',     'Kata Cliff Residences'),
    ('rawai-courtyard-villas',    'Rawai Courtyard Villas')
  );

  IF matched <> 6 OR mismatched <> 0 THEN
    RAISE EXCEPTION
      'Targeted identity check failed: matched %, mismatched % — ROLLBACK', matched, mismatched;
  END IF;
END $$;

-- Lock exactly the targeted rows for this transaction.
SELECT id, slug, is_active, is_featured, public_status
FROM public.projects
WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
               'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
FOR UPDATE;

UPDATE public.projects
SET is_active = false,
    is_featured = false,
    public_status = 'draft'
WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
               'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas');

-- Fail closed unless exactly six rows changed and none remain public.
DO $$
DECLARE
  updated integer;
  still_public integer;
  untouched_active integer;
BEGIN
  SELECT count(*) INTO updated
  FROM public.projects
  WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                 'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
    AND is_active = false AND is_featured = false AND public_status = 'draft';

  SELECT count(*) INTO still_public
  FROM public.projects
  WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                 'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
    AND (is_active = true OR public_status = 'published');

  -- Unrelated projects must be untouched: compare against the Step 1a
  -- inventory count of active projects outside the targeted set.
  SELECT count(*) INTO untouched_active
  FROM public.projects
  WHERE slug NOT IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                     'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
    AND is_active = true;

  IF updated <> 6 OR still_public <> 0 THEN
    RAISE EXCEPTION
      'Deactivation verification failed: updated %, still_public % — ROLLBACK',
      updated, still_public;
  END IF;

  RAISE NOTICE 'Deactivated 6 fictitious projects; % unrelated active projects untouched.',
    untouched_active;
END $$;

COMMIT;
```

If any statement raises, the transaction aborts and nothing changes. Developers
and media rows are intentionally not modified: deactivated projects already
remove them from every public join, and physical cleanup can be a later,
separately approved action.

## Step 4 — Post-cleanup verification (read-only)

```sql
SELECT slug FROM public.projects
WHERE is_active = true AND public_status = 'published'
ORDER BY slug;
-- Expected: only genuine published projects (per Step 1a/1e; Coralina remains
-- draft/unpublished).
```

Also re-check the live site: `/projects`, `/sitemap.xml`, and one fictitious
detail URL (must render the not-found page).

## Step 5 — Rollback (restores the exact Step 1b state)

The rollback restores each row to the exact values captured in Step 1b — it
never unconditionally publishes. The statements below carry the values
expected from migration history (`is_active = true`, `is_featured` as seeded,
`public_status = 'published'` after the `20260718113000` backfill). **If the
Step 1b snapshot recorded different values for any row, substitute that row's
captured values before running.**

```sql
BEGIN;

UPDATE public.projects SET is_active = true, is_featured = true,  public_status = 'published'
WHERE slug = 'surin-ridge-villas';
UPDATE public.projects SET is_active = true, is_featured = true,  public_status = 'published'
WHERE slug = 'kamala-beach-residences';
UPDATE public.projects SET is_active = true, is_featured = true,  public_status = 'published'
WHERE slug = 'layan-forest-villas';
UPDATE public.projects SET is_active = true, is_featured = false, public_status = 'published'
WHERE slug = 'bangtao-garden-pool-villas';
UPDATE public.projects SET is_active = true, is_featured = false, public_status = 'published'
WHERE slug = 'kata-cliff-residences';
UPDATE public.projects SET is_active = true, is_featured = false, public_status = 'published'
WHERE slug = 'rawai-courtyard-villas';

-- Verification: every targeted row matches its Step 1b snapshot again.
SELECT id, slug, is_active, is_featured, public_status
FROM public.projects
WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
               'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
ORDER BY slug;
-- Compare against Step 1b before COMMIT; ROLLBACK on any difference.

COMMIT;
```

Note: even after a rollback, the repository quarantine keeps these slugs
hidden from the public product. Rollback only restores database state.

## Recommended follow-up data corrections (separate Owner decisions)

- The genuine Modeva row carries legacy placeholder text that itself makes
  verification claims: tagline/short description "Verified Bang Tao project
  reviewed through the Forever decision framework." and highlight "Forever
  Verified project record", alongside `forever_verified = true` and
  trust note "Awaiting full Forever inspection data.". The repository now
  suppresses the legacy advisory scalars publicly, but the stored copy
  should be corrected at the source when the Owner next edits Modeva.
- If 1e shows a live legacy `the-modeva-bang-tao` row, decide whether it is
  the canonical Modeva record or a duplicate to reconcile.

## Guardrail for future migrations

The `20260718113000` backfill pattern ("publish everything active") must not
be repeated: any future migration that changes `public_status` must target
explicit slugs. This plan does not modify the historical migration.

## Explicitly out of scope

- Any Coralina publication or update (separate checkpoint).
- Rainpalm import or publication.
- Deleting rows, schemas, or storage objects.
- Editing `leads` in any way.
- Regenerating Supabase types (`src/integrations/supabase/types.ts` is stale —
  missing `public_status` and post-FDB tables — but regeneration requires a
  Supabase connection and is Owner/Codex work).
