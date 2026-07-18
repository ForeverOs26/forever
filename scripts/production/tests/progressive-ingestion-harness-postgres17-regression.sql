\set ON_ERROR_STOP on
\pset pager off

-- Disposable PostgreSQL 17.6 only. Every mutation is rolled back.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN
  IF NOT condition THEN RAISE EXCEPTION 'assertion failed: %', message; END IF;
END
$assert$;

DO $negative_batches$
DECLARE
  base_project jsonb := jsonb_build_object(
    'name', 'Harness Negative Fixture',
    'slug', 'progressive-harness-negative-slug',
    'developer_name_raw', 'Negative Developer',
    'location_name_raw', 'Negative Location',
    'publish', false
  );
BEGIN
  BEGIN
    PERFORM public.forever_progressive_ingest(jsonb_build_object(
      'schema_version', '1', 'mode', 'create',
      'batch_fingerprint', repeat('a', 64), 'project', base_project,
      'buildings', jsonb_build_object('malformed', true)
    ));
    RAISE EXCEPTION 'malformed batch was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%buildings_malformed%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.forever_progressive_ingest(jsonb_build_object(
      'schema_version', '2', 'mode', 'create',
      'batch_fingerprint', repeat('b', 64), 'project', base_project
    ));
    RAISE EXCEPTION 'invalid schema version was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%schema_version_unsupported%' THEN RAISE; END IF;
  END;

  PERFORM public.forever_progressive_ingest(jsonb_build_object(
    'schema_version', '1', 'mode', 'create',
    'batch_fingerprint', repeat('c', 64), 'project', base_project,
    'buildings', '[]'::jsonb, 'units', '[]'::jsonb,
    'prices', '[]'::jsonb, 'media', '[]'::jsonb, 'warnings', '[]'::jsonb
  ));
  BEGIN
    PERFORM public.forever_progressive_ingest(jsonb_build_object(
      'schema_version', '1', 'mode', 'create',
      'batch_fingerprint', repeat('d', 64), 'project', base_project
    ));
    RAISE EXCEPTION 'duplicate slug was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%project_slug_exists%' THEN RAISE; END IF;
  END;
END
$negative_batches$;

DO $catalog_types$
DECLARE old_failed boolean := false;
DECLARE relation_kind text;
BEGIN
  BEGIN
    EXECUTE $former$SELECT 'relation|'::text || relkind FROM pg_catalog.pg_class LIMIT 1$former$;
  EXCEPTION WHEN ambiguous_function THEN old_failed := true;
  END;
  PERFORM pg_temp.assert_true(old_failed, 'former internal char concatenation did not fail');
  SELECT c.relkind::text INTO relation_kind FROM pg_catalog.pg_class c ORDER BY c.oid LIMIT 1;
  PERFORM pg_temp.assert_true(relation_kind IS NOT NULL, 'typed relkind query failed');
END
$catalog_types$;

CREATE TEMP TABLE progressive_catalog_fingerprints(stage text PRIMARY KEY, digest text NOT NULL);
INSERT INTO progressive_catalog_fingerprints
SELECT 'before', encode(sha256(convert_to(jsonb_build_object(
  'signature', p.oid::regprocedure::text,
  'prokind', p.prokind::text,
  'prosecdef', p.prosecdef,
  'proconfig', p.proconfig,
  'prosrc', p.prosrc
)::text, 'UTF8')), 'hex')
FROM pg_catalog.pg_proc p
WHERE p.oid = 'public.forever_progressive_ingest(jsonb)'::regprocedure
  AND p.prokind::text IN ('f', 'p');

INSERT INTO progressive_catalog_fingerprints
SELECT 'identical', encode(sha256(convert_to(jsonb_build_object(
  'signature', p.oid::regprocedure::text,
  'prokind', p.prokind::text,
  'prosecdef', p.prosecdef,
  'proconfig', p.proconfig,
  'prosrc', p.prosrc
)::text, 'UTF8')), 'hex')
FROM pg_catalog.pg_proc p
WHERE p.oid = 'public.forever_progressive_ingest(jsonb)'::regprocedure
  AND p.prokind::text IN ('f', 'p');

SELECT pg_temp.assert_true(
  (SELECT digest FROM progressive_catalog_fingerprints WHERE stage = 'before') =
  (SELECT digest FROM progressive_catalog_fingerprints WHERE stage = 'identical'),
  'identical catalog fingerprint changed'
);

ALTER FUNCTION public.forever_progressive_ingest(jsonb) SET search_path = public;
INSERT INTO progressive_catalog_fingerprints
SELECT 'changed', encode(sha256(convert_to(jsonb_build_object(
  'signature', p.oid::regprocedure::text,
  'prokind', p.prokind::text,
  'prosecdef', p.prosecdef,
  'proconfig', p.proconfig,
  'prosrc', p.prosrc
)::text, 'UTF8')), 'hex')
FROM pg_catalog.pg_proc p
WHERE p.oid = 'public.forever_progressive_ingest(jsonb)'::regprocedure
  AND p.prokind::text IN ('f', 'p');

SELECT pg_temp.assert_true(
  (SELECT digest FROM progressive_catalog_fingerprints WHERE stage = 'before') <>
  (SELECT digest FROM progressive_catalog_fingerprints WHERE stage = 'changed'),
  'deliberate catalog change did not change fingerprint'
);

DO $incorrect_search_path$
DECLARE entries text[];
BEGIN
  SELECT array_agg(config.entry ORDER BY config.ordinality)
  INTO entries
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.unnest(COALESCE(p.proconfig, ARRAY[]::text[]))
    WITH ORDINALITY AS config(entry, ordinality)
  WHERE p.oid = 'public.forever_progressive_ingest(jsonb)'::regprocedure
    AND pg_catalog.split_part(config.entry, '=', 1) = 'search_path';
  PERFORM pg_temp.assert_true(
    entries IS DISTINCT FROM ARRAY['search_path=""']::text[],
    'incorrect search_path fixture was accepted'
  );
END
$incorrect_search_path$;

-- Safe routine inventory never calls pg_get_functiondef on aggregates/windows.
SELECT pg_temp.assert_true(count(*) > 0, 'ordinary routine inventory empty')
FROM pg_catalog.pg_proc p
WHERE p.prokind::text IN ('f', 'p') AND p.prosrc IS NOT NULL;

ROLLBACK;
\echo PROGRESSIVE_HARNESS_POSTGRES17_REGRESSION_COMPLETE
