\set ON_ERROR_STOP on
\pset pager off

-- PostgreSQL catalog regression for the production preflight writer inventory.
-- The entire test is read-only. It first reproduces and catches the former
-- pg_get_functiondef(aggregate_oid) failure, then proves that ordinary-routine
-- inventory and explicit aggregate detection both use prokind correctly.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

DO $test$
DECLARE
  aggregate_oid oid;
BEGIN
  SELECT p.oid INTO STRICT aggregate_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'pg_catalog'
    AND p.proname = 'array_agg'
    AND p.prokind = 'a'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'anynonarray';

  BEGIN
    PERFORM pg_catalog.pg_get_functiondef(aggregate_oid);
    RAISE EXCEPTION 'former array_agg failure was not reproduced';
  EXCEPTION
    WHEN SQLSTATE '42809' THEN
      IF SQLERRM <> '"array_agg" is an aggregate function' THEN
        RAISE EXCEPTION 'unexpected aggregate-definition error: %', SQLERRM;
      END IF;
  END;
END
$test$;

DO $test$
DECLARE
  aggregate_count integer;
  routine_count integer;
BEGIN
  SELECT count(*) INTO aggregate_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'pg_catalog'
    AND p.proname = 'array_agg'
    AND p.prokind = 'a'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) IN
      ('anynonarray', 'anyarray');

  IF aggregate_count <> 2 THEN
    RAISE EXCEPTION 'expected both PostgreSQL 17 array_agg signatures, found %', aggregate_count;
  END IF;

  SELECT count(*) INTO routine_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
    AND n.nspname IN ('forever_import', 'forever_execution', 'public')
    AND p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+public[.]unit_price_history';

  IF routine_count < 0 THEN
    RAISE EXCEPTION 'unreachable catalog count';
  END IF;
END
$test$;

ROLLBACK;
\echo '[array_agg_regression_complete] former failure reproduced and corrected catalog query passed'
