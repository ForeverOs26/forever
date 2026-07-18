\set ON_ERROR_STOP on
\pset pager off

-- Run only in a disposable PostgreSQL 17.6 database. Everything created by
-- this focused catalog regression is rolled back.
BEGIN;

CREATE TEMPORARY TABLE progressive_rpc_search_path_bootstrap(id integer);

CREATE FUNCTION pg_temp.search_path_is_canonical(config text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(
    (
      SELECT pg_catalog.array_agg(entry ORDER BY ordinality)
      FROM pg_catalog.unnest(COALESCE(config, ARRAY[]::text[]))
        WITH ORDINALITY AS item(entry, ordinality)
      WHERE pg_catalog.split_part(entry, '=', 1) = 'search_path'
    ) = ARRAY['search_path=""']::text[],
    false
  )
$fn$;

CREATE FUNCTION pg_temp.search_path_empty()
RETURNS integer
LANGUAGE sql
SET search_path = ''
AS 'SELECT 1';

CREATE FUNCTION pg_temp.search_path_unset()
RETURNS integer
LANGUAGE sql
AS 'SELECT 1';

CREATE FUNCTION pg_temp.search_path_public()
RETURNS integer
LANGUAGE sql
SET search_path = public
AS 'SELECT 1';

CREATE FUNCTION pg_temp.search_path_catalog_public()
RETURNS integer
LANGUAGE sql
SET search_path = pg_catalog, public
AS 'SELECT 1';

DO $test$
DECLARE
  actual text[];
BEGIN
  SELECT p.proconfig INTO STRICT actual
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'pg_temp.search_path_empty()'::pg_catalog.regprocedure;

  IF actual IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'PostgreSQL 17.6 catalog mismatch: expected {search_path=""}, found %', actual;
  END IF;

  IF NOT pg_temp.search_path_is_canonical(actual) THEN
    RAISE EXCEPTION 'canonical empty search_path was rejected';
  END IF;
END
$test$;

DO $test$
DECLARE
  fn_name text;
  actual text[];
BEGIN
  FOREACH fn_name IN ARRAY ARRAY[
    'search_path_unset',
    'search_path_public',
    'search_path_catalog_public'
  ]
  LOOP
    SELECT p.proconfig INTO STRICT actual
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.oid = pg_catalog.pg_my_temp_schema()
      AND p.proname = fn_name
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = '';

    IF pg_temp.search_path_is_canonical(actual) THEN
      RAISE EXCEPTION 'unsafe variant % was accepted: %', fn_name, actual;
    END IF;
  END LOOP;

  -- PostgreSQL normalizes repeated SET clauses by key rather than retaining
  -- duplicate proconfig entries, so exercise the fail-closed duplicate case
  -- with the exact ambiguous catalog shape the verifier would receive.
  IF pg_temp.search_path_is_canonical(
    ARRAY['search_path=""', 'search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'duplicate search_path entries were accepted';
  END IF;
END
$test$;

ROLLBACK;
\echo '[progressive_rpc_search_path_postgres17_complete] positive and negative catalog cases passed'
