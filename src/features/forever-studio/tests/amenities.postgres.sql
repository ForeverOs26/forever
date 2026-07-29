-- FOREVER-STUDIO-AMENITIES-CORE-001 — disposable PostgreSQL proof.
--
-- Runs against the throwaway cluster the runner built, after the COMPLETE
-- migration chain including `20260728160000_studio_project_amenities_editor.sql`.
-- No production or staging credential is involved and no linked Supabase project
-- is reachable; the runner creates the cluster, applies the chain and destroys
-- it.
--
-- The pre-migration rows these assertions read back were written by
-- `amenities-pre-migration-seed.sql`, which the runner applies immediately
-- BEFORE that migration — the only point at which the old four-column shape of
-- `project_amenities` still exists.
--
-- Negative controls are interleaved rather than collected at the end: each one
-- asserts both that the rejection happened and that the stored set is
-- unchanged, because "rejected" and "rejected without landing a subset" are
-- different claims.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'amenities_pg_test_failed: %', message; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

-- AM-1. The two columns exist, with the declared types, nullability and defaults.
SELECT pg_temp.assert_true(
  (SELECT data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false'
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_amenities'
      AND column_name = 'is_featured')
  AND (SELECT data_type = 'integer' AND is_nullable = 'NO' AND column_default = '0'
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_amenities'
      AND column_name = 'sort_order'),
  'AM-1 is_featured boolean NOT NULL DEFAULT false and sort_order integer NOT NULL DEFAULT 0');

-- AM-2. The addition was purely additive: the original four columns are intact
--       and the table gained exactly two.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_amenities'
      AND column_name IN ('project_id', 'amenity_id', 'note', 'created_at')) = 4
  AND (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'project_amenities') = 6,
  'AM-2 the link table gained exactly two columns and lost none');

-- AM-3. Rows that predate the columns survived byte-for-byte — note and
--       created_at included — and both new columns arrived at their defaults
--       rather than as nulls.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.amenities_pre_migration_baseline) = 3
  AND NOT EXISTS (
    SELECT 1 FROM public.amenities_pre_migration_baseline b
    FULL OUTER JOIN public.project_amenities pa
      ON pa.project_id = b.project_id AND pa.amenity_id = b.amenity_id
    WHERE b.project_id IS NULL OR pa.project_id IS NULL
       OR pa.note IS DISTINCT FROM b.note
       OR pa.created_at IS DISTINCT FROM b.created_at)
  AND NOT EXISTS (
    SELECT 1 FROM public.project_amenities
    WHERE is_featured IS DISTINCT FROM false OR sort_order IS DISTINCT FROM 0),
  'AM-3 pre-migration rows survive unchanged and default to unfeatured, unordered');

-- AM-4. NEGATIVE CONTROL: sort_order is constrained non-negative, and the
--       constraint is enforced rather than merely declared.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.project_amenities(project_id, amenity_id, sort_order)
    VALUES ('a0000000-0000-0000-0000-000000000001',
            'a1000000-0000-0000-0000-000000000005', -1);
    RAISE EXCEPTION 'expected_negative_sort_order_rejection_absent';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.project_amenities'::regclass
             AND conname = 'project_amenities_sort_order_non_negative')
  AND (SELECT count(*) FROM public.project_amenities
        WHERE project_id = 'a0000000-0000-0000-0000-000000000001') = 2,
  'AM-4 a negative sort_order is rejected by CHECK and leaves the set unchanged');

-- ---------------------------------------------------------------------------
-- Privilege boundary
-- ---------------------------------------------------------------------------

-- AM-5. The save function is service_role only. No browser session reaches it.
SELECT pg_temp.assert_true(
  has_function_privilege('service_role',
    'public.studio_save_project_amenities(uuid,uuid,jsonb,jsonb,timestamptz,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.studio_save_project_amenities(uuid,uuid,jsonb,jsonb,timestamptz,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.studio_save_project_amenities(uuid,uuid,jsonb,jsonb,timestamptz,boolean)', 'EXECUTE'),
  'AM-5 studio_save_project_amenities is service_role only');

-- AM-6a. The public embed keeps working: the table-level SELECT grant from the
--        base migration covers columns added later, so the two new columns need
--        no grant of their own. SELECT is what the migration deliberately does
--        NOT revoke, and both browser roles must retain it.
SELECT pg_temp.assert_true(
  has_column_privilege('anon', 'public.project_amenities', 'is_featured', 'SELECT')
  AND has_column_privilege('anon', 'public.project_amenities', 'sort_order', 'SELECT')
  AND has_column_privilege('authenticated', 'public.project_amenities', 'sort_order', 'SELECT')
  AND has_table_privilege('anon', 'public.project_amenities', 'SELECT')
  AND has_table_privilege('anon', 'public.amenities', 'SELECT')
  AND has_table_privilege('authenticated', 'public.project_amenities', 'SELECT')
  AND has_table_privilege('authenticated', 'public.amenities', 'SELECT'),
  'AM-6a anon and authenticated both retain SELECT on both amenity tables');

