\set ON_ERROR_STOP on
\pset pager off

-- Disposable PostgreSQL 17.6 regression. The connecting role must own the
-- session and be able to SET ROLE to three distinct, non-owner roles.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN
  IF NOT COALESCE(condition, false) THEN
    RAISE EXCEPTION 'coralina_temp_role_boundary_failed: %', message;
  END IF;
END
$assert$;

CREATE TEMP TABLE coralina_old_payload(payload jsonb NOT NULL);
INSERT INTO coralina_old_payload VALUES ('{"probe":"old-failure"}'::jsonb);

DO $old_failure$
DECLARE
  failed_as_expected boolean := false;
BEGIN
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM payload FROM pg_temp.coralina_old_payload;
  EXCEPTION WHEN insufficient_privilege THEN
    failed_as_expected := true;
  END;
  RESET ROLE;
  PERFORM pg_temp.assert_true(failed_as_expected,
    'owner-created temp table was unexpectedly readable before GRANT');
END
$old_failure$;
\echo CORALINA_OLD_TEMP_ACCESS_FAILURE_REPRODUCED

CREATE TEMP TABLE coralina_exact_payload (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  payload jsonb NOT NULL
);
INSERT INTO coralina_exact_payload(payload)
VALUES ('{"probe":"corrected","batch_fingerprint":"9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c"}'::jsonb);

REVOKE ALL ON TABLE pg_temp.coralina_exact_payload
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE pg_temp.coralina_exact_payload TO service_role;

CREATE OR REPLACE FUNCTION pg_temp.observe_rpc_caller(input jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER
AS $probe$ SELECT jsonb_build_object('caller', current_user, 'payload', input) $probe$;
REVOKE ALL ON FUNCTION pg_temp.observe_rpc_caller(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.observe_rpc_caller(jsonb) TO service_role;

DO $corrected_access$
DECLARE
  observed jsonb;
BEGIN
  PERFORM pg_temp.assert_true(has_schema_privilege('service_role', pg_my_temp_schema(), 'USAGE'),
    'service_role lacks PostgreSQL 17.6 temporary-schema access');
  PERFORM pg_temp.assert_true(has_table_privilege('service_role', 'pg_temp.coralina_exact_payload', 'SELECT'),
    'service_role lacks the explicit SELECT grant');
  PERFORM pg_temp.assert_true(NOT has_table_privilege('anon', 'pg_temp.coralina_exact_payload', 'SELECT'),
    'anon inherited SELECT directly or through PUBLIC');
  PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated', 'pg_temp.coralina_exact_payload', 'SELECT'),
    'authenticated inherited SELECT directly or through PUBLIC');
  PERFORM pg_temp.assert_true((SELECT relpersistence = 't' FROM pg_class
    WHERE oid = 'pg_temp.coralina_exact_payload'::regclass), 'payload relation is not temporary');

  SET LOCAL ROLE service_role;
  SELECT pg_temp.observe_rpc_caller(payload) INTO observed
  FROM pg_temp.coralina_exact_payload;
  RESET ROLE;
  PERFORM pg_temp.assert_true(observed->>'caller' = 'service_role',
    'RPC probe ran as the session owner instead of service_role');
  PERFORM pg_temp.assert_true(observed#>>'{payload,probe}' = 'corrected',
    'service_role did not read the one intended payload row');
END
$corrected_access$;
\echo CORALINA_SERVICE_ROLE_TEMP_ACCESS_CONFIRMED

DO $negative_access$
DECLARE
  denied boolean;
BEGIN
  denied := false;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM payload FROM pg_temp.coralina_exact_payload;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  RESET ROLE;
  PERFORM pg_temp.assert_true(denied, 'anon read the payload table');

  denied := false;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM payload FROM pg_temp.coralina_exact_payload;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  RESET ROLE;
  PERFORM pg_temp.assert_true(denied, 'authenticated read the payload table');
END
$negative_access$;
\echo CORALINA_UNTRUSTED_ROLE_TEMP_ACCESS_DENIED

COMMIT;
\echo CORALINA_TEMP_RELATION_WAS_SESSION_LOCAL
