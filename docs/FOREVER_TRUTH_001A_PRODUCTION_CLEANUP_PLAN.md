# FOREVER-TRUTH-001A — Prepared Production Cleanup Plan

Status: PREPARED ONLY — NOT EXECUTED. Every statement below requires a separate
explicit Owner approval before any production connection or write. Nothing in
this document authorizes a connection, a read, or a write by itself.

Last updated: 2026-07-21

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

## Fail-closed execution model

Both write transactions in this plan follow the same safety pattern:

1. Exact expected state is bound into the transaction as data (a
   transaction-local snapshot table), never as operator memory.
2. Identity checks run BEFORE any modification and `RAISE EXCEPTION` on any
   missing row, unexpected row, or identity mismatch.
3. Verification of the exact post-change state runs INSIDE the transaction
   and `RAISE EXCEPTION` on any mismatch — including unrelated rows.
4. A raised exception aborts the transaction; the trailing `COMMIT` then
   rolls back automatically. No step asks the operator to compare output by
   eye and remember to type `ROLLBACK`.
5. The rollback restores only values captured in the reviewed pre-change
   snapshot. The template ships with intentionally invalid placeholder ids
   (`00000000-…`), and production row UUIDs cannot be known from the
   repository — so the template is structurally inert until the Owner pastes
   the real Step 1b snapshot; otherwise the identity check aborts.

6. Each write transaction takes `SHARE ROW EXCLUSIVE` on `public.projects`
   immediately after `BEGIN`, before taking a snapshot or checking an identity.
   This conflicts with concurrent `INSERT`, `UPDATE`, and `DELETE` on the
   table until commit or rollback. It therefore protects the target identities
   and makes the untargeted-row invariant meaningful through `COMMIT`; this is
   a database boundary, not a timing assumption.

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
buildings/units/price history, all leads, all media.

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

### 1b. Exact pre-change state of the targeted rows (the snapshot)

```sql
SELECT id, slug, name, is_active, is_featured, public_status
FROM public.projects
WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
               'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
ORDER BY slug;
```

This output is the authoritative pre-change snapshot. Step 3's identity
checks, and every value the Step 5 rollback restores, come from this exact
output. Do not proceed without it.

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
`project_media`, `units`, `buildings`, `project_facilities`, `project_assets`,
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
— record it for the Owner; it blocks nothing here because this plan never
touches `leads` (the FK is `ON UPDATE CASCADE ON DELETE SET NULL` and this
plan neither updates slugs nor deletes rows).

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
'published'`). All checks are database-enforced: any mismatch raises, the
transaction aborts, and the trailing `COMMIT` rolls back automatically.

```sql
BEGIN;

-- Protect the full projects relation before the snapshot or any identity
-- check. SHARE ROW EXCLUSIVE conflicts with concurrent INSERT, UPDATE, and
-- DELETE, so no target or untargeted project can drift until COMMIT/ROLLBACK.
LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;

-- Transaction-local snapshot of every row NOT targeted, taken before any
-- change, so unrelated-row preservation is verified value-by-value.
CREATE TEMPORARY TABLE truth001a_untargeted_before ON COMMIT DROP AS
SELECT id, slug, name, is_active, is_featured, public_status
FROM public.projects
WHERE slug NOT IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                   'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas');

-- Identity check BEFORE any modification: exactly the six expected
-- slug/name identities, nothing more, nothing less.
DO $$
DECLARE
  matched integer;
  mismatched integer;
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
      'Targeted identity check failed: matched %, mismatched % — aborting', matched, mismatched;
  END IF;
END $$;

-- Retain row locks on the six targets as a narrow, explicit identity lock.
SELECT id FROM public.projects
WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
               'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
FOR UPDATE;

UPDATE public.projects
SET is_active = false,
    is_featured = false,
    public_status = 'draft'
WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
               'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas');

-- Fail closed unless: exactly six rows are now deactivated, none remain
-- public, and every untargeted row is value-identical to its pre-change
-- snapshot (compared row-by-row, not merely counted).
DO $$
DECLARE
  deactivated integer;
  still_public integer;
  unrelated_changed integer;
BEGIN
  SELECT count(*) INTO deactivated
  FROM public.projects
  WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                 'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
    AND is_active = false AND is_featured = false AND public_status = 'draft';

  SELECT count(*) INTO still_public
  FROM public.projects
  WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                 'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
    AND (is_active = true OR public_status = 'published');

  -- Symmetric difference between the pre-change snapshot of untargeted rows
  -- and their live state: any insert, delete, or value change counts.
  SELECT count(*) INTO unrelated_changed
  FROM (
    SELECT id, slug, name, is_active, is_featured, public_status
    FROM truth001a_untargeted_before
    EXCEPT
    SELECT id, slug, name, is_active, is_featured, public_status
    FROM public.projects
    WHERE slug NOT IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                       'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
  ) gone
  FULL OUTER JOIN (
    SELECT id, slug, name, is_active, is_featured, public_status
    FROM public.projects
    WHERE slug NOT IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                       'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas')
    EXCEPT
    SELECT id, slug, name, is_active, is_featured, public_status
    FROM truth001a_untargeted_before
  ) appeared ON false;

  IF deactivated <> 6 OR still_public <> 0 OR unrelated_changed <> 0 THEN
    RAISE EXCEPTION
      'Deactivation verification failed: deactivated %, still_public %, unrelated_changed % — aborting',
      deactivated, still_public, unrelated_changed;
  END IF;