-- AM-6a2. DEFENCE IN DEPTH: the write privileges are gone outright, so a browser
--         role is refused by PRIVILEGE before row-level security is consulted.
--         This is the independent barrier, asserted independently of AM-6b/6c.
--
--         The harness deliberately reproduces the Supabase platform default that
--         grants browser roles broad table access before the Studio migration
--         runs, so this assertion is meaningful rather than trivially true: it
--         fails without the explicit REVOKE.
DO $$
DECLARE
  v_role TEXT;
  v_table TEXT;
  v_priv TEXT;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_table IN ARRAY ARRAY['public.amenities', 'public.project_amenities'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        PERFORM pg_temp.assert_true(
          NOT has_table_privilege(v_role, v_table, v_priv),
          format('AM-6a2 %s must not hold %s on %s', v_role, v_priv, v_table));
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- AM-6a3. service_role is untouched: the Owner's save still works, which is the
--         thing the revoke must not break.
SELECT pg_temp.assert_true(
  has_table_privilege('service_role', 'public.amenities', 'INSERT')
  AND has_table_privilege('service_role', 'public.project_amenities', 'INSERT')
  AND has_table_privilege('service_role', 'public.project_amenities', 'UPDATE')
  AND has_table_privilege('service_role', 'public.project_amenities', 'DELETE')
  AND has_table_privilege('service_role', 'public.amenities', 'SELECT'),
  'AM-6a3 service_role keeps full access to both amenity tables');

-- AM-6b. Row-level security, not the grant, is what makes both tables read-only
--        for a browser role.
--
--        This is worth stating precisely, because a privilege check alone would
--        be misleading. `20260723130000_public_projection_privacy.sql` tightened
--        table-level grants on `projects`, `developers`, `units`,
--        `project_media`, `investment_data` and `unit_price_history`, but
--        deliberately left `amenities` and `project_amenities` on their
--        table-level `SELECT` grant — the amenities embed depends on it. And
--        this harness reproduces the Supabase platform default that grants
--        browser roles broad table access, so in that state `anon` does hold a
--        nominal write privilege here. What stops the write is that RLS is
--        enabled on both tables and NEITHER has an INSERT, UPDATE or DELETE
--        policy. So assert the policy shape, then prove the write actually
--        fails.
SELECT pg_temp.assert_true(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.project_amenities'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.amenities'::regclass)
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('amenities', 'project_amenities')
      AND cmd <> 'SELECT'),
  'AM-6b RLS is enabled on both amenity tables and neither has a write policy');

-- AM-6c. NEGATIVE CONTROL, behavioural: the PRIVILEGE barrier. With the write
--        privileges revoked, every anonymous write now fails on privilege, before
--        row-level security is ever consulted.
DO $$
DECLARE
  v_before JSONB;
  v_after JSONB;
  v_sql TEXT;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'p', pa.project_id, 'a', pa.amenity_id, 'n', pa.note,
           'f', pa.is_featured, 's', pa.sort_order) ORDER BY pa.project_id, pa.amenity_id),
         '[]'::jsonb)
    INTO v_before FROM public.project_amenities pa;

  FOREACH v_sql IN ARRAY ARRAY[
    'INSERT INTO public.project_amenities(project_id, amenity_id) VALUES
       (''a0000000-0000-0000-0000-000000000001'', ''a1000000-0000-0000-0000-000000000005'')',
    'UPDATE public.project_amenities SET is_featured = true, sort_order = 99',
    'DELETE FROM public.project_amenities',
    'INSERT INTO public.amenities(slug, name) VALUES (''anon-invented'', ''Anon Invented'')',
    'UPDATE public.amenities SET name = ''Renamed by anon''',
    'DELETE FROM public.amenities'
  ] LOOP
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE v_sql;
      RESET ROLE;
      RAISE EXCEPTION 'anon_write_unexpectedly_permitted: %', left(v_sql, 50);
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
    END;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'p', pa.project_id, 'a', pa.amenity_id, 'n', pa.note,
           'f', pa.is_featured, 's', pa.sort_order) ORDER BY pa.project_id, pa.amenity_id),
         '[]'::jsonb)
    INTO v_after FROM public.project_amenities pa;

  PERFORM pg_temp.assert_true(
    v_before IS NOT DISTINCT FROM v_after,
    'AM-6c every anonymous write is refused by privilege and changes no row');
  PERFORM pg_temp.assert_true(
    NOT EXISTS (SELECT 1 FROM public.amenities WHERE slug = 'anon-invented')
    AND NOT EXISTS (SELECT 1 FROM public.amenities WHERE name = 'Renamed by anon'),
    'AM-6c no anonymous write changed a single catalogue row');
END $$;

-- AM-6d. NEGATIVE CONTROL, behavioural: the RLS barrier, proved INDEPENDENTLY of
--        the privilege one.
--
--        AM-6c can no longer observe RLS, because privilege now refuses first. So
--        hand the write privileges back inside a transaction that is rolled back,
--        and confirm row-level security still refuses every write on its own.
--        Two barriers each of which independently suffices is the claim; this is
--        the half that would otherwise go untested from here on.
--
--        Note HOW RLS refuses each verb, because they differ and a test expecting
--        only the first would be wrong:
--
--          * INSERT raises 42501 — no policy supplies a WITH CHECK.
--          * UPDATE and DELETE do NOT raise. With no UPDATE or DELETE policy, RLS
--            filters every candidate row out first, so the statement succeeds
--            having matched ZERO rows.

BEGIN;

GRANT INSERT, UPDATE, DELETE ON public.amenities, public.project_amenities
  TO anon, authenticated;

DO $$
DECLARE
  v_before JSONB;
  v_after JSONB;
  v_rows BIGINT;
