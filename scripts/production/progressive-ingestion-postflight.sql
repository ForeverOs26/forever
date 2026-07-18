\set ON_ERROR_STOP on
\pset pager off

-- Repository-owned, read-only verifier for the applied Progressive Ingestion
-- RPC. PostgreSQL 17.6 stores SET search_path = '' as search_path="" in
-- pg_proc.proconfig. Match that single catalog entry exactly and fail closed.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

DO $check$
DECLARE
  fn oid := pg_catalog.to_regprocedure('public.forever_progressive_ingest(jsonb)');
  search_path_entries text[];
  security_definer boolean;
BEGIN
  IF fn IS NULL THEN
    RAISE EXCEPTION '[progressive_rpc_signature] missing public.forever_progressive_ingest(jsonb)';
  END IF;

  SELECT
    pg_catalog.array_agg(config.entry ORDER BY config.ordinality)
      FILTER (WHERE pg_catalog.split_part(config.entry, '=', 1) = 'search_path'),
    p.prosecdef
  INTO search_path_entries, security_definer
  FROM pg_catalog.pg_proc p
  LEFT JOIN LATERAL pg_catalog.unnest(
    COALESCE(p.proconfig, ARRAY[]::text[])
  ) WITH ORDINALITY AS config(entry, ordinality) ON true
  WHERE p.oid = fn
  GROUP BY p.prosecdef;

  IF search_path_entries IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION '[progressive_rpc_search_path] expected exactly {search_path=""}, found %',
      COALESCE(search_path_entries::text, '<none>');
  END IF;

  IF security_definer THEN
    RAISE EXCEPTION '[progressive_rpc_security] SECURITY DEFINER is forbidden';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role', 'public.forever_progressive_ingest(jsonb)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION '[progressive_rpc_acl] service_role EXECUTE is missing';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon', 'public.forever_progressive_ingest(jsonb)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', 'public.forever_progressive_ingest(jsonb)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION '[progressive_rpc_acl] anon or authenticated has EXECUTE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    WHERE p.oid = fn
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION '[progressive_rpc_acl] PUBLIC has EXECUTE';
  END IF;
END
$check$;

ROLLBACK;
\echo '[progressive_rpc_postflight_complete] signature, search_path, invoker mode, and ACL passed'
