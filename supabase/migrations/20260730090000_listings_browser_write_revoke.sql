-- FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001
-- Revoke browser table-write privileges everywhere in schema `public` except the
-- one approved exception: INSERT on `public.leads`.
--
-- WHY THIS EXISTS
-- ---------------
-- A security review found that `public.listings` is writable by the browser roles
-- at the PRIVILEGE layer. Tracing it showed `listings` is not special: every
-- table in `public` that a migration created inherited
--
--     pg_default_acl:  postgres | public | r | anon=arwdDxtm/postgres
--                                            authenticated=arwdDxtm/postgres
--
-- from the Supabase bootstrap default. No migration in this repository ever
-- granted a browser role INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
-- or MAINTAIN — with exactly one deliberate exception, `GRANT INSERT ON
-- public.leads` in 20260704132000_create_leads.sql. So the finding names one
-- table but the cause is schema-wide, and fixing only `listings` would leave 28
-- other tables in the same state and would not stop the next migration from
-- recreating it. This migration closes the cause.
--
-- WHAT RLS DOES AND DOES NOT DO HERE
-- ----------------------------------
-- Row-level security is enabled on every table in `public` and there is exactly
-- one browser-facing write policy in the whole schema — `leads` INSERT. That is
-- a real barrier, and it is NOT the barrier this migration replaces. It is worth
-- being exact about what row policies can and cannot reach:
--
--   * INSERT is refused today because no policy supplies a WITH CHECK.
--   * UPDATE and DELETE do not raise at all. RLS filters every candidate row out
--     first, so the statement succeeds having matched zero rows. A privilege that
--     "fails silently" is one permissive policy away from succeeding loudly.
--   * TRUNCATE is not governed by row policies. At all. Nothing in RLS looks at
--     it. Today the only thing standing between the browser roles and TRUNCATE on
--     29 tables is that PostgREST and pg_graphql expose no TRUNCATE verb — a
--     transport boundary, not a database boundary.
--   * REFERENCES, TRIGGER and MAINTAIN are likewise outside row security.
--   * RLS never constrains the table owner, a superuser, or a BYPASSRLS role.
--     `service_role` and `postgres` both carry BYPASSRLS in production.
--
-- So the accurate statement is: for the DML verbs there is one control (RLS), and
-- for TRUNCATE/REFERENCES/TRIGGER/MAINTAIN there is none inside the database.
-- After this migration a browser role is refused by PRIVILEGE before RLS is ever
-- consulted, and each barrier independently suffices. This adds a layer; it does
-- not remove one. No policy is created, altered or dropped by this file.
--
-- WHAT IS DELIBERATELY PRESERVED
-- ------------------------------
--   * Every table-level SELECT grant — the 24 tables the public catalogue reads.
--   * Every COLUMN-level SELECT grant made by 20260723130000, 20260726140000 and
--     20260728120000 (186 column grants across projects, units, buildings,
--     developers, project_media and investment_data). Naming the seven write
--     privileges explicitly, instead of `REVOKE ALL`, is what makes that safe: a
--     column-less `REVOKE ALL` removes COLUMN grants too and would blank the
--     catalogue and every project page. This file contains no `REVOKE ALL` and no
--     `REVOKE ... SELECT`, and the migration verifies at COMMIT time that the
--     SELECT surface it started with is byte-identical to the one it ends with.
--   * `INSERT ON public.leads TO anon, authenticated` — the public contact form,
--     restated explicitly in section 2. Both roles are intended: the base
--     migration grants INSERT to both and the "Anyone can submit a lead" policy
--     names both.
--   * All `service_role` privileges, all owner privileges, all
--     `forever_import_execution_owner` privileges, every RLS policy, the RLS
--     enabled/forced state, and the publication set.
--
-- FORCE ROW LEVEL SECURITY IS DELIBERATELY NOT ENABLED. It would subject the
-- table owner to RLS, and `forever_project_media_semantic_projection`,
-- `forever_project_cover_reconcile` and `forever_project_cover_withdraw` are
-- SECURITY DEFINER functions owned by `postgres`. With FORCE on and no write
-- policies present, every one of them would begin failing. `relforcerowsecurity`
-- must stay false.
--
-- ONE THING THIS MIGRATION CANNOT FIX
-- -----------------------------------
-- Schema `public` carries TWO table default-ACL entries, one per defining owner
-- role. Section 3 discovers them from `pg_default_acl` rather than assuming names:
--
--   * `postgres` — the migration executor and the owner of all 37 existing tables.
--     This is the entry the migration chain actually exercises, and a role may
--     always alter its own defaults. Section 3 corrects it.
--   * `supabase_admin` — the platform superuser. `ALTER DEFAULT PRIVILEGES FOR
--     ROLE supabase_admin` requires membership in `supabase_admin`; `postgres` is
--     not a superuser and holds no such membership, so the statement would raise
--     42501 and abort this migration. Section 3 therefore does not attempt it. It
--     raises a WARNING naming the role and the exact corrective statement, and
--     records it in the migration's own output rather than passing over it. No
--     object in `public` is owned by `supabase_admin`, so that default has never
--     been exercised in this schema — but it is real, and closing it requires a
--     session acting as `supabase_admin`, which is outside the authority of any
--     repository migration.
--
-- SHAPE
-- -----
-- Atomic. Idempotent — `REVOKE` of a privilege not held is a silent no-op and so
-- is `ALTER DEFAULT PRIVILEGES ... REVOKE`. Catalog-only: `REVOKE` rewrites
-- `pg_class.relacl` and takes ACCESS EXCLUSIVE for microseconds with no heap scan
-- and no rewrite; `lock_timeout` is set so the migration yields rather than queues
-- behind a long-running reader. No row DML. It creates no Studio member, job,
-- archive or amenity, changes no publication, and contains no credential,
-- project reference or environment value. Section 4 verifies the postcondition
-- and aborts the whole transaction if the invariant was not reached.