BEGIN
  PERFORM pg_temp.assert_true(
    has_table_privilege('anon', 'public.project_amenities', 'UPDATE'),
    'AM-6d the temporary grant is in effect, so RLS is what is under test');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'p', pa.project_id, 'a', pa.amenity_id, 'n', pa.note,
           'f', pa.is_featured, 's', pa.sort_order) ORDER BY pa.project_id, pa.amenity_id),
         '[]'::jsonb)
    INTO v_before FROM public.project_amenities pa;

  -- Both INSERTs must still raise, now on the RLS policy rather than the grant.
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO public.project_amenities(project_id, amenity_id)
    VALUES ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005');
    RESET ROLE;
    RAISE EXCEPTION 'rls_link_insert_unexpectedly_succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO public.amenities(slug, name) VALUES ('rls-invented', 'RLS Invented');
    RESET ROLE;
    RAISE EXCEPTION 'rls_catalogue_insert_unexpectedly_succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;

  -- And every UPDATE and DELETE must match zero rows.
  SET LOCAL ROLE anon;
  UPDATE public.project_amenities SET is_featured = true, sort_order = 99;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  PERFORM pg_temp.assert_true(v_rows = 0,
    'AM-6d with the grant restored, RLS still matches no row for an anonymous UPDATE');

  SET LOCAL ROLE anon;
  DELETE FROM public.project_amenities;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  PERFORM pg_temp.assert_true(v_rows = 0,
    'AM-6d with the grant restored, RLS still matches no row for an anonymous DELETE');

  SET LOCAL ROLE anon;
  UPDATE public.amenities SET name = 'Renamed under RLS';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  PERFORM pg_temp.assert_true(v_rows = 0,
    'AM-6d with the grant restored, RLS still matches no row on the catalogue');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'p', pa.project_id, 'a', pa.amenity_id, 'n', pa.note,
           'f', pa.is_featured, 's', pa.sort_order) ORDER BY pa.project_id, pa.amenity_id),
         '[]'::jsonb)
    INTO v_after FROM public.project_amenities pa;

  PERFORM pg_temp.assert_true(
    v_before IS NOT DISTINCT FROM v_after,
    'AM-6d row-level security alone prevents every anonymous write');
END $$;

ROLLBACK;

-- The temporary grant is gone again, so the privilege barrier is back in force
-- and nothing downstream runs against a weakened schema.
SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.project_amenities', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.amenities', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.project_amenities', 'DELETE'),
  'AM-6d the temporary grant was rolled back and the revoke is in force again');

-- AM-6e. The public embed still RESOLVES for an anonymous visitor. A privilege
--        check alone would not catch a policy or grant change that silently
--        returns nothing, and a failing embed does not hide one section — it
--        fails the whole project query and takes every page down. So read the
--        exact shape `PROJECT_DETAIL_SELECT` reads, as `anon`.
DO $$
DECLARE
  v_rows BIGINT;
  v_featured BOOLEAN;
  v_media BIGINT;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_rows
  FROM public.project_amenities pa
  JOIN public.amenities a ON a.id = pa.amenity_id
  WHERE pa.project_id = 'a0000000-0000-0000-0000-000000000001';
  -- Both new columns are readable in the same projection.
  SELECT bool_and(pa.is_featured IS NOT NULL AND pa.sort_order IS NOT NULL) INTO v_featured
  FROM public.project_amenities pa
  WHERE pa.project_id = 'a0000000-0000-0000-0000-000000000001';
  -- AM-6e2. The amenity columns are only half of what PROJECT_DETAIL_SELECT
  -- asks for in one statement. `project_media.semantic_role` ships with
  -- FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001 and rides the SAME all-or-
  -- nothing failure mode: if either column is missing or ungranted, PostgREST
  -- answers 42703 for the WHOLE select and every project page goes blank, not
  -- one section. Selecting all three as `anon` in a single statement is what
  -- proves the two deploy gates are satisfied together rather than separately.
  SELECT count(*) INTO v_media
  FROM public.project_media pm
  WHERE pm.project_id = 'a0000000-0000-0000-0000-000000000001'
    AND (pm.semantic_role IS NOT NULL OR pm.semantic_role IS NULL);
  RESET ROLE;

  PERFORM pg_temp.assert_true(v_rows = 2,
    'AM-6e an anonymous visitor still reads the project_amenities -> amenities embed');
  PERFORM pg_temp.assert_true(COALESCE(v_featured, false),
    'AM-6e is_featured and sort_order are readable in that same anonymous projection');
  -- The proof is that the SELECT above completed at all: an absent column or a
  -- missing grant raises 42703/42501 there and aborts this block, which is the
  -- production failure this asserts against.
  PERFORM pg_temp.assert_true(v_media >= 0,
    'AM-6e2 anon can select semantic_role in the same full project projection');
END $$;

-- ---------------------------------------------------------------------------
-- Actors and baselines
-- ---------------------------------------------------------------------------

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-00000000a001', 'amenities-owner@example.com', now()),
  ('a0000000-0000-0000-0000-00000000a002', 'amenities-publisher@example.com', now()),
  ('a0000000-0000-0000-0000-00000000a003', 'amenities-retired@example.com', now());
INSERT INTO public.studio_members(user_id, role, email, invited_by, is_active) VALUES
  ('a0000000-0000-0000-0000-00000000a001', 'owner', 'amenities-owner@example.com',
   '00000000-0000-0000-0000-000000000001', true),
  ('a0000000-0000-0000-0000-00000000a002', 'trusted_publisher', 'amenities-publisher@example.com',
   '00000000-0000-0000-0000-000000000001', true),
  ('a0000000-0000-0000-0000-00000000a003', 'owner', 'amenities-retired@example.com',
   '00000000-0000-0000-0000-000000000001', false);

/* A stable projection of one project's amenity set, created_at included, so
   "unchanged" means the stored tuples and not merely the count. */
CREATE OR REPLACE FUNCTION pg_temp.amenity_set(p_project UUID)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'slug', a.slug, 'note', pa.note, 'featured', pa.is_featured,
           'sort', pa.sort_order, 'created', pa.created_at)
         ORDER BY a.slug), '[]'::jsonb)
  FROM public.project_amenities pa JOIN public.amenities a ON a.id = pa.amenity_id
  WHERE pa.project_id = p_project;
