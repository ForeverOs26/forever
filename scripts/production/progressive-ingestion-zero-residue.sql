\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE progressive_residue_context (
  smoke_slug text NOT NULL,
  smoke_project_id uuid,
  batch_fingerprint text NOT NULL,
  warning_code text NOT NULL
);
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
INSERT INTO progressive_residue_context
VALUES (:'smoke_slug', NULLIF(:'smoke_project_id', '')::uuid,
        :'batch_fingerprint', :'warning_code');

DO $residue$
DECLARE context progressive_residue_context%ROWTYPE;
DECLARE project_ids uuid[];
BEGIN
  SELECT * INTO STRICT context FROM progressive_residue_context;
  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[]) INTO project_ids
  FROM public.projects
  WHERE slug = context.smoke_slug OR id = context.smoke_project_id;
  IF cardinality(project_ids) <> 0 THEN RAISE EXCEPTION '[residue] project detected'; END IF;
  IF EXISTS (SELECT 1 FROM public.ingestion_batches
             WHERE batch_fingerprint = context.batch_fingerprint
                OR project_id = context.smoke_project_id
                OR project_id = ANY(project_ids))
    THEN RAISE EXCEPTION '[residue] ingestion batch detected'; END IF;
  IF EXISTS (SELECT 1 FROM public.ingestion_warnings
             WHERE code = context.warning_code
                OR project_id = context.smoke_project_id
                OR project_id = ANY(project_ids))
    THEN RAISE EXCEPTION '[residue] warning detected'; END IF;
  IF EXISTS (SELECT 1 FROM public.buildings WHERE project_id = context.smoke_project_id OR project_id = ANY(project_ids))
     OR EXISTS (SELECT 1 FROM public.units WHERE project_id = context.smoke_project_id OR project_id = ANY(project_ids))
     OR EXISTS (SELECT 1 FROM public.project_media WHERE project_id = context.smoke_project_id OR project_id = ANY(project_ids))
     OR EXISTS (SELECT 1 FROM public.listings WHERE project_id = context.smoke_project_id OR project_id = ANY(project_ids))
    THEN RAISE EXCEPTION '[residue] project child detected'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.unit_price_history history
    JOIN public.units unit_row ON unit_row.id = history.unit_id
    WHERE unit_row.project_id = context.smoke_project_id OR unit_row.project_id = ANY(project_ids)
  ) THEN RAISE EXCEPTION '[residue] price history detected'; END IF;
  IF context.smoke_project_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM forever_import.import_execution_approvals WHERE target_project_id = context.smoke_project_id::text)
    OR EXISTS (SELECT 1 FROM forever_import.import_execution_receipts WHERE target_project_id = context.smoke_project_id::text)
  ) THEN RAISE EXCEPTION '[residue] strict execution record detected'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory')
    THEN RAISE EXCEPTION '[residue] advisory lock detected'; END IF;
END
$residue$;

SELECT 'RESIDUE_JSON|' || jsonb_build_object(
  'projects', (SELECT count(*) FROM public.projects p, progressive_residue_context c WHERE p.slug = c.smoke_slug OR p.id = c.smoke_project_id),
  'batches', (SELECT count(*) FROM public.ingestion_batches b, progressive_residue_context c WHERE b.batch_fingerprint = c.batch_fingerprint OR b.project_id = c.smoke_project_id),
  'warnings', (SELECT count(*) FROM public.ingestion_warnings w, progressive_residue_context c WHERE w.code = c.warning_code OR w.project_id = c.smoke_project_id),
  'approvals', (SELECT count(*) FROM forever_import.import_execution_approvals a, progressive_residue_context c WHERE a.target_project_id = c.smoke_project_id::text),
  'receipts', (SELECT count(*) FROM forever_import.import_execution_receipts r, progressive_residue_context c WHERE r.target_project_id = c.smoke_project_id::text),
  'session_advisory_locks', (SELECT count(*) FROM pg_catalog.pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory')
)::text;

ROLLBACK;
\echo ZERO_RESIDUE_COMPLETE
