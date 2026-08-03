-- Forever Studio contained failed R2 job -- exact-row recovery
--
-- EXCEPTIONAL, NON-AUTOMATIC OPERATOR PROCEDURE. This file is documentation,
-- not a migration, deployment hook, CI input, or application capability.
-- Run only in psql after the separately authorized runbook preflight. Supply
-- every value from that approved read-only preflight; never edit this file to
-- add a production identifier.

\set ON_ERROR_STOP on

\if :{?job_id}
\else
  \echo 'contained_job_repair_refused required_parameter=job_id'
  \quit 3
\endif
\if :{?expected_workflow}
\else
  \echo 'contained_job_repair_refused required_parameter=expected_workflow'
  \quit 3
\endif
\if :{?expected_attempt_count}
\else
  \echo 'contained_job_repair_refused required_parameter=expected_attempt_count'
  \quit 3
\endif
\if :{?expected_file_count}
\else
  \echo 'contained_job_repair_refused required_parameter=expected_file_count'
  \quit 3
\endif
\if :{?expected_error_code}
\else
  \echo 'contained_job_repair_refused required_parameter=expected_error_code'
  \quit 3
\endif
\if :{?expected_error_sha256}
\else
  \echo 'contained_job_repair_refused required_parameter=expected_error_sha256'
  \quit 3
\endif
\if :{?expected_facts_sha256}
\else
  \echo 'contained_job_repair_refused required_parameter=expected_facts_sha256'
  \quit 3
\endif
\if :{?expected_files_sha256}
\else
  \echo 'contained_job_repair_refused required_parameter=expected_files_sha256'
  \quit 3
\endif
\if :{?operator_actor_id}
\else
  \echo 'contained_job_repair_refused required_parameter=operator_actor_id'
  \quit 3
\endif
\if :{?approved_at}
\else
  \echo 'contained_job_repair_refused required_parameter=approved_at'
  \quit 3
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE contained_job_repair_params (
  job_id uuid PRIMARY KEY,
  expected_workflow text NOT NULL,
  expected_attempt_count integer NOT NULL CHECK (expected_attempt_count >= 0),
  expected_file_count integer NOT NULL CHECK (expected_file_count > 0),
  expected_error_code text NOT NULL CHECK (length(expected_error_code) > 0),
  expected_error_sha256 text NOT NULL CHECK (expected_error_sha256 ~ '^[0-9a-f]{64}$'),
  expected_facts_sha256 text NOT NULL CHECK (expected_facts_sha256 ~ '^[0-9a-f]{64}$'),
  expected_files_sha256 text NOT NULL CHECK (expected_files_sha256 ~ '^[0-9a-f]{64}$'),
  operator_actor_id uuid NOT NULL,
  approved_at timestamptz NOT NULL
) ON COMMIT DROP;

INSERT INTO contained_job_repair_params VALUES (
  :'job_id'::uuid,
  :'expected_workflow',
  :'expected_attempt_count'::integer,
  :'expected_file_count'::integer,
  :'expected_error_code',
  :'expected_error_sha256',
  :'expected_facts_sha256',
  :'expected_files_sha256',
  :'operator_actor_id'::uuid,
  :'approved_at'::timestamptz
);

CREATE TEMP TABLE contained_job_repair_result (
  ok boolean NOT NULL,
  reason text NOT NULL,
  affected_rows integer NOT NULL
) ON COMMIT DROP;

DO $repair$
DECLARE
  p contained_job_repair_params%ROWTYPE;
  before_row public.studio_upload_jobs%ROWTYPE;
  after_row public.studio_upload_jobs%ROWTYPE;
  update_rows integer := 0;
  audit_rows integer := 0;
  failure_reason text := 'uninitialized';
  repair_ok boolean := false;