$$;

/* Everything the amenities save must never touch. */
CREATE OR REPLACE FUNCTION pg_temp.untouched_fingerprint()
RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'units', (SELECT count(*) FROM public.units),
    'unit_prices', (SELECT count(*) FROM public.unit_price_history),
    'media', (SELECT count(*) FROM public.project_media),
    'buildings', (SELECT count(*) FROM public.buildings),
    'developers', (SELECT count(*) FROM public.developers),
    'documents', (SELECT count(*) FROM public.documents),
    'investment', (SELECT count(*) FROM public.investment_data),
    'projects', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'slug', p.slug, 'name', p.name, 'status', p.public_status,
        'active', p.is_active, 'updated', p.updated_at) ORDER BY p.slug), '[]'::jsonb)
      FROM public.projects p),
    'legacy_facilities', (SELECT count(*) FROM public.facilities),
    'legacy_project_facilities', (SELECT count(*) FROM public.project_facilities));
$$;

CREATE TABLE amenities_baseline AS
SELECT pg_temp.amenity_set('a0000000-0000-0000-0000-000000000001') AS target,
       pg_temp.amenity_set('a0000000-0000-0000-0000-000000000002') AS neighbour,
       pg_temp.untouched_fingerprint() AS untouched;

-- ---------------------------------------------------------------------------
-- Authorization
-- ---------------------------------------------------------------------------

-- AM-7. NEGATIVE CONTROL: an unauthorized save is rejected and changes nothing.
--       A Trusted Publisher is not an Owner; a deactivated Owner is not a
--       member; an unknown id is neither.
DO $$
DECLARE
  v_cases TEXT[][] := ARRAY[
    ARRAY['a0000000-0000-0000-0000-00000000a002', 'studio_owner_required'],
    ARRAY['a0000000-0000-0000-0000-00000000a003', 'studio_membership_required'],
    ARRAY['a0000000-0000-0000-0000-0000000000ff', 'studio_membership_required']];
  v_case TEXT[];
BEGIN
  FOREACH v_case SLICE 1 IN ARRAY v_cases LOOP
    BEGIN
      PERFORM public.studio_save_project_amenities(
        'a0000000-0000-0000-0000-000000000001', v_case[1]::uuid,
        '[{"amenity_slug":"onsen","note":"","is_featured":true,"sort_order":10}]'::jsonb);
      RAISE EXCEPTION 'expected_amenities_authorization_rejection_absent: %', v_case[1];
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> v_case[2] THEN RAISE; END IF;
    END;
  END LOOP;
END $$;
SELECT pg_temp.assert_true(
  pg_temp.amenity_set('a0000000-0000-0000-0000-000000000001')
    IS NOT DISTINCT FROM (SELECT target FROM amenities_baseline),
  'AM-7 publisher, deactivated owner and unknown actor are all rejected, changing nothing');

-- AM-8. NEGATIVE CONTROL: a project that does not exist is rejected.
DO $$
BEGIN
  BEGIN
    PERFORM public.studio_save_project_amenities(
      'a0000000-0000-0000-0000-0000000000ee', 'a0000000-0000-0000-0000-00000000a001',
      '[]'::jsonb);
    RAISE EXCEPTION 'expected_amenities_project_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'project_not_found' THEN RAISE; END IF;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- The save itself
-- ---------------------------------------------------------------------------

-- AM-9. An authorized Owner save succeeds, reconciles to the EXACT requested
--       set, persists note, featured flag and order, and returns the canonical
--       state already in public display order.
DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := public.studio_save_project_amenities(
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001',
    '[{"amenity_slug":"swimming-pool","note":"Two lap pools and a lagoon pool","is_featured":true,"sort_order":10},
      {"amenity_slug":"onsen","note":"Onsen and sauna suite, clubhouse third floor","is_featured":true,"sort_order":20},
      {"amenity_slug":"co-working-space","note":"","is_featured":false,"sort_order":10},
      {"amenity_slug":"landscaped-garden","note":"","is_featured":false,"sort_order":20}]'::jsonb);

  PERFORM pg_temp.assert_true(
    (v_result->>'selected_count')::int = 4 AND (v_result->>'featured_count')::int = 2,
    'AM-9a the return states the selected and featured counts');
  PERFORM pg_temp.assert_true(
    (SELECT jsonb_agg(entry->>'slug') FROM jsonb_array_elements(v_result->'amenities') entry)
      = '["swimming-pool","onsen","co-working-space","landscaped-garden"]'::jsonb,
    'AM-9b the return is ordered featured-first, then by sort_order');
  PERFORM pg_temp.assert_true(
    v_result->'created_amenity_slugs' = '[]'::jsonb,
    'AM-9c a save that creates nothing reports creating nothing');
END $$;

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.project_amenities
    WHERE project_id = 'a0000000-0000-0000-0000-000000000001') = 4
  AND (SELECT pa.note FROM public.project_amenities pa
         JOIN public.amenities a ON a.id = pa.amenity_id
        WHERE pa.project_id = 'a0000000-0000-0000-0000-000000000001'
          AND a.slug = 'swimming-pool') = 'Two lap pools and a lagoon pool'
  AND (SELECT pa.is_featured AND pa.sort_order = 20 FROM public.project_amenities pa
         JOIN public.amenities a ON a.id = pa.amenity_id
        WHERE pa.project_id = 'a0000000-0000-0000-0000-000000000001' AND a.slug = 'onsen')
  AND (SELECT NOT pa.is_featured AND pa.sort_order = 20 FROM public.project_amenities pa
         JOIN public.amenities a ON a.id = pa.amenity_id
        WHERE pa.project_id = 'a0000000-0000-0000-0000-000000000001'
          AND a.slug = 'landscaped-garden')
  -- A blank note is stored as NULL, not as an empty string.
  AND (SELECT pa.note IS NULL FROM public.project_amenities pa
         JOIN public.amenities a ON a.id = pa.amenity_id
        WHERE pa.project_id = 'a0000000-0000-0000-0000-000000000001'
          AND a.slug = 'co-working-space'),
  'AM-9d notes, featured flags and order are persisted');

