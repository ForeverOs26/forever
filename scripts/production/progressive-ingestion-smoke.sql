\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

BEGIN;
\echo SMOKE_BEGIN_CONFIRMED

-- All psql substitutions happen in plain SQL. Dollar-quoted bodies read only
-- from this transaction-local context table.
CREATE TEMP TABLE progressive_smoke_context (
  smoke_slug text NOT NULL,
  batch_fingerprint text NOT NULL,
  warning_code text NOT NULL,
  raw_developer text NOT NULL,
  raw_location text NOT NULL,
  approvals_before bigint NOT NULL,
  receipts_before bigint NOT NULL,
  rpc_result jsonb,
  project_id uuid
) ON COMMIT DROP;

INSERT INTO progressive_smoke_context (
  smoke_slug, batch_fingerprint, warning_code, raw_developer, raw_location,
  approvals_before, receipts_before
)
SELECT :'smoke_slug', :'batch_fingerprint', :'warning_code',
       :'raw_developer', :'raw_location',
       (SELECT count(*) FROM forever_import.import_execution_approvals),
       (SELECT count(*) FROM forever_import.import_execution_receipts);

GRANT SELECT, UPDATE ON progressive_smoke_context TO service_role;

DO $pre_rpc$
DECLARE context progressive_smoke_context%ROWTYPE;
BEGIN
  SELECT * INTO STRICT context FROM progressive_smoke_context;
  IF EXISTS (SELECT 1 FROM public.projects WHERE slug = context.smoke_slug)
     OR EXISTS (SELECT 1 FROM public.ingestion_batches WHERE batch_fingerprint = context.batch_fingerprint)
     OR EXISTS (SELECT 1 FROM public.ingestion_warnings WHERE code = context.warning_code) THEN
    RAISE EXCEPTION '[smoke_precondition] pre-existing smoke residue';
  END IF;
END
$pre_rpc$;

SET LOCAL ROLE service_role;
WITH context AS (SELECT * FROM progressive_smoke_context),
called AS (
  SELECT public.forever_progressive_ingest(jsonb_build_object(
    'schema_version', '1',
    'mode', 'create',
    'batch_fingerprint', context.batch_fingerprint,
    'project', jsonb_build_object(
      'name', 'Progressive Production Rollback Verification',
      'slug', context.smoke_slug,
      'developer_id', NULL,
      'location_id', NULL,
      'developer_name_raw', context.raw_developer,
      'location_name_raw', context.raw_location,
      'publish', false
    ),
    'buildings', '[]'::jsonb,
    'units', '[]'::jsonb,
    'prices', '[]'::jsonb,
    'media', '[]'::jsonb,
    'warnings', jsonb_build_array(jsonb_build_object(
      'entity', 'project', 'field', 'verification',
      'code', context.warning_code, 'severity', 'warning',
      'message', 'Rollback-only verification warning'
    ))
  )) AS result
  FROM context
)
UPDATE progressive_smoke_context
SET rpc_result = called.result,
    project_id = (called.result->>'project_id')::uuid
FROM called;
RESET ROLE;

SELECT 'SMOKE_RPC_RETURNED|' || project_id::text
FROM progressive_smoke_context;

\if :inject_post_rpc_failure
SELECT 1 / 0 AS injected_post_rpc_assertion_failure;
\endif

DO $inside_assertions$
DECLARE context progressive_smoke_context%ROWTYPE;
BEGIN
  SELECT * INTO STRICT context FROM progressive_smoke_context;
  IF context.rpc_result IS NULL
     OR context.rpc_result->>'replayed' <> 'false'
     OR context.rpc_result->>'public_status' <> 'draft' THEN
    RAISE EXCEPTION '[smoke_rpc] unexpected result';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = context.project_id AND p.slug = context.smoke_slug
      AND p.public_status = 'draft' AND p.is_active AND NOT p.forever_verified
      AND p.developer_id IS NULL AND p.location_id IS NULL
      AND p.developer_name_raw = context.raw_developer
      AND p.location_name_raw = context.raw_location
  ) THEN RAISE EXCEPTION '[smoke_project] project assertions failed'; END IF;
  IF (SELECT count(*) FROM public.ingestion_warnings
      WHERE project_id = context.project_id AND code = context.warning_code AND status = 'open') <> 1
    THEN RAISE EXCEPTION '[smoke_warning] warning assertion failed'; END IF;
  IF (SELECT count(*) FROM public.ingestion_batches
      WHERE project_id = context.project_id AND batch_fingerprint = context.batch_fingerprint AND mode = 'create') <> 1
    THEN RAISE EXCEPTION '[smoke_batch] batch assertion failed'; END IF;
  IF EXISTS (SELECT 1 FROM public.buildings WHERE project_id = context.project_id)
     OR EXISTS (SELECT 1 FROM public.units WHERE project_id = context.project_id)
     OR EXISTS (SELECT 1 FROM public.project_media WHERE project_id = context.project_id)
     OR EXISTS (SELECT 1 FROM public.listings WHERE project_id = context.project_id)
    THEN RAISE EXCEPTION '[smoke_children] unexpected child rows'; END IF;
  IF (SELECT count(*) FROM forever_import.import_execution_approvals) <> context.approvals_before
     OR (SELECT count(*) FROM forever_import.import_execution_receipts) <> context.receipts_before
    THEN RAISE EXCEPTION '[smoke_strict_controls] approval or receipt count changed'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory')
    THEN RAISE EXCEPTION '[smoke_lock] advisory lock remains'; END IF;
END
$inside_assertions$;

SELECT 'SMOKE_INSIDE_JSON|' || jsonb_build_object(
  'project_id', project_id,
  'project_rows', (SELECT count(*) FROM public.projects WHERE id = context.project_id),
  'warning_rows', (SELECT count(*) FROM public.ingestion_warnings WHERE project_id = context.project_id),
  'batch_rows', (SELECT count(*) FROM public.ingestion_batches WHERE project_id = context.project_id),
  'approval_delta', (SELECT count(*) FROM forever_import.import_execution_approvals) - approvals_before,
  'receipt_delta', (SELECT count(*) FROM forever_import.import_execution_receipts) - receipts_before,
  'session_advisory_locks', (SELECT count(*) FROM pg_catalog.pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory')
)::text
FROM progressive_smoke_context context;

GRANT SELECT ON progressive_smoke_context TO anon;
SET LOCAL ROLE anon;
DO $anon_assertion$
DECLARE project uuid;
BEGIN
  SELECT project_id INTO STRICT project FROM progressive_smoke_context;
  IF EXISTS (SELECT 1 FROM public.projects WHERE id = project) THEN
    RAISE EXCEPTION '[smoke_visibility] draft project is anon-visible';
  END IF;
END
$anon_assertion$;
RESET ROLE;

\echo SMOKE_INSIDE_ASSERTIONS_COMPLETE
ROLLBACK;
\echo SMOKE_EXPLICIT_ROLLBACK_COMPLETE
