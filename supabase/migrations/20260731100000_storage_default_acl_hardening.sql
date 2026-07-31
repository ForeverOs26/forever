-- FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001
-- Harden the `postgres` role's default privileges for FUTURE tables in schema
-- `storage`, so a table created there is not born browser-writable.
--
-- WHY THIS EXISTS
-- ---------------
-- Migration 20260730090000 closed this defect for schema `public` and, in its
-- section 3, corrected the `postgres` TABLES default there. It was scoped to
-- `public` and did not look at any other schema. A later read-only audit of
-- `pg_default_acl` found the same Supabase bootstrap default still intact in
-- schema `storage` (finding F-03):
--
--     pg_default_acl:  postgres | storage | r |
--       {postgres=arwdDxtm/postgres,       anon=arwdDxtm/postgres,
--        authenticated=arwdDxtm/postgres,  service_role=arwdDxtm/postgres}
--
-- `arwdDxtm` is all eight table privileges: INSERT, SELECT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER and MAINTAIN. So any table `postgres` creates in
-- schema `storage` would be born granting both browser roles every one of them,
-- and `anon` and `authenticated` both hold USAGE on schema `storage`, which is
-- the reach needed to use such a grant. `anon` is the role behind the publishable
-- key that ships in the browser bundle.
--
-- Compare the same row in schema `public`, which 20260730090000 already fixed:
--
--     postgres | public | r |
--       {postgres=arwdDxtm/postgres,       anon=r/postgres,
--        authenticated=r/postgres,         service_role=arwdDxtm/postgres}
--
-- This migration brings the `storage` row to that same shape, and nothing else.
--
-- WHAT IS AND IS NOT AT RISK TODAY
-- --------------------------------
-- There is NO current exposure, and it is worth being exact about why, because
-- the honest reading is weaker than "this is live" and stronger than "this is
-- impossible". Measured read-only against production:
--
--   * Schema `storage` contains 25 relations. Every one is owned by
--     `supabase_storage_admin`. ZERO are owned by `postgres`, so this default has
--     never produced an object in this project.
--   * `has_schema_privilege('postgres','storage','CREATE')` is FALSE. Schema
--     `storage` is owned by `supabase_admin`, and `postgres` is a member of
--     neither `supabase_admin` nor `supabase_storage_admin`. So `postgres` cannot
--     currently create a table in schema `storage` at all.
--   * No code path in this repository creates a table in schema `storage`.
--
-- The defect is therefore LATENT rather than live: it is a loaded default with no
-- present way to fire it. It becomes live the moment `postgres` is granted CREATE
-- on schema `storage` — a platform-side change Forever does not control and would
-- not necessarily be told about — at which point the very next table created
-- there is born granting both browser roles all eight privileges, with no further
-- warning. Correcting the default now costs nothing and removes that trap
-- permanently. This is defence in depth, not incident response, and the severity
-- claimed for it should stay P2.
--
-- That the defect is latent is also exactly why the change is safe. A default ACL
-- is consulted at CREATE TABLE time and at no other time. Changing it cannot
-- reach an object that already exists.
--
-- WHY EXISTING SUPABASE STORAGE BEHAVIOUR IS UNCHANGED
-- ----------------------------------------------------
-- `storage.objects` and `storage.buckets` grant `anon` and `authenticated`
-- `arwdDxtm` DIRECTLY in their own relation ACLs, granted by
-- `supabase_storage_admin` — not inherited from any default. Those grants are
-- what the Storage API and the browser actually use, and this migration does not
-- touch a single existing relation ACL. It contains no `REVOKE` against any
-- table, no `GRANT`, no ownership change, no RLS or policy change, no schema
-- grant, and no row DML. Section 3 proves all of that by fingerprint before it
-- allows the transaction to commit.
--
-- SELECT IS DELIBERATELY PRESERVED
-- --------------------------------
-- Only the seven write privileges are revoked. Default SELECT stays exactly as it
-- is, for the same reason 20260730090000 left it alone in `public`: removing it
-- would change the birth state of a future table from readable to unreadable,
-- which is a different contract with its own visible consequences and is not what
-- this task was asked to change. The end state for the browser roles is `r` —
-- read, and nothing else.
--
-- AUTHORITY — WHY THIS ONE IS SELF-SERVICE
-- ----------------------------------------
-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` requires the caller to hold the
-- privileges of `postgres`. The migration executor IS `postgres`, so it is
-- altering its own defaults, which a role may always do. Measured on a disposable
-- PostgreSQL 17 cluster reproducing production's authority exactly — a
-- NON-superuser role holding only USAGE (and NOT CREATE) on the target schema:
-- the revoke of its OWN default was PERMITTED, and the same role altering
-- ANOTHER role's default in the same schema was REFUSED with 42501. Holding
-- CREATE on the schema is not a requirement, which matters here because
-- `postgres` has USAGE and not CREATE on `storage`.
--
-- WHAT THIS MIGRATION DOES NOT CLOSE  —  STILL OPEN
-- -------------------------------------------------
-- `supabase_admin` also carries default-ACL entries, and its schema-`public`
-- TABLES default still grants both browser roles all eight privileges. That is
-- finding F-01 and it is NOT addressed here. `ALTER DEFAULT PRIVILEGES FOR ROLE
-- supabase_admin` requires membership in `supabase_admin`; `postgres` is not a
-- superuser and holds no such membership, and Supabase's `supautils` blocks
-- acquiring it. That residual requires a session acting as `supabase_admin` and
-- remains OWNER_GATED_EXTERNAL_STEP_REQUIRED. `supabase_admin` has no default-ACL
-- entry in schema `storage` at all, so there is nothing of its to correct here.
--
-- This migration does NOT claim complete default-ACL closure. SEQUENCE and
-- FUNCTION defaults in `storage` and `public` are out of scope and are asserted
-- UNCHANGED rather than corrected.
--
-- SHAPE
-- -----
-- Atomic. Idempotent — `ALTER DEFAULT PRIVILEGES ... REVOKE` of a privilege that
-- is not present is a silent no-op, so the second application changes nothing.
-- Catalog-only: it rewrites one `pg_default_acl` row and reads nothing else.
-- No row DML, no object creation, no object deletion, no ownership change, no
-- role-membership change, no extension change, no `SET ROLE`, no event trigger,
-- and no catch-and-ignore of permission errors — if this executor were ever not
-- entitled to make the change, the statement raises and the whole transaction
-- rolls back rather than reporting a success it did not achieve.

BEGIN;

-- A catalog update, not a data operation. Yield rather than queue behind a
-- long-running session.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Snapshot everything this migration must preserve, plus the exact end state
--    it intends to produce for the one row it targets.
--
--    The intended end state is computed as data — the current row minus exactly
--    the cells this migration is allowed to remove — so section 3 can require
--    equality rather than merely checking that the writes are gone. That closes
--    both directions: no privilege may survive that should have been removed,
--    and none may disappear or appear that was not named.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_write_arr TEXT[];
  v_value     TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION
      'roles anon and authenticated must both exist before the browser-write contract can be defined';
  END IF;

  -- MAINTAIN arrived in PostgreSQL 17. Naming it on an older server is a syntax
  -- error, so the privilege list is assembled from the live server version rather
  -- than hardcoded. Production is PostgreSQL 17.6, where MAINTAIN exists and is
  -- part of `arwdDxtm`.
  v_write_arr := ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  IF current_setting('server_version_num')::int >= 170000 THEN
    v_write_arr := v_write_arr || ARRAY['MAINTAIN'];
  END IF;
  PERFORM set_config('forever.sdah_write_privs', array_to_string(v_write_arr, ', '), false);

  -- 1a. The targeted row: postgres / schema storage / TABLES, as `grantee|privilege`.
  SELECT COALESCE(string_agg(entry, E'\n' ORDER BY entry), '<no default acl row>')
    INTO v_value
  FROM (
    SELECT COALESCE(gr.rolname::text, 'PUBLIC') || '|' || a.privilege_type AS entry
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
    JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
    LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
    WHERE owner.rolname = 'postgres'
      AND n.nspname = 'storage'
      AND d.defaclobjtype = 'r'
  ) s;
  PERFORM set_config('forever.sdah_target_before', v_value, false);

  -- 1b. The same row with exactly the cells this migration removes taken out:
  --     the seven write privileges, for anon and authenticated only. Every
  --     service_role cell, every postgres cell, and both SELECT cells survive by
  --     construction — which is what makes section 3 an equality test.
  SELECT COALESCE(string_agg(entry, E'\n' ORDER BY entry), '<no default acl row>')
    INTO v_value
  FROM (
    SELECT COALESCE(gr.rolname::text, 'PUBLIC') || '|' || a.privilege_type AS entry
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
    JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
    LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
    WHERE owner.rolname = 'postgres'
      AND n.nspname = 'storage'
      AND d.defaclobjtype = 'r'
      AND NOT (COALESCE(gr.rolname::text, 'PUBLIC') IN ('anon', 'authenticated')
               AND a.privilege_type = ANY (v_write_arr))
  ) s;
  PERFORM set_config('forever.sdah_target_expected', v_value, false);

  -- 1c. EVERY other default-ACL entry in the database — every defining role,
  --     every schema, every object type, including SEQUENCES and FUNCTIONS and
  --     every `supabase_admin` row. Compared byte for byte in section 3.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_value
  FROM (
    SELECT owner.rolname || '|' || COALESCE(n.nspname, '<ALL>') || '|'
             || d.defaclobjtype::text || '|' || COALESCE(d.defaclacl::text, 'NULL') AS entry
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
    WHERE NOT (owner.rolname = 'postgres'
               AND COALESCE(n.nspname, '') = 'storage'
               AND d.defaclobjtype = 'r')
  ) s;
  PERFORM set_config('forever.sdah_other_defaults_fp', v_value, false);

  -- 1d. Existing relation ACLs in `storage` and `public` — the proof that no
  --     existing object is touched. Relations of every relkind are included.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_value
  FROM (
    SELECT n.nspname || '.' || c.relname || '|' || COALESCE(c.relacl::text, 'NULL') AS entry
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('storage', 'public')
  ) s;
  PERFORM set_config('forever.sdah_relacl_fp', v_value, false);

  -- 1e. Ownership of every relation in both schemas.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_value
  FROM (
    SELECT n.nspname || '.' || c.relname || '|' || o.rolname AS entry
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles o ON o.oid = c.relowner
    WHERE n.nspname IN ('storage', 'public')
  ) s;
  PERFORM set_config('forever.sdah_owner_fp', v_value, false);

  -- 1f. RLS enabled/forced state.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_value
  FROM (
    SELECT n.nspname || '.' || c.relname || '|' || c.relrowsecurity::text
             || '|' || c.relforcerowsecurity::text AS entry
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('storage', 'public') AND c.relkind IN ('r', 'p')
  ) s;
  PERFORM set_config('forever.sdah_rls_fp', v_value, false);

  -- 1g. Every policy, including its predicates. Whitespace in a predicate is
  --     collapsed so a reformatted-but-identical policy is not reported as drift.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_value
  FROM (
    SELECT schemaname || '.' || tablename || '|' || policyname || '|' || permissive
             || '|' || cmd || '|' || COALESCE(array_to_string(roles, ','), '')
             || '|' || regexp_replace(COALESCE(qual, ''), '\s+', ' ', 'g')
             || '|' || regexp_replace(COALESCE(with_check, ''), '\s+', ' ', 'g') AS entry
    FROM pg_catalog.pg_policies
    WHERE schemaname IN ('storage', 'public')
  ) s;
  PERFORM set_config('forever.sdah_policy_fp', v_value, false);

  -- 1h. Schema-level privileges, for every schema in the database.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_value
  FROM (
    SELECT n.nspname || '|' || COALESCE(n.nspacl::text, 'NULL') AS entry
    FROM pg_catalog.pg_namespace n
  ) s;
  PERFORM set_config('forever.sdah_schema_priv_fp', v_value, false);

  RAISE NOTICE 'FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001: postgres/storage TABLES default before — %',
    replace(current_setting('forever.sdah_target_before'), E'\n', ', ');
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The single change. One defining role, one schema, one object type, two
--    named grantees, seven named write privileges.
--
--    Deliberately NOT a `REVOKE ALL`: that would take SELECT with it and change
--    the birth state of every future storage table from readable to unreadable.
--    Deliberately NOT catalog-discovered across defining roles the way
--    20260730090000 section 3 was: discovery there was correct because the target
--    was "whatever roles define a public TABLES default"; here the target is one
--    named row, and a sweep could reach `supabase_admin`, which this migration is
--    explicitly not permitted to alter.
--
--    `EXECUTE format` carries only the version-gated privilege list. The defining
--    role, the schema, the object type and both grantees are literal text in the
--    statement, so there is exactly one ALTER DEFAULT PRIVILEGES target and it is
--    readable without running anything.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_write_privs TEXT := current_setting('forever.sdah_write_privs');
BEGIN
  -- Supabase always provisions schema `storage`. The guard exists so the
  -- committed chain still applies unchanged on a vanilla PostgreSQL cluster that
  -- has no Storage extension — the disposable test clusters, and any future clean
  -- install done outside Supabase. Skipping is safe and is reported: with no
  -- schema there is no default-ACL row, so section 3's postconditions hold
  -- vacuously rather than being bypassed.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'storage') THEN
    RAISE NOTICE
      'FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001: schema storage is not present; nothing to harden. '
      'Postconditions still run and hold vacuously.';
    RETURN;
  END IF;

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage '
    'REVOKE %s ON TABLES FROM anon, authenticated',
    v_write_privs);

  RAISE NOTICE 'FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001: revoked % on future TABLES in schema storage from anon, authenticated',
    v_write_privs;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Verify every postcondition, or take nothing.
--
--    Fourteen preservation properties, each one an equality against a value
--    measured before the change rather than an assertion about what "should" be
--    true. Any failure raises and rolls the whole transaction back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_write_arr  TEXT[] := string_to_array(current_setting('forever.sdah_write_privs'), ', ');
  v_violations TEXT[] := ARRAY[]::TEXT[];
  v_now        TEXT;
  v_expected   TEXT;
  v_target_now TEXT;
  v_priv       TEXT;
  v_role       TEXT;
BEGIN
  -- 3a. The targeted row is EXACTLY the intended end state — no write privilege
  --     survives for either browser role, SELECT survives for both, and every
  --     service_role and postgres cell is exactly as it was. One equality,
  --     covering postconditions 1, 2, 3 and 4 in both directions.
  SELECT COALESCE(string_agg(entry, E'\n' ORDER BY entry), '<no default acl row>')
    INTO v_now
  FROM (
    SELECT COALESCE(gr.rolname::text, 'PUBLIC') || '|' || a.privilege_type AS entry
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
    JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
    LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
    WHERE owner.rolname = 'postgres'
      AND n.nspname = 'storage'
      AND d.defaclobjtype = 'r'
  ) s;
  v_target_now := v_now;
  v_expected := current_setting('forever.sdah_target_expected');
  IF v_now IS DISTINCT FROM v_expected THEN
    v_violations := v_violations
      || ('the postgres/storage TABLES default is not the intended end state: expected=['
          || replace(v_expected, E'\n', ', ') || '] actual=[' || replace(v_now, E'\n', ', ') || ']');
  END IF;

  -- 3b. The same conclusion stated directly, privilege by privilege, so a failure
  --     names the privilege and the role rather than only printing two lists.
  --     Derived from aclexplode, never from information_schema, which does not
  --     expose MAINTAIN and would silently under-report it.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY v_write_arr LOOP
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_default_acl d
        JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
        JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
        LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
        WHERE owner.rolname = 'postgres' AND n.nspname = 'storage' AND d.defaclobjtype = 'r'
          AND COALESCE(gr.rolname::text, 'PUBLIC') = v_role
          AND a.privilege_type = v_priv
      ) THEN
        v_violations := v_violations
          || (v_role || ' still holds ' || v_priv || ' in the postgres/storage TABLES default');
      END IF;
    END LOOP;
  END LOOP;

  -- 3c. Postconditions 5 to 9: every OTHER default-ACL entry byte-identical.
  --     postgres/public TABLES, every supabase_admin entry in every schema, every
  --     TABLES default in every other schema, and every SEQUENCE and FUNCTION
  --     default everywhere are all inside this one fingerprint.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_now
  FROM (
    SELECT owner.rolname || '|' || COALESCE(n.nspname, '<ALL>') || '|'
             || d.defaclobjtype::text || '|' || COALESCE(d.defaclacl::text, 'NULL') AS entry
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
    WHERE NOT (owner.rolname = 'postgres'
               AND COALESCE(n.nspname, '') = 'storage'
               AND d.defaclobjtype = 'r')
  ) s;
  IF v_now IS DISTINCT FROM current_setting('forever.sdah_other_defaults_fp') THEN
    v_violations := v_violations
      || 'a default-ACL entry outside postgres/storage/TABLES changed (this covers postgres/public, '
         'every supabase_admin entry, every other schema, and all SEQUENCE and FUNCTION defaults)';
  END IF;

  -- 3d. Postconditions 10 and 11: no existing relation ACL moved, in either schema.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_now
  FROM (
    SELECT n.nspname || '.' || c.relname || '|' || COALESCE(c.relacl::text, 'NULL') AS entry
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('storage', 'public')
  ) s;
  IF v_now IS DISTINCT FROM current_setting('forever.sdah_relacl_fp') THEN
    v_violations := v_violations
      || 'an existing relation ACL in schema storage or public changed — this migration must touch none';
  END IF;

  -- 3e. Postcondition 13: ownership unchanged.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_now
  FROM (
    SELECT n.nspname || '.' || c.relname || '|' || o.rolname AS entry
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles o ON o.oid = c.relowner
    WHERE n.nspname IN ('storage', 'public')
  ) s;
  IF v_now IS DISTINCT FROM current_setting('forever.sdah_owner_fp') THEN
    v_violations := v_violations || 'relation ownership changed in schema storage or public';
  END IF;

  -- 3f. Postcondition 12: RLS state and the policy set, both unchanged.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_now
  FROM (
    SELECT n.nspname || '.' || c.relname || '|' || c.relrowsecurity::text
             || '|' || c.relforcerowsecurity::text AS entry
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('storage', 'public') AND c.relkind IN ('r', 'p')
  ) s;
  IF v_now IS DISTINCT FROM current_setting('forever.sdah_rls_fp') THEN
    v_violations := v_violations || 'the RLS enabled/forced state changed';
  END IF;

  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_now
  FROM (
    SELECT schemaname || '.' || tablename || '|' || policyname || '|' || permissive
             || '|' || cmd || '|' || COALESCE(array_to_string(roles, ','), '')
             || '|' || regexp_replace(COALESCE(qual, ''), '\s+', ' ', 'g')
             || '|' || regexp_replace(COALESCE(with_check, ''), '\s+', ' ', 'g') AS entry
    FROM pg_catalog.pg_policies
    WHERE schemaname IN ('storage', 'public')
  ) s;
  IF v_now IS DISTINCT FROM current_setting('forever.sdah_policy_fp') THEN
    v_violations := v_violations || 'the RLS policy set changed';
  END IF;

  -- 3g. Postcondition 14: schema-level privileges unchanged, every schema.
  SELECT COALESCE(md5(string_agg(entry, E'\n' ORDER BY entry)), 'EMPTY') INTO v_now
  FROM (
    SELECT n.nspname || '|' || COALESCE(n.nspacl::text, 'NULL') AS entry
    FROM pg_catalog.pg_namespace n
  ) s;
  IF v_now IS DISTINCT FROM current_setting('forever.sdah_schema_priv_fp') THEN
    v_violations := v_violations || 'schema-level privileges changed';
  END IF;

  IF array_length(v_violations, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001 postcondition failed: %',
      array_to_string(v_violations, '; ');
  END IF;

  RAISE NOTICE 'FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001: postcondition verified — postgres/storage TABLES default now [%]; every other default ACL, every existing relation ACL, ownership, RLS, policies and schema privileges byte-identical',
    replace(v_target_now, E'\n', ', ');
  RAISE NOTICE 'FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001: the supabase_admin default-ACL residual (F-01, schema public) is NOT addressed by this migration and remains OWNER_GATED_EXTERNAL_STEP_REQUIRED';
END
$$;

COMMIT;
