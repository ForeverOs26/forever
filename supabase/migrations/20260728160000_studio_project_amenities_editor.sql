-- FOREVER-STUDIO-AMENITIES-CORE-001: Owner-controlled project amenities.
--
-- WHY THIS EXISTS
-- ---------------
-- The public "Facilities & Amenities" section reads exactly one relation:
-- `public.project_amenities` embedded with its `public.amenities` parent. That
-- relation carries `(project_id, amenity_id, note, created_at)` and nothing
-- else, so the buyer-facing list has no editorial order and no way to lead
-- with the amenities that actually sell the project. This migration adds the
-- two columns that fix that, and the one transactional function that lets the
-- Studio Owner set them.
--
-- WHAT THIS ADDS
-- --------------
--   1. `project_amenities.is_featured BOOLEAN NOT NULL DEFAULT false`
--   2. `project_amenities.sort_order  INTEGER NOT NULL DEFAULT 0`
--      with `CHECK (sort_order >= 0)`
--   3. `public.studio_save_project_amenities(...)` — one all-or-nothing
--      reconcile of one project's amenity set.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
--   * It writes no project data. No row of `project_amenities` is inserted,
--     updated or deleted by this migration; both columns arrive on existing
--     rows at their declared defaults, which is exactly the behaviour those
--     rows already have (unfeatured, unordered).
--   * It does not touch `public.facilities` or `public.project_facilities`.
--     Those are the legacy inventory tables from FDB-001. They are not the
--     canonical amenity model, no active application code reads or writes
--     them, and this migration leaves their DDL, RLS and grants untouched.
--   * It revokes nothing. `project_amenities` and `amenities` keep the
--     table-level `SELECT` grant to `anon, authenticated` that the public
--     embed depends on, and a table-level grant covers columns added later,
--     so the two new columns are readable by the public projection without a
--     further grant.
--   * It adds no index. See "INDEXING" below.
--
-- IS THE ADDITION SAFE ON A POPULATED TABLE?
-- ------------------------------------------
-- Yes. Both columns are `NOT NULL DEFAULT <constant>`, which PostgreSQL 11+
-- applies as a catalog-only default — no table rewrite, no row lock beyond
-- the brief ACCESS EXCLUSIVE needed for the catalog update. The `CHECK` is
-- added in the same statement as the column it constrains, so it is validated
-- against the constant default rather than scanned over existing rows.
--
-- INDEXING
-- --------
-- Deliberately none. `project_amenities` is keyed `(project_id, amenity_id)`,
-- so the primary-key btree already serves every access this feature performs:
-- the public embed and the reconcile both filter on `project_id` alone, which
-- is the key's leading column. Ordering happens after the fetch — in the
-- public mapper for the page, and in a per-project `ORDER BY` of at most a
-- few dozen rows inside the function below — and PostgreSQL sorts that in
-- memory rather than walking an index. A `(project_id, is_featured, sort_order)`
-- index was considered and rejected: query analysis on the real cardinality
-- (102 assignment rows across 6 projects in the source map, no project above
-- 30) shows the planner choosing the PK scan and an in-memory sort either way,
-- so the index would cost write amplification on every save and buy nothing.
-- It becomes justified only if a future query orders across many projects at
-- once, which no reader does today.
--
-- ROLLBACK
-- --------
-- Fully reversible, and reversing it loses only the editorial ordering:
--
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.studio_save_project_amenities(
--     uuid, uuid, jsonb, jsonb, timestamptz, boolean);
--   ALTER TABLE public.project_amenities
--     DROP CONSTRAINT IF EXISTS project_amenities_sort_order_non_negative;
--   ALTER TABLE public.project_amenities DROP COLUMN IF EXISTS sort_order;
--   ALTER TABLE public.project_amenities DROP COLUMN IF EXISTS is_featured;
--   COMMIT;
--
-- The `(project_id, amenity_id, note, created_at)` tuples — the amenity set
-- itself — survive that rollback untouched, because the function never
-- rewrites a row it did not need to change.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The two additive columns.
-- ---------------------------------------------------------------------------