BEGIN
  SELECT * INTO STRICT p FROM contained_job_repair_params;

  -- Exact row lock. A concurrent state transition must settle before any
  -- assertion is evaluated; every later guard sees the same locked row.
  SELECT *
    INTO before_row
    FROM public.studio_upload_jobs
   WHERE id = p.job_id
   FOR UPDATE;

  IF NOT FOUND THEN
    failure_reason := 'zero_rows';
  ELSIF before_row.status IS DISTINCT FROM 'failed' THEN
    failure_reason := 'status_changed';
  ELSIF before_row.retryable IS DISTINCT FROM false THEN
    failure_reason := 'retryable_not_false';
  ELSIF before_row.workflow IS DISTINCT FROM p.expected_workflow THEN
    failure_reason := 'workflow_changed';
  ELSIF before_row.attempt_count IS DISTINCT FROM p.expected_attempt_count THEN
    failure_reason := 'attempt_count_changed';
  ELSIF before_row.facts #>> '{storage,provider}' IS DISTINCT FROM 'r2' THEN
    failure_reason := 'provider_changed';
  ELSIF before_row.result_summary IS NOT NULL
     OR before_row.project_slug IS NOT NULL
     OR before_row.listing_id IS NOT NULL
     OR before_row.content_fingerprint IS NOT NULL THEN
    failure_reason := 'project_result_present';
  ELSIF before_row.processing_token IS NOT NULL
     OR before_row.processing_started_at IS NOT NULL THEN
    failure_reason := 'processing_attempt_active';
  ELSIF jsonb_array_length(before_row.files) IS DISTINCT FROM p.expected_file_count THEN
    failure_reason := 'file_count_changed';
  ELSIF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(before_row.files) AS file_entry
     WHERE file_entry->>'storageProvider' IS DISTINCT FROM 'r2'
  ) THEN
    failure_reason := 'manifest_provider_changed';
  ELSIF before_row.error_code IS DISTINCT FROM p.expected_error_code THEN
    failure_reason := 'error_code_changed';
  ELSIF encode(digest(convert_to(COALESCE(before_row.error, ''), 'UTF8'), 'sha256'), 'hex')
        IS DISTINCT FROM p.expected_error_sha256 THEN
    failure_reason := 'error_evidence_changed';
  ELSIF encode(digest(convert_to(before_row.facts::text, 'UTF8'), 'sha256'), 'hex')
        IS DISTINCT FROM p.expected_facts_sha256 THEN
    failure_reason := 'facts_changed';
  ELSIF encode(digest(convert_to(before_row.files::text, 'UTF8'), 'sha256'), 'hex')
        IS DISTINCT FROM p.expected_files_sha256 THEN
    failure_reason := 'manifest_changed';
  ELSE
    -- All available safe predicates are repeated on the write itself. The id
    -- is necessary but deliberately insufficient.
    UPDATE public.studio_upload_jobs AS job
       SET retryable = true
      FROM contained_job_repair_params AS expected
     WHERE job.id = expected.job_id
       AND job.status = 'failed'
       AND job.retryable IS FALSE
       AND job.workflow = expected.expected_workflow
       AND job.attempt_count = expected.expected_attempt_count
       AND job.facts #>> '{storage,provider}' = 'r2'
       AND job.result_summary IS NULL
       AND job.project_slug IS NULL
       AND job.listing_id IS NULL
       AND job.content_fingerprint IS NULL
       AND job.processing_token IS NULL
       AND job.processing_started_at IS NULL
       AND jsonb_array_length(job.files) = expected.expected_file_count
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(job.files) AS file_entry
          WHERE file_entry->>'storageProvider' IS DISTINCT FROM 'r2'
       )
       AND job.error_code = expected.expected_error_code
       AND encode(digest(convert_to(COALESCE(job.error, ''), 'UTF8'), 'sha256'), 'hex')
             = expected.expected_error_sha256
       AND encode(digest(convert_to(job.facts::text, 'UTF8'), 'sha256'), 'hex')
             = expected.expected_facts_sha256
       AND encode(digest(convert_to(job.files::text, 'UTF8'), 'sha256'), 'hex')
             = expected.expected_files_sha256
    RETURNING job.* INTO after_row;
    GET DIAGNOSTICS update_rows = ROW_COUNT;

    IF update_rows IS DISTINCT FROM 1 THEN
      failure_reason := 'affected_rows_not_one';
    ELSIF after_row.retryable IS DISTINCT FROM true THEN
      failure_reason := 'post_retryable_not_true';
    ELSIF (to_jsonb(after_row) - 'retryable' - 'updated_at')
          IS DISTINCT FROM (to_jsonb(before_row) - 'retryable' - 'updated_at') THEN
      failure_reason := 'unrelated_field_changed';
    ELSE
      -- Existing audit_log contract: one bounded, truthful event in the same
      -- transaction. It carries no filename, object key, URL, or credential.
      INSERT INTO public.audit_log (
        actor_id,
        actor_email,
        action,
        table_name,
        record_id,
        old_values,
        new_values,
        metadata
      ) VALUES (
        p.operator_actor_id,
        NULL,
        'studio_contained_r2_job_exact_row_repair',
        'studio_upload_jobs',
        p.job_id,
        jsonb_build_object('retryable', false),
        jsonb_build_object('retryable', true),
        jsonb_build_object(
          'task', 'FOREVER-PR134-MANUAL-RETRY-PROGRESS-AND-RECOVERY-RUNBOOK-001',
          'approved_at', p.approved_at,
          'expected_workflow', p.expected_workflow,
          'expected_attempt_count', p.expected_attempt_count,
          'expected_file_count', p.expected_file_count,
          'affected_rows', update_rows,
          'transaction_result', 'committed'
        )
      );
      GET DIAGNOSTICS audit_rows = ROW_COUNT;

      IF audit_rows IS DISTINCT FROM 1 THEN
        failure_reason := 'audit_rows_not_one';
      ELSE
        repair_ok := true;
        failure_reason := 'ok';
      END IF;
    END IF;
  END IF;

  INSERT INTO contained_job_repair_result(ok, reason, affected_rows)
  VALUES (repair_ok, failure_reason, update_rows);
END
$repair$;

SELECT ok AS repair_ok,
       reason AS repair_reason,
       affected_rows AS repair_affected_rows
  FROM contained_job_repair_result
\gset

\if :repair_ok
  COMMIT;
  \echo 'contained_job_repair_committed affected_rows=1'
\else
  ROLLBACK;
  \echo 'contained_job_repair_rolled_back reason=' :repair_reason
  \quit 3
\endif