-- AM-10. Deselection removed ONLY the link the Owner dropped. `fitness-centre`
--        was in the set and is absent from the request. `swimming-pool` was in
--        the set, is in the request, and kept its ORIGINAL created_at — which is
--        what makes the reconcile an update rather than a re-insert, and is why
--        an exact replay is a no-op.
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.project_amenities pa
                JOIN public.amenities a ON a.id = pa.amenity_id
               WHERE pa.project_id = 'a0000000-0000-0000-0000-000000000001'
                 AND a.slug = 'fitness-centre')
  AND (SELECT pa.created_at FROM public.project_amenities pa
         JOIN public.amenities a ON a.id = pa.amenity_id
        WHERE pa.project_id = 'a0000000-0000-0000-0000-000000000001'
          AND a.slug = 'swimming-pool')
      = (SELECT b.created_at FROM public.amenities_pre_migration_baseline b
          WHERE b.project_id = 'a0000000-0000-0000-0000-000000000001'
            AND b.amenity_id = 'a1000000-0000-0000-0000-000000000001')
  -- Deselecting a link never deletes the canonical catalogue record.
  AND EXISTS (SELECT 1 FROM public.amenities WHERE slug = 'fitness-centre'),
  'AM-10 only the deselected link goes, survivors keep created_at, catalogue intact');

-- AM-11. One-project isolation.
SELECT pg_temp.assert_true(
  pg_temp.amenity_set('a0000000-0000-0000-0000-000000000002')
    IS NOT DISTINCT FROM (SELECT neighbour FROM amenities_baseline),
  'AM-11 the neighbouring project links are untouched');

-- AM-12. Replay of the same input is idempotent: same stored tuples, same
--        created_at, no duplicate row, identical return value.
DO $$
DECLARE
  v_first JSONB; v_second JSONB; v_before JSONB;
  v_input JSONB := '[{"amenity_slug":"swimming-pool","note":"Two lap pools and a lagoon pool","is_featured":true,"sort_order":10},
      {"amenity_slug":"onsen","note":"Onsen and sauna suite, clubhouse third floor","is_featured":true,"sort_order":20},
      {"amenity_slug":"co-working-space","note":"","is_featured":false,"sort_order":10},
      {"amenity_slug":"landscaped-garden","note":"","is_featured":false,"sort_order":20}]'::jsonb;
BEGIN
  v_before := pg_temp.amenity_set('a0000000-0000-0000-0000-000000000001');
  v_first := public.studio_save_project_amenities(
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001', v_input);
  v_second := public.studio_save_project_amenities(
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001', v_input);
  PERFORM pg_temp.assert_true(
    v_before IS NOT DISTINCT FROM pg_temp.amenity_set('a0000000-0000-0000-0000-000000000001'),
    'AM-12a replay leaves the stored set identical, created_at included');
  PERFORM pg_temp.assert_true(
    v_first->'amenities' IS NOT DISTINCT FROM v_second->'amenities',
    'AM-12b replay returns the identical canonical state');
  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.project_amenities
      WHERE project_id = 'a0000000-0000-0000-0000-000000000001') = 4,
    'AM-12c replay creates no duplicate link');
END $$;

-- ---------------------------------------------------------------------------
-- Validation — every case a negative control on partial writes
-- ---------------------------------------------------------------------------