END $$;

COMMIT;
```

Developers, media, units, prices, and leads are intentionally not modified:
deactivated projects already leave every public join, and physical cleanup can
be a later, separately approved action.

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

## Step 5 — Rollback (snapshot-bound, database-enforced)

The rollback restores each targeted row to exactly the values recorded in the
Step 1b snapshot — never to values assumed from migration history, and never
by publishing anything unconditionally.

**Before running:** replace the six placeholder rows in the `VALUES` list with
the exact Step 1b output. The placeholder ids below are intentionally invalid
(`00000000-…`) and production row UUIDs cannot be known from this repository,
so an unedited template ALWAYS aborts at the identity check — forgetting to
paste the snapshot cannot silently restore wrong values.

```sql
BEGIN;

-- Establish the same full-table mutation boundary before materializing or
-- checking the rollback snapshot. Target identities remain protected from
-- concurrent mutation through the exact-value verification and COMMIT.
LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMPORARY TABLE truth001a_rollback_snapshot (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL,
  is_featured boolean NOT NULL,
  public_status text NOT NULL
) ON COMMIT DROP;

-- PASTE THE EXACT STEP 1b ROWS HERE (id, slug, name, is_active, is_featured,
-- public_status). The rows below are inert placeholders.
INSERT INTO truth001a_rollback_snapshot VALUES
  ('00000000-0000-0000-0000-000000000001','surin-ridge-villas','PLACEHOLDER', false, false, 'draft'),
  ('00000000-0000-0000-0000-000000000002','kamala-beach-residences','PLACEHOLDER', false, false, 'draft'),
  ('00000000-0000-0000-0000-000000000003','layan-forest-villas','PLACEHOLDER', false, false, 'draft'),
  ('00000000-0000-0000-0000-000000000004','bangtao-garden-pool-villas','PLACEHOLDER', false, false, 'draft'),
  ('00000000-0000-0000-0000-000000000005','kata-cliff-residences','PLACEHOLDER', false, false, 'draft'),
  ('00000000-0000-0000-0000-000000000006','rawai-courtyard-villas','PLACEHOLDER', false, false, 'draft');

-- Identity check BEFORE any modification: the snapshot must contain exactly
-- the six expected slugs, and every snapshot row must match a live row by
-- (id, slug, name). An unedited template fails here on the placeholder ids.
DO $$
DECLARE
  snapshot_rows integer;
  expected_slugs integer;
  identity_matches integer;
BEGIN
  SELECT count(*) INTO snapshot_rows FROM truth001a_rollback_snapshot;

  SELECT count(*) INTO expected_slugs
  FROM truth001a_rollback_snapshot
  WHERE slug IN ('surin-ridge-villas','kamala-beach-residences','layan-forest-villas',
                 'bangtao-garden-pool-villas','kata-cliff-residences','rawai-courtyard-villas');

  SELECT count(*) INTO identity_matches
  FROM truth001a_rollback_snapshot s
  JOIN public.projects p ON p.id = s.id AND p.slug = s.slug AND p.name = s.name;

  IF snapshot_rows <> 6 OR expected_slugs <> 6 OR identity_matches <> 6 THEN
    RAISE EXCEPTION
      'Rollback identity check failed: snapshot %, expected-slugs %, identity-matches % — aborting (paste the real Step 1b snapshot)',
      snapshot_rows, expected_slugs, identity_matches;
  END IF;
END $$;

-- Lock the six targeted rows.
SELECT p.id FROM public.projects p
JOIN truth001a_rollback_snapshot s ON s.id = p.id
FOR UPDATE;

-- Restore ONLY the captured values. Nothing here can publish a row that the
-- snapshot recorded as unpublished.
UPDATE public.projects p
SET is_active = s.is_active,
    is_featured = s.is_featured,
    public_status = s.public_status
FROM truth001a_rollback_snapshot s
WHERE p.id = s.id;

-- Verify the exact restored state INSIDE the transaction: every one of the
-- six rows must be value-identical to its snapshot row.
DO $$
DECLARE
  restored integer;
BEGIN
  SELECT count(*) INTO restored
  FROM truth001a_rollback_snapshot s
  JOIN public.projects p ON p.id = s.id
  WHERE p.is_active = s.is_active
    AND p.is_featured = s.is_featured
    AND p.public_status = s.public_status;

  IF restored <> 6 THEN
    RAISE EXCEPTION
      'Rollback verification failed: % of 6 rows match the snapshot — aborting', restored;
  END IF;
END $$;

COMMIT;
```

Note: even after a rollback, the repository suppression keeps these slugs
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
- Editing `leads`, `developers`, `project_media`, `units`, or price history
  in any way.
- Regenerating Supabase types (`src/integrations/supabase/types.ts` is stale —
  missing `public_status` and post-FDB tables — but regeneration requires a
  Supabase connection and is Owner/Codex work).