BEGIN;

-- REVOKE is a catalog update, not a data operation. Yield rather than queue.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Snapshot the SELECT surface, then remove every browser write privilege
--    from every table in `public`.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_write_privs TEXT;
  v_rel         RECORD;
  v_tables      INT := 0;
  v_select_fp   TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION
      'roles anon and authenticated must both exist before the browser-write contract can be defined';
  END IF;

  -- The SELECT surface, table-level and column-level, before any change. Section 4
  -- recomputes this and refuses to commit if it moved. A migration that claims to
  -- preserve public reads should be able to prove it, not assert it.
  SELECT md5(string_agg(entry, E'\n' ORDER BY entry)) INTO v_select_fp
  FROM (
    SELECT c.relname || '|' || w.rolname || '|TABLE_SELECT|'
             || has_table_privilege(w.rolname::name, c.oid, 'SELECT')::text AS entry
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS w(rolname)
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    UNION ALL
    SELECT c.relname || '.' || a.attname || '|'
             || COALESCE(gr.rolname::text, 'PUBLIC') || '|COLUMN_' || e.privilege_type || '|true' AS entry
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS e
    LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = e.grantee
    WHERE n.nspname = 'public'
      AND a.attacl IS NOT NULL AND a.attnum > 0 AND NOT a.attisdropped
      AND COALESCE(gr.rolname::text, 'PUBLIC') IN ('anon', 'authenticated')
  ) s;
  PERFORM set_config('forever.lbwr_select_fp', COALESCE(v_select_fp, 'EMPTY'), false);

  -- MAINTAIN arrived in PostgreSQL 17. Naming it on an older server is a syntax
  -- error, so the privilege list is assembled from the live server version.
  v_write_privs := 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';
  IF current_setting('server_version_num')::int >= 170000 THEN
    v_write_privs := v_write_privs || ', MAINTAIN';
  END IF;

  -- Every ordinary and partitioned table, discovered from the catalog rather than
  -- listed by hand. A hand-written list silently misses whatever it was written
  -- before; this cannot. Partitions are included in their own right — a privilege
  -- held on a partition is a privilege held.
  FOR v_rel IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    -- `leads` is swept here too and its INSERT is restored in section 2. Both
    -- happen in one transaction, so no window exists in which the contact form
    -- has lost its grant.
    EXECUTE format('REVOKE %s ON TABLE public.%I FROM anon, authenticated',
                   v_write_privs, v_rel.relname);
    -- A PUBLIC-derived write privilege is not removable by revoking from the
    -- individual role, so PUBLIC is revoked separately. No table in `public`
    -- currently grants PUBLIC anything, which makes this a documented no-op
    -- today and a closed door tomorrow.
    EXECUTE format('REVOKE %s ON TABLE public.%I FROM PUBLIC',
                   v_write_privs, v_rel.relname);
    v_tables := v_tables + 1;
  END LOOP;

  RAISE NOTICE 'FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001: swept % table(s) in schema public (privileges: %)',
    v_tables, v_write_privs;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The one approved browser table write, restated explicitly.