-- AM-13. Each rejection fires its own named sentinel AND leaves the stored set
--        exactly as it was. A validation failure must never land a subset.
DO $$
DECLARE
  v_before JSONB := pg_temp.amenity_set('a0000000-0000-0000-0000-000000000001');
  v_cases JSONB := jsonb_build_array(
    jsonb_build_object('why', 'a ninth featured amenity',
      'err', 'studio_project_amenities_featured_limit',
      'set', '[{"amenity_slug":"swimming-pool","is_featured":true,"sort_order":1},
               {"amenity_slug":"fitness-centre","is_featured":true,"sort_order":2},
               {"amenity_slug":"kids-pool","is_featured":true,"sort_order":3},
               {"amenity_slug":"co-working-space","is_featured":true,"sort_order":4},
               {"amenity_slug":"onsen","is_featured":true,"sort_order":5},
               {"amenity_slug":"sauna","is_featured":true,"sort_order":6},
               {"amenity_slug":"golf-simulator","is_featured":true,"sort_order":7},
               {"amenity_slug":"rooftop-bar","is_featured":true,"sort_order":8},
               {"amenity_slug":"kids-club","is_featured":true,"sort_order":9}]',
      'created', '[]'),
    jsonb_build_object('why', 'the same amenity requested twice',
      'err', 'studio_project_amenities_duplicate_slug',
      'set', '[{"amenity_slug":"onsen","sort_order":10},{"amenity_slug":"onsen","sort_order":20}]',
      'created', '[]'),
    jsonb_build_object('why', 'a negative sort_order',
      'err', 'studio_project_amenities_invalid_sort_order',
      'set', '[{"amenity_slug":"onsen","sort_order":-1}]', 'created', '[]'),
    jsonb_build_object('why', 'a fractional sort_order',
      'err', 'studio_project_amenities_invalid_sort_order',
      'set', '[{"amenity_slug":"onsen","sort_order":1.5}]', 'created', '[]'),
    jsonb_build_object('why', 'a blank slug',
      'err', 'studio_project_amenities_slug_required',
      'set', '[{"amenity_slug":"   ","sort_order":0}]', 'created', '[]'),
    jsonb_build_object('why', 'an amenity that does not exist',
      'err', 'studio_amenity_not_found: nothing-like-this',
      'set', '[{"amenity_slug":"nothing-like-this","sort_order":0}]', 'created', '[]'),
    jsonb_build_object('why', 'a non-object entry',
      'err', 'studio_project_amenities_invalid_payload',
      'set', '["onsen"]', 'created', '[]'),
    jsonb_build_object('why', 'a non-boolean is_featured',
      'err', 'studio_project_amenities_invalid_payload',
      'set', '[{"amenity_slug":"onsen","is_featured":"yes","sort_order":0}]', 'created', '[]'),
    jsonb_build_object('why', 'creating a slug that already exists',
      'err', 'studio_amenity_slug_exists',
      'set', '[{"amenity_slug":"sauna","sort_order":0}]',
      'created', '[{"name":"Sauna","slug":"sauna","category":"Fitness & Wellness","icon":"bath"}]'),
    jsonb_build_object('why', 'creating the same slug twice',
      'err', 'studio_amenity_slug_duplicate',
      'set', '[{"amenity_slug":"pickleball","sort_order":0}]',
      'created', '[{"name":"Pickleball","slug":"pickleball","category":"Outdoor & Leisure","icon":"circle"},
                   {"name":"Pickleball Court","slug":"pickleball","category":"Outdoor & Leisure","icon":"circle"}]'),
    jsonb_build_object('why', 'a created slug that is not kebab-case',
      'err', 'studio_amenity_slug_invalid',
      'set', '[{"amenity_slug":"Padel Court","sort_order":0}]',
      'created', '[{"name":"Padel Court","slug":"Padel Court","category":"Outdoor & Leisure","icon":"circle"}]'),
    jsonb_build_object('why', 'a created amenity with no name',
      'err', 'studio_amenity_name_and_slug_required',
      'set', '[{"amenity_slug":"squash-court","sort_order":0}]',
      'created', '[{"name":"  ","slug":"squash-court","category":"","icon":""}]'),
    -- Category is REQUIRED on creation and must come from the closed vocabulary.
    -- The public page groups by it, so free text turns one heading into three.
    jsonb_build_object('why', 'a created amenity with a blank category',
      'err', 'studio_amenity_category_invalid',
      'set', '[{"amenity_slug":"squash-court","sort_order":0}]',
      'created', '[{"name":"Squash Court","slug":"squash-court","category":"","icon":""}]'),
    jsonb_build_object('why', 'a created amenity with a whitespace category',
      'err', 'studio_amenity_category_invalid',
      'set', '[{"amenity_slug":"squash-court","sort_order":0}]',
      'created', '[{"name":"Squash Court","slug":"squash-court","category":"   ","icon":""}]'),
    jsonb_build_object('why', 'a created amenity with an unsupported category',
      'err', 'studio_amenity_category_invalid',
      'set', '[{"amenity_slug":"squash-court","sort_order":0}]',
      'created', '[{"name":"Squash Court","slug":"squash-court","category":"Leisure","icon":""}]'),
    jsonb_build_object('why', 'a created category differing only in case',
      'err', 'studio_amenity_category_invalid',
      'set', '[{"amenity_slug":"squash-court","sort_order":0}]',
      'created', '[{"name":"Squash Court","slug":"squash-court","category":"other","icon":""}]'),
    -- A sort_order above int4. Without the magnitude bound this raised a raw
    -- `22003 value out of range` from the `::integer` cast instead of a named
    -- refusal — the exact failure the type pre-check exists to prevent.
    jsonb_build_object('why', 'a sort_order above int4',
      'err', 'studio_project_amenities_invalid_sort_order',
      'set', '[{"amenity_slug":"onsen","sort_order":2147483648}]', 'created', '[]'),
    jsonb_build_object('why', 'a sort_order above the documented bound',
      'err', 'studio_project_amenities_invalid_sort_order',
      'set', '[{"amenity_slug":"onsen","sort_order":1000001}]', 'created', '[]'),
    -- Creating an amenity the project does not select. `amenities` is shared and
    -- has no delete path, so an unreferenced row created here is permanent
    -- clutter for every project.
    jsonb_build_object('why', 'creating an amenity that is not selected',
      'err', 'studio_amenity_created_unused: ghost-amenity',
      'set', '[]',
      'created', '[{"name":"Ghost","slug":"ghost-amenity","category":"Other","icon":""}]'),
    jsonb_build_object('why', 'creating one used and one unused amenity',
      'err', 'studio_amenity_created_unused: ghost-two',
      'set', '[{"amenity_slug":"ghost-one","sort_order":10}]',
      'created', '[{"name":"Ghost One","slug":"ghost-one","category":"Other","icon":""},
                   {"name":"Ghost Two","slug":"ghost-two","category":"Other","icon":""}]'),
    -- A top-level payload that is not an array must not be read as "clear the set".
    jsonb_build_object('why', 'a non-array requested payload',
      'err', 'studio_project_amenities_invalid_payload',
      'set', '{}', 'created', '[]'),
    jsonb_build_object('why', 'a non-array created payload',
      'err', 'studio_project_amenities_invalid_payload',
      'set', '[]', 'created', '{}'));
  v_case JSONB;