ALTER TABLE public.project_amenities
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.project_amenities
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- A separate, idempotent statement: ADD COLUMN IF NOT EXISTS cannot carry a
-- named table constraint, and re-running the migration must not fail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_amenities'::regclass
      AND conname = 'project_amenities_sort_order_non_negative'
  ) THEN
    ALTER TABLE public.project_amenities
      ADD CONSTRAINT project_amenities_sort_order_non_negative
      CHECK (sort_order >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.project_amenities.is_featured IS
  'Owner-selected: lead the public Facilities & Amenities list with this one. At most 8 per project, enforced by studio_save_project_amenities.';
COMMENT ON COLUMN public.project_amenities.sort_order IS
  'Owner-selected order within the featured and non-featured groups. Non-negative; ties fall back to category, name, slug.';

-- ---------------------------------------------------------------------------
-- 2. The one transactional save.
-- ---------------------------------------------------------------------------
--
-- AUTHORIZATION. `SECURITY INVOKER` with a locked empty search_path, granted
-- to `service_role` only and revoked from PUBLIC, anon and authenticated —
-- the house pattern for every Studio write function. It grants no privilege
-- the caller does not already hold, and no browser session can reach it. The
-- acting user arrives as `p_actor_id` from the app server, which has already
-- verified the caller's Supabase JWT; this function re-verifies that the id
-- belongs to an active `studio_members` row whose role is `owner`, holding
-- that row `FOR SHARE` so a concurrent deactivation cannot race the write.
--
-- ATOMICITY. One function call is one statement, so every validation and
-- every write below either commits together or leaves the project's amenity
-- set exactly as it was. `p_inject_failure` exists only so the disposable
-- PostgreSQL suite can prove that.
--
-- IDEMPOTENCE. The reconcile is `DELETE` of the deselected links plus
-- `INSERT ... ON CONFLICT DO UPDATE` of the requested ones, so replaying the
-- same input a second time writes the same set and preserves each surviving
-- row's original `created_at`.
--
-- SCOPE. Every statement is filtered on `project_id = p_project_id`. No other
-- project's links are read, written or deleted, and no unit, price, media,
-- building, developer or document row is touched at all.
--
-- INPUT SHAPE.
--   p_amenities         JSONB array, the EXACT set the project should end with:
--                         [{"amenity_slug": "swimming-pool",
--                           "note": "Two lap pools and a lagoon pool",
--                           "is_featured": true,
--                           "sort_order": 10}, ...]
--                       An empty array is valid and means "this project has no
--                       amenities"; it clears the set.
--   p_created_amenities JSONB array, canonical amenities the Owner explicitly
--                       chose to create in this save, and nothing else:
--                         [{"name": "Kids Club", "slug": "kids-club",
--                           "category": "Family & Children", "icon": "baby"}]
--                       A slug that already exists is rejected, never merged.
--                       Every entry must also appear in `p_amenities`: creating
--                       an amenity is a side effect of selecting one that does
--                       not exist yet, never an independent operation, because
--                       `amenities` is a shared catalogue with no delete path.

CREATE OR REPLACE FUNCTION public.studio_save_project_amenities(
  p_project_id UUID,
  p_actor_id UUID,
  p_amenities JSONB,
  p_created_amenities JSONB DEFAULT '[]'::jsonb,
  p_supplied_at TIMESTAMPTZ DEFAULT now(),
  p_inject_failure BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actor_role TEXT;
  v_project_id UUID;
  v_requested JSONB := COALESCE(p_amenities, '[]'::jsonb);
  v_created JSONB := COALESCE(p_created_amenities, '[]'::jsonb);
  -- The requested set, normalised once into
  -- [{"slug":…, "note":…, "is_featured":…, "sort_order":…}] so every statement
  -- below reads the same trimmed, defaulted, type-checked values. A plpgsql
  -- variable rather than a temporary table: this function runs with
  -- `search_path = ''`, which does not search `pg_temp`.
  v_norm JSONB;
  v_featured_count INTEGER;
  v_missing TEXT;
  v_saved JSONB;
BEGIN
  -- 1. The acting user must be an active Studio Owner.
  SELECT role INTO v_actor_role
  FROM public.studio_members
  WHERE user_id = p_actor_id AND is_active
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'studio_membership_required';
  END IF;
  IF v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'studio_owner_required';
  END IF;

  -- 2. The project must exist. FOR UPDATE serialises two concurrent saves of
  --    the same project, so an exact-set reconcile cannot interleave with
  --    another one and leave a union of the two sets behind.
  SELECT id INTO v_project_id
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- 3. Both inputs must be arrays. A bare object or a string is a caller bug,
  --    not an empty set, and must not be read as "delete everything".
  IF jsonb_typeof(v_requested) <> 'array' THEN
    RAISE EXCEPTION 'studio_project_amenities_invalid_payload';
  END IF;
  IF jsonb_typeof(v_created) <> 'array' THEN
    RAISE EXCEPTION 'studio_project_amenities_invalid_payload';
  END IF;

  -- ------------------------------------------------------------------
  -- 4. Validate the COMPLETE requested set before writing anything.
  -- ------------------------------------------------------------------

  -- 4a. Every element must be an object, and `is_featured` / `sort_order` must
  --     be of the right JSON type. Checking the type before casting turns what
  --     would be a raw `invalid input syntax for type integer` into a named
  --     contract violation the app layer can recognise.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_requested) AS entry
    WHERE jsonb_typeof(entry) <> 'object'
       OR COALESCE(jsonb_typeof(entry->'is_featured'), 'null') NOT IN ('boolean', 'null')
       OR COALESCE(jsonb_typeof(entry->'sort_order'), 'null') NOT IN ('number', 'null')
  ) THEN
    RAISE EXCEPTION 'studio_project_amenities_invalid_payload';
  END IF;

  -- A fractional sort_order is rejected rather than rounded: the Owner's
  -- ordering is an explicit integer sequence, not an approximation.
  --
  -- The magnitude bound matters as much as the shape. `::integer` on a value
  -- above int4 raises `22003 value out of range`, which is exactly the raw
  -- PostgreSQL error this block exists to prevent — and because the numeric
  -- comparison below happens BEFORE the cast at 'sort_order', a caller can no
  -- longer reach it. `::numeric` is unbounded, so it can hold any digit string
  -- the regex admitted, however long.
  --
  -- 1,000,000 rather than int4 max: a hand-ordered list of amenities has tens of
  -- entries, and the editor renumbers in steps of ten, so a million is already
  -- four orders of magnitude of headroom. A bound the domain can explain is
  -- better than one that merely mirrors the column type.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_requested) AS entry
    WHERE entry->>'sort_order' IS NOT NULL
      AND (entry->>'sort_order' !~ '^-?[0-9]+$'
           OR (entry->>'sort_order')::numeric < 0
           OR (entry->>'sort_order')::numeric > 1000000)
  ) THEN
    RAISE EXCEPTION 'studio_project_amenities_invalid_sort_order';
  END IF;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'slug', btrim(COALESCE(entry->>'amenity_slug', '')),
      'note', NULLIF(btrim(COALESCE(entry->>'note', '')), ''),
      'is_featured', COALESCE((entry->>'is_featured')::boolean, false),
      'sort_order', COALESCE((entry->>'sort_order')::integer, 0)
    )),
    '[]'::jsonb)
  INTO v_norm
  FROM jsonb_array_elements(v_requested) AS entry;

  -- 4b. Every requested entry needs a usable slug.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_norm) AS r(slug TEXT)
    WHERE r.slug = ''
  ) THEN
    RAISE EXCEPTION 'studio_project_amenities_slug_required';
  END IF;

  -- 4c. The same amenity may not be requested twice: the caller would be
  --     asking for two different notes on one link.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_norm) AS r(slug TEXT)
    GROUP BY r.slug HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'studio_project_amenities_duplicate_slug';
  END IF;

  -- 4d. sort_order is non-negative. The CHECK constraint would catch this at
  --     INSERT time, but raising here keeps the failure a named contract
  --     violation rather than a constraint name leaking to the app layer.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_norm) AS r(sort_order INTEGER)
    WHERE r.sort_order < 0
  ) THEN
    RAISE EXCEPTION 'studio_project_amenities_invalid_sort_order';
  END IF;

  -- 4e. At most 8 featured amenities. A public page that leads with everything
  --     leads with nothing.
  SELECT count(*) INTO v_featured_count
  FROM jsonb_to_recordset(v_norm) AS r(is_featured BOOLEAN)
  WHERE r.is_featured;
  IF v_featured_count > 8 THEN
    RAISE EXCEPTION 'studio_project_amenities_featured_limit';
  END IF;

  -- 4f. Validate the amenities the Owner asked to create.
  IF jsonb_array_length(v_created) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_created) AS entry
      WHERE btrim(COALESCE(entry->>'slug', '')) = ''
         OR btrim(COALESCE(entry->>'name', '')) = ''
    ) THEN
      RAISE EXCEPTION 'studio_amenity_name_and_slug_required';
    END IF;
    -- Kebab-case, so a slug stays a stable URL-safe key.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_created) AS entry
      WHERE btrim(entry->>'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ) THEN
      RAISE EXCEPTION 'studio_amenity_slug_invalid';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_created) AS entry
      GROUP BY btrim(entry->>'slug') HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'studio_amenity_slug_duplicate';
    END IF;
    -- An existing slug is a different record with the same name. Reject it;
    -- never merge two amenities behind the Owner's back.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_created) AS entry
      JOIN public.amenities a ON a.slug = btrim(entry->>'slug')
    ) THEN
      RAISE EXCEPTION 'studio_amenity_slug_exists';
    END IF;
    -- Every created amenity must be one this project is selecting.
    --
    -- `amenities` is a SHARED catalogue with no delete path anywhere in this
    -- feature, so a row created here is permanent for every project. Without
    -- this check a caller could grow it with rows nothing references — the exact
    -- pollution the Studio editor's close-match warning exists to prevent, but
    -- reachable straight past it. Creation is a side effect of selecting
    -- something that does not exist yet; it is not an independent operation.
    SELECT string_agg(orphan.slug, ', ' ORDER BY orphan.slug) INTO v_missing
    FROM (
      SELECT btrim(entry->>'slug') AS slug
      FROM jsonb_array_elements(v_created) AS entry
    ) orphan
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(v_norm) AS r(slug TEXT)
      WHERE r.slug = orphan.slug
    );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'studio_amenity_created_unused: %', v_missing;
    END IF;
  END IF;

  -- 4g. Every requested slug must resolve — either to an amenity that already
  --     exists, or to one this same call is creating. Nothing is invented.
  SELECT string_agg(r.slug, ', ' ORDER BY r.slug) INTO v_missing
  FROM jsonb_to_recordset(v_norm) AS r(slug TEXT)
  WHERE NOT EXISTS (SELECT 1 FROM public.amenities a WHERE a.slug = r.slug)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_created) AS entry
      WHERE btrim(entry->>'slug') = r.slug
    );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'studio_amenity_not_found: %', v_missing;
  END IF;

  -- ------------------------------------------------------------------
  -- 5. Write. Everything below this line is inside the same transaction as
  --    every check above it.
  -- ------------------------------------------------------------------

  -- 5a. Create only what the Owner explicitly asked to create. A plain INSERT,
  --     so a concurrent creation of the same slug raises a unique violation
  --     and rolls the whole save back rather than silently adopting the other
  --     row.
  IF jsonb_array_length(v_created) > 0 THEN
    INSERT INTO public.amenities (slug, name, category, icon)
    SELECT
      btrim(entry->>'slug'),
      btrim(entry->>'name'),
      NULLIF(btrim(COALESCE(entry->>'category', '')), ''),
      NULLIF(btrim(COALESCE(entry->>'icon', '')), '')
    FROM jsonb_array_elements(v_created) AS entry;
  END IF;

  -- 5b. Remove only the links this project explicitly deselected. The filter
  --     is `project_id = p_project_id`, so no other project loses a link.
  DELETE FROM public.project_amenities pa
  WHERE pa.project_id = p_project_id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_norm) AS r(slug TEXT)
      JOIN public.amenities a ON a.slug = r.slug
      WHERE a.id = pa.amenity_id
    );

  -- 5c. Upsert the requested set. ON CONFLICT DO UPDATE keeps the original
  --     created_at of a link that was already there, which is what makes an
  --     exact replay a no-op rather than a re-dated row.
  INSERT INTO public.project_amenities (project_id, amenity_id, note, is_featured, sort_order)
  SELECT p_project_id, a.id, r.note, r.is_featured, r.sort_order
  FROM jsonb_to_recordset(v_norm) AS r(slug TEXT, note TEXT, is_featured BOOLEAN, sort_order INTEGER)
  JOIN public.amenities a ON a.slug = r.slug
  ON CONFLICT (project_id, amenity_id) DO UPDATE
    SET note = EXCLUDED.note,
        is_featured = EXCLUDED.is_featured,
        sort_order = EXCLUDED.sort_order;

  -- 5d. Rollback proof hook. Production callers always pass false.
  IF p_inject_failure THEN
    RAISE EXCEPTION 'studio_project_amenities_injected_failure';
  END IF;

  -- ------------------------------------------------------------------
  -- 6. Return the saved canonical state, in public display order:
  --    featured first, then sort_order, then category, name, slug.
  -- ------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(row_state ORDER BY ord_featured, ord_sort, ord_category, ord_name, ord_slug), '[]'::jsonb)
  INTO v_saved
  FROM (
    SELECT
      jsonb_build_object(
        'amenity_id', a.id::text,
        'slug', a.slug,
        'name', a.name,
        'category', COALESCE(a.category, ''),
        'icon', COALESCE(a.icon, ''),
        'note', COALESCE(pa.note, ''),
        'is_featured', pa.is_featured,
        'sort_order', pa.sort_order
      ) AS row_state,
      CASE WHEN pa.is_featured THEN 0 ELSE 1 END AS ord_featured,
      pa.sort_order AS ord_sort,
      COALESCE(a.category, '') AS ord_category,
      a.name AS ord_name,
      a.slug AS ord_slug
    FROM public.project_amenities pa
    JOIN public.amenities a ON a.id = pa.amenity_id
    WHERE pa.project_id = p_project_id
  ) ordered;

  RETURN jsonb_build_object(
    'project_id', p_project_id::text,
    'saved_at', p_supplied_at,
    'created_amenity_slugs', COALESCE(
      (SELECT jsonb_agg(btrim(entry->>'slug') ORDER BY btrim(entry->>'slug'))
       FROM jsonb_array_elements(v_created) AS entry),
      '[]'::jsonb),
    'amenities', v_saved,
    'selected_count', jsonb_array_length(v_saved),
    'featured_count', v_featured_count
  );
END;
$$;

COMMENT ON FUNCTION public.studio_save_project_amenities(uuid, uuid, jsonb, jsonb, timestamptz, boolean) IS
  'FOREVER-STUDIO-AMENITIES-CORE-001: one all-or-nothing reconcile of one project''s canonical amenity set, for an active Studio Owner. Service-role only.';

REVOKE ALL ON FUNCTION public.studio_save_project_amenities(uuid, uuid, jsonb, jsonb, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_save_project_amenities(uuid, uuid, jsonb, jsonb, timestamptz, boolean)
  TO service_role;

COMMIT;
