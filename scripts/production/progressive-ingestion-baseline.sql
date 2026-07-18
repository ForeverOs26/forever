\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

-- Deterministic snapshot of every permanent application relation plus the
-- strict execution boundary and public visibility state. Row JSON is ordered
-- before aggregation; catalog internal "char" fields are cast to text before
-- concatenation; routine definitions exclude aggregates and window functions.
CREATE TEMP TABLE progressive_baseline_snapshot (
  relation_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  fingerprint text NOT NULL
);

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

DO $baseline$
DECLARE
  relation record;
  count_value bigint;
  hash_value text;
BEGIN
  FOR relation IN
    SELECT n.nspname AS schema_name, c.relname AS table_name,
           c.relkind::text AS relation_kind,
           c.relpersistence::text AS persistence
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'forever_import', 'forever_execution')
      AND c.relkind::text IN ('r', 'p')
      AND c.relpersistence::text = 'p'
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT count(*)::bigint, encode(sha256(convert_to(COALESCE(string_agg(row_json, E''\n'' ORDER BY row_json), ''''), ''UTF8'')), ''hex'') FROM (SELECT to_jsonb(t)::text AS row_json FROM %I.%I t) ordered_rows',
      relation.schema_name, relation.table_name
    ) INTO count_value, hash_value;
    INSERT INTO progressive_baseline_snapshot VALUES (
      relation.schema_name || '.' || relation.table_name,
      count_value,
      hash_value
    );
  END LOOP;
END
$baseline$;

SET LOCAL ROLE anon;
SELECT count(*)::bigint AS baseline_anon_visible_count,
       encode(sha256(convert_to(COALESCE(string_agg(id::text, E'\n' ORDER BY id), ''), 'UTF8')), 'hex') AS baseline_anon_visible_sha256
FROM public.projects
\gset
RESET ROLE;

SELECT 'BASELINE_JSON|' || jsonb_build_object(
  'relations', COALESCE(jsonb_agg(
    jsonb_build_object('name', relation_name, 'count', row_count, 'sha256', fingerprint)
    ORDER BY relation_name
  ), '[]'::jsonb),
  'visibility', jsonb_build_object(
    'owner_published_count', (
      SELECT count(*) FROM public.projects
      WHERE is_active AND public_status = 'published'
    ),
    'owner_published_sha256', (
      SELECT encode(sha256(convert_to(COALESCE(string_agg(id::text, E'\n' ORDER BY id), ''), 'UTF8')), 'hex')
      FROM public.projects WHERE is_active AND public_status = 'published'
    ),
    'anon_visible_count', :'baseline_anon_visible_count'::bigint,
    'anon_visible_sha256', :'baseline_anon_visible_sha256'
  ),
  'strict_object_sha256', (
    WITH strict_objects AS (
      SELECT 'role|' || rolname || '|' || rolcanlogin::text || '|' ||
             rolsuper::text || '|' || rolinherit::text AS item
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('forever_import_executor', 'forever_import_execution_owner')
      UNION ALL
      SELECT 'schema|' || nspname || '|' || nspowner::text
      FROM pg_catalog.pg_namespace
      WHERE nspname IN ('forever_import', 'forever_execution')
      UNION ALL
      SELECT 'relation|' || n.nspname || '.' || c.relname || '|' ||
             c.relkind::text || '|' || c.relpersistence::text || '|' ||
             c.relowner::text || '|' || COALESCE(c.relacl::text, '')
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('forever_import', 'forever_execution')
      UNION ALL
      SELECT 'function|' || n.nspname || '.' || p.proname || '(' ||
             pg_catalog.pg_get_function_identity_arguments(p.oid) || ')|' ||
             pg_catalog.pg_get_functiondef(p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('forever_import', 'forever_execution')
        AND p.prokind::text IN ('f', 'p')
      UNION ALL
      SELECT 'policy|' || schemaname || '.' || tablename || '.' || policyname || '|' ||
             COALESCE(roles::text, '') || '|' || COALESCE(cmd, '') || '|' ||
             COALESCE(qual, '') || '|' || COALESCE(with_check, '')
      FROM pg_catalog.pg_policies
      WHERE policyname LIKE 'forever_import_%'
    )
    SELECT encode(sha256(convert_to(COALESCE(string_agg(item, E'\n' ORDER BY item), ''), 'UTF8')), 'hex')
    FROM strict_objects
  ),
  'progressive_rpc', (
    SELECT jsonb_build_object(
      'rpc_signature', p.oid::regprocedure::text,
      'prokind', p.prokind::text,
      'prosecdef', p.prosecdef,
      'proconfig', COALESCE(to_jsonb(p.proconfig), 'null'::jsonb),
      'prosrc_sha256', encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')
    )
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.forever_progressive_ingest(jsonb)'::regprocedure
      AND p.prokind::text IN ('f', 'p')
  )
)::text
FROM progressive_baseline_snapshot;

ROLLBACK;
\echo BASELINE_COMPLETE