-- ---------------------------------------------------------------------------
--
-- `src/lib/lead-service.ts` calls `.insert(payload)` with NO chained `.select()`,
-- so supabase-js sends `Prefer: return=minimal` and the statement carries no
-- RETURNING clause. INSERT alone is therefore sufficient. Adding `.select()` to
-- that call in future would need SELECT as well; the disposable suite proves both
-- halves of that so the failure would be understood rather than mysterious.
--
-- SELECT on `leads` is NOT revoked by this migration. `anon` holding SELECT on the
-- lead table is a real finding — RLS is the only thing withholding prospect names,
-- emails and phone numbers today, because `leads` has no SELECT policy — but
-- removing it changes what PostgREST answers, which is a visible behavioural
-- change and a separate decision. This migration's contract is table WRITES.
-- Every existing SELECT grant, including this one, is preserved unchanged and the
-- `leads` SELECT question is carried forward as a recommendation, not silently
-- resolved here.
GRANT INSERT ON TABLE public.leads TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stop the leak at the source: a new table must not be born browser-writable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_write_privs   TEXT;
  v_def           RECORD;
  v_fixed         TEXT[] := ARRAY[]::TEXT[];
  v_unauthorized  TEXT[] := ARRAY[]::TEXT[];
BEGIN
  v_write_privs := 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';
  IF current_setting('server_version_num')::int >= 170000 THEN
    v_write_privs := v_write_privs || ', MAINTAIN';
  END IF;

  -- Discover the defining owner roles from the catalog. Guessing a role name here
  -- would either miss an entry or invent one. `current_user` is included even when
  -- it has no entry yet, so a database whose default was never widened still ends
  -- up explicitly private-by-default for tables this executor creates.
  --
  -- SELECT is not touched. Removing default SELECT would change the birth state of
  -- every future public table from readable to unreadable — a different contract,
  -- with its own visible consequences, and not one this task was asked to change.
  FOR v_def IN
    SELECT DISTINCT role_name, authorized
    FROM (
      SELECT owner.rolname::text AS role_name,
             pg_has_role(current_user, owner.oid, 'USAGE') AS authorized
      FROM pg_catalog.pg_default_acl d
      JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
      JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
      LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
      WHERE n.nspname = 'public'
        AND d.defaclobjtype = 'r'
        AND COALESCE(gr.rolname::text, 'PUBLIC') IN ('anon', 'authenticated', 'PUBLIC')
        AND a.privilege_type <> 'SELECT'
      UNION ALL
      SELECT current_user::text, true
    ) candidates
    ORDER BY role_name
  LOOP
    IF v_def.authorized THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE %s ON TABLES FROM anon, authenticated',
        v_def.role_name, v_write_privs);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
        'REVOKE %s ON TABLES FROM PUBLIC',
        v_def.role_name, v_write_privs);
      v_fixed := v_fixed || v_def.role_name;
    ELSE
      -- Recorded loudly rather than passed over. Aborting instead would make the
      -- migration unappliable and would fix nothing at all.
      v_unauthorized := v_unauthorized || v_def.role_name;
      RAISE WARNING
        'FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001: cannot correct the schema-public TABLES default for defining role %. '
        'The migration executor (%) is not a member of it, so ALTER DEFAULT PRIVILEGES FOR ROLE % would raise 42501. '
        'Required correction, to be run by a session acting as that role: '
        'ALTER DEFAULT PRIVILEGES FOR ROLE % IN SCHEMA public REVOKE %s ON TABLES FROM anon, authenticated;',
        v_def.role_name, current_user, v_def.role_name, v_def.role_name, v_write_privs;
    END IF;
  END LOOP;

  RAISE NOTICE 'FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001: default TABLES privileges corrected for role(s) %; not authorized for role(s) %',
    COALESCE(array_to_string(v_fixed, ', '), '<none>'),
    COALESCE(NULLIF(array_to_string(v_unauthorized, ', '), ''), '<none>');
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Verify the postcondition, or take nothing.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rel        RECORD;
  v_role       TEXT;
  v_priv       TEXT;
  v_privs      TEXT[];
  v_violations TEXT[] := ARRAY[]::TEXT[];
  v_select_now TEXT;
  v_select_was TEXT;