BEGIN
  FOR v_case IN SELECT * FROM jsonb_array_elements(v_cases) LOOP
    BEGIN
      PERFORM public.studio_save_project_amenities(
        'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001',
        (v_case->>'set')::jsonb, (v_case->>'created')::jsonb);
      RAISE EXCEPTION 'expected_amenities_validation_rejection_absent: %', v_case->>'why';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> (v_case->>'err') THEN
        RAISE EXCEPTION 'wrong rejection for %: got "%" want "%"',
          v_case->>'why', SQLERRM, v_case->>'err';
      END IF;
    END;
    PERFORM pg_temp.assert_true(
      v_before IS NOT DISTINCT FROM pg_temp.amenity_set('a0000000-0000-0000-0000-000000000001'),
      'AM-13 a rejected save leaves the set unchanged: ' || (v_case->>'why'));
  END LOOP;
END $$;

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.amenities
               WHERE slug IN ('pickleball', 'padel-court', 'squash-court',
                              'ghost-amenity', 'ghost-one', 'ghost-two')),
  'AM-13b no amenity from a rejected save reached the catalogue');

-- AM-13c. The bound is inclusive at its documented edge: 1,000,000 is accepted,
--         so the two rejections above really are the values beyond it.
DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := public.studio_save_project_amenities(
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001',
    '[{"amenity_slug":"onsen","sort_order":1000000}]'::jsonb);
  PERFORM pg_temp.assert_true(
    (v_result->'amenities'->0->>'sort_order')::bigint = 1000000,
    'AM-13c a sort_order of exactly 1,000,000 is accepted and stored');
END $$;

-- AM-14. Exactly eight featured is allowed: the limit is inclusive, so the
--        rejection above was the ninth and not the eighth.
DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := public.studio_save_project_amenities(
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001',
    '[{"amenity_slug":"swimming-pool","is_featured":true,"sort_order":1},
      {"amenity_slug":"fitness-centre","is_featured":true,"sort_order":2},
      {"amenity_slug":"kids-pool","is_featured":true,"sort_order":3},
      {"amenity_slug":"co-working-space","is_featured":true,"sort_order":4},
      {"amenity_slug":"onsen","is_featured":true,"sort_order":5},
      {"amenity_slug":"sauna","is_featured":true,"sort_order":6},
      {"amenity_slug":"golf-simulator","is_featured":true,"sort_order":7},
      {"amenity_slug":"rooftop-bar","is_featured":true,"sort_order":8},
      {"amenity_slug":"ev-charging","is_featured":false,"sort_order":10}]'::jsonb);
  PERFORM pg_temp.assert_true(
    (v_result->>'featured_count')::int = 8 AND (v_result->>'selected_count')::int = 9,
    'AM-14 eight featured amenities are accepted; the ninth is what is rejected');
END $$;

-- ---------------------------------------------------------------------------
-- Creating a canonical amenity
-- ---------------------------------------------------------------------------

-- AM-15. The Owner creates an amenity that does not exist yet, and it is linked
--        in the same transaction.
DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := public.studio_save_project_amenities(
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001',
    '[{"amenity_slug":"swimming-pool","note":"Two lap pools and a lagoon pool","is_featured":true,"sort_order":10},
      {"amenity_slug":"padel-court","note":"One covered court","is_featured":false,"sort_order":10}]'::jsonb,
    '[{"name":"Padel Court","slug":"padel-court","category":"Outdoor & Leisure","icon":"circle-dot"}]'::jsonb);
  PERFORM pg_temp.assert_true(
    v_result->'created_amenity_slugs' = '["padel-court"]'::jsonb,
    'AM-15a the return names exactly what was created');
END $$;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.amenities WHERE slug = 'padel-court') = 1
  AND (SELECT name = 'Padel Court' AND category = 'Outdoor & Leisure' AND icon = 'circle-dot'
        FROM public.amenities WHERE slug = 'padel-court')
  AND EXISTS (SELECT 1 FROM public.project_amenities pa
                JOIN public.amenities a ON a.id = pa.amenity_id
               WHERE pa.project_id = 'a0000000-0000-0000-0000-000000000001'
                 AND a.slug = 'padel-court' AND pa.note = 'One covered court'),
  'AM-15b the created amenity exists exactly once and is linked with its note');

-- AM-15c. Every one of the nine supported categories is accepted, and the icon
--         stays OPTIONAL — a blank one creates and links normally.
DO $$
DECLARE
  v_categories TEXT[] := ARRAY[
    'Pools & Water', 'Fitness & Wellness', 'Family & Children', 'Work & Social',
    'Outdoor & Leisure', 'Security & Services', 'Parking & Transport',
    'Hospitality & Retail', 'Other'];
  v_category TEXT;
  v_slug TEXT;
  v_index INT := 0;
BEGIN
  FOREACH v_category IN ARRAY v_categories LOOP
    v_index := v_index + 1;
    v_slug := 'vocab-' || v_index::text;
    PERFORM public.studio_save_project_amenities(
      'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001',
      jsonb_build_array(jsonb_build_object('amenity_slug', v_slug, 'sort_order', 10)),
      -- icon omitted entirely, not merely blank.
      jsonb_build_array(jsonb_build_object('name', 'Vocab ' || v_index::text,
                                           'slug', v_slug, 'category', v_category)));
    PERFORM pg_temp.assert_true(
      (SELECT category = v_category AND icon IS NULL FROM public.amenities WHERE slug = v_slug),
      'AM-15c ' || v_category || ' is accepted and the icon stays optional');
  END LOOP;
END $$;