BEGIN
  v_privs := ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  IF current_setting('server_version_num')::int >= 170000 THEN
    v_privs := v_privs || ARRAY['MAINTAIN'];
  END IF;

  -- 4a. No browser write privilege survives anywhere, except leads INSERT.
  FOR v_rel IN
    SELECT c.oid, c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY v_privs LOOP
        IF has_table_privilege(v_role::name, v_rel.oid, v_priv)
           AND NOT (v_rel.relname = 'leads' AND v_priv = 'INSERT') THEN
          v_violations := v_violations || (v_role || ' still holds ' || v_priv || ' on public.' || v_rel.relname);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- 4b. The approved exception survived.
  IF NOT has_table_privilege('anon', 'public.leads', 'INSERT') THEN
    v_violations := v_violations || 'anon LOST INSERT on public.leads';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.leads', 'INSERT') THEN
    v_violations := v_violations || 'authenticated LOST INSERT on public.leads';
  END IF;

  -- 4c. The SELECT surface did not move — neither table-level nor column-level.
  SELECT md5(string_agg(entry, E'\n' ORDER BY entry)) INTO v_select_now
  FROM (
    SELECT c.relname || '|' || w.rolname || '|TABLE_SELECT|'
             || has_table_privilege(w.rolname::name, c.oid, 'SELECT')::text AS entry
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS w(rolname)
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    UNION ALL
    SELECT c.relname || '.' || a.attname || '|'
             || COALESCE(gr.rolname::text, 'PUBLIC') || '|COLUMN_' || e.privilege_type || '|true' AS entry
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS e
    LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = e.grantee
    WHERE n.nspname = 'public'
      AND a.attacl IS NOT NULL AND a.attnum > 0 AND NOT a.attisdropped
      AND COALESCE(gr.rolname::text, 'PUBLIC') IN ('anon', 'authenticated')
  ) s;
  v_select_was := current_setting('forever.lbwr_select_fp', true);
  IF COALESCE(v_select_now, 'EMPTY') IS DISTINCT FROM COALESCE(v_select_was, 'MISSING') THEN
    v_violations := v_violations
      || ('the browser SELECT surface changed: before=' || COALESCE(v_select_was, 'MISSING')
          || ' after=' || COALESCE(v_select_now, 'EMPTY'));
  END IF;

  IF array_length(v_violations, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001 postcondition failed: %',
      array_to_string(v_violations, '; ');
  END IF;

  RAISE NOTICE 'FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001: postcondition verified — browser writes limited to leads INSERT, SELECT surface unchanged';
END
$$;

COMMIT;