-- AM-15d. Catalogue rows whose category predates the vocabulary stay usable.
--         The rule constrains CREATION only; it must not orphan existing data.
DO $$
DECLARE v_result JSONB;
BEGIN
  -- A legacy row: written directly, as an older ingest would have left it.
  INSERT INTO public.amenities(id, slug, name, category, icon)
  VALUES ('a1000000-0000-0000-0000-00000000ff01', 'legacy-blank', 'Legacy Blank', NULL, NULL);

  v_result := public.studio_save_project_amenities(
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001',
    '[{"amenity_slug":"legacy-blank","note":"Still assignable","sort_order":10}]'::jsonb);

  PERFORM pg_temp.assert_true(
    (v_result->>'selected_count')::int = 1
    AND v_result->'amenities'->0->>'slug' = 'legacy-blank'
    AND v_result->'amenities'->0->>'category' = '',
    'AM-15d a legacy blank-category amenity is still readable and assignable');
  -- And assigning it did not rewrite its category to satisfy the new rule.
  PERFORM pg_temp.assert_true(
    (SELECT category IS NULL FROM public.amenities WHERE slug = 'legacy-blank'),
    'AM-15d assigning a legacy row does not rewrite its category');
END $$;

-- ---------------------------------------------------------------------------
-- Zero amenities, and rollback
-- ---------------------------------------------------------------------------

-- AM-16. Zero amenities is a valid state: the set clears, no catalogue record is
--        deleted, and the project stays published.
DO $$
DECLARE v_result JSONB; v_catalogue BIGINT;
BEGIN
  SELECT count(*) INTO v_catalogue FROM public.amenities;
  v_result := public.studio_save_project_amenities(
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001', '[]'::jsonb);
  PERFORM pg_temp.assert_true(
    (v_result->>'selected_count')::int = 0 AND (v_result->>'featured_count')::int = 0
    AND v_result->'amenities' = '[]'::jsonb,
    'AM-16a an empty set is accepted and reported as empty');
  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.project_amenities
      WHERE project_id = 'a0000000-0000-0000-0000-000000000001') = 0
    AND (SELECT count(*) FROM public.amenities) = v_catalogue
    AND (SELECT is_active AND public_status = 'published' FROM public.projects
          WHERE id = 'a0000000-0000-0000-0000-000000000001'),
    'AM-16b clearing the set deletes no catalogue record and leaves the project published');
END $$;

-- AM-17. TRANSACTIONAL ROLLBACK. Every validation has passed and every write has
--        happened by the time the failure is injected; it must still undo all of
--        them, including the amenity the Owner asked to create.
DO $$
DECLARE
  v_before JSONB := pg_temp.amenity_set('a0000000-0000-0000-0000-000000000001');
  v_catalogue BIGINT;
BEGIN
  SELECT count(*) INTO v_catalogue FROM public.amenities;
  BEGIN
    PERFORM public.studio_save_project_amenities(
      'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000a001',
      '[{"amenity_slug":"onsen","note":"Rolled back","is_featured":true,"sort_order":10},
        {"amenity_slug":"squash-court","note":"Rolled back too","is_featured":false,"sort_order":10}]'::jsonb,
      '[{"name":"Squash Court","slug":"squash-court","category":"Outdoor & Leisure","icon":"circle"}]'::jsonb,
      now(), true);
    RAISE EXCEPTION 'expected_amenities_injected_failure_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'studio_project_amenities_injected_failure' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.assert_true(
    v_before IS NOT DISTINCT FROM pg_temp.amenity_set('a0000000-0000-0000-0000-000000000001')
    AND (SELECT count(*) FROM public.amenities) = v_catalogue
    AND NOT EXISTS (SELECT 1 FROM public.amenities WHERE slug = 'squash-court'),
    'AM-17 an injected failure rolls back the links AND the created amenity');
END $$;

-- ---------------------------------------------------------------------------
-- Scope
-- ---------------------------------------------------------------------------

-- AM-18. Nothing outside the amenity relation moved across this entire battery:
--        no unit, price, media, building, developer, document, investment or
--        project row — and ZERO writes to either legacy facilities table.
SELECT pg_temp.assert_true(
  pg_temp.untouched_fingerprint()
    IS NOT DISTINCT FROM (SELECT untouched FROM amenities_baseline),
  'AM-18 units, prices, media, buildings, developers, documents, investment, projects and both legacy tables unchanged');

-- AM-19. The legacy tables were never written and are still empty — the standing
--        precondition any future deprecation would have to re-prove.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.facilities) = 0
  AND (SELECT count(*) FROM public.project_facilities) = 0,
  'AM-19 zero rows exist in facilities and project_facilities');

-- AM-20. The neighbour survived the whole battery, not merely the first save.
SELECT pg_temp.assert_true(
  pg_temp.amenity_set('a0000000-0000-0000-0000-000000000002')
    IS NOT DISTINCT FROM (SELECT neighbour FROM amenities_baseline),
  'AM-20 the neighbouring project is unchanged after every save, replay and rejection');

-- AM-21. The query analysis behind adding no index, asserted rather than merely
--        claimed in prose: `project_id` is the leading primary-key column, so
--        every per-project read this feature performs is a PK-prefix scan, and
--        the migration added no index of its own.
SELECT pg_temp.assert_true(
  (SELECT pg_get_indexdef(i.indexrelid) LIKE '%(project_id, amenity_id)%'
     FROM pg_index i
    WHERE i.indrelid = 'public.project_amenities'::regclass AND i.indisprimary)
  AND (SELECT count(*) FROM pg_index i
        WHERE i.indrelid = 'public.project_amenities'::regclass) = 2,
  'AM-21 project_id leads the primary key, and the migration added no index');

DROP TABLE amenities_baseline;

SELECT 'ALL AMENITIES POSTGRES ASSERTIONS PASSED' AS result;
