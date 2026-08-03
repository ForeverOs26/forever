-- Forever Studio contained failed R2 job -- exact-row recovery
--
-- EXCEPTIONAL, NON-AUTOMATIC OPERATOR PROCEDURE. This file is documentation,
-- not a migration, deployment hook, CI input, or application capability.
-- Run only in psql after the separately authorized runbook preflight. Supply
-- every value from that approved read-only preflight; never edit this file to
-- add a production identifier.
--
-- WHAT THIS TRANSACTION PRODUCES, AND WHY BOTH HALVES ARE MANDATORY
-- ----------------------------------------------------------------
-- The end state is OWNER-RETRYABLE BUT AUTOMATICALLY EXHAUSTED:
--
--   retryable                = true       -- studio_claim_job may admit it
--   facts.retry.automatic    = exhausted  -- the automatic lane will not offer it
--
-- `retryable = true` ALONE IS UNSAFE. The contained job predates the bounded
-- automatic-retry policy, so it carries no `facts.retry` record at all, and
-- studio_job_automatic_retry_exhausted() reads an absent key as ELIGIBLE --
-- deliberately, because that is the truth for every job that has never failed
-- automatically. The job also already has `processing_requested_at` set from its
-- earlier automatic attempts. Flipping only `retryable` would therefore make it
-- match studio_list_due_jobs and studio_count_active_jobs the instant the
-- transaction commits, and the five-minute scheduled runner or the dashboard's
-- background resume could claim it, increment attempt_count and start touching
-- storage before the Owner has read a single post-commit check.
--
-- So the automatic state is written in the SAME UPDATE, in the SAME
-- transaction, from the SAME closed vocabulary the application and
-- retry-policy.ts already use. There is no new state and no second write:
-- concurrent readers see either the pre-repair row (retryable = false, not
-- claimable at all) or the post-repair row (retryable = true, automatically
-- exhausted). There is no instant in between in which the row is automatically
-- eligible.
--
-- Everything else about the job is preserved. attempt_count, the failure
-- evidence, the manifest, the provider, the project fields and every other
-- `facts` key are untouched; the only path written inside `facts` is
-- {retry,automatic}.

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

-- The authorized shape of the ONE contained pilot this procedure exists for.
--
-- These are not production identifiers -- they are the material contract the
-- Owner selected in Studio's upload windows: six files, three project photos,
-- one brochure, one price list, one developer profile, no payment plan and no
-- archive. Pinning them here is what stops a correct-looking set of preflight
-- digests for some OTHER failed R2 job from reaching the UPDATE at all.
CREATE TEMP TABLE contained_job_repair_shape (
  required_file_count integer NOT NULL,
  required_workflow text NOT NULL,
  required_purpose_multiset jsonb NOT NULL,
  required_purpose_source text NOT NULL,
  required_storage_provider text NOT NULL,
  required_automatic_state text NOT NULL
) ON COMMIT DROP;

INSERT INTO contained_job_repair_shape VALUES (
  6,
  'new_development',
  '{"project_photo": 3, "brochure": 1, "price_list": 1, "developer_profile": 1}'::jsonb,
  'owner_selected',
  'r2',
  'exhausted'
);

CREATE TEMP TABLE contained_job_repair_params (
  job_id uuid PRIMARY KEY,
  expected_workflow text NOT NULL,
  expected_attempt_count integer NOT NULL CHECK (expected_attempt_count >= 0),
  -- Exactly six. This procedure is the contained six-file pilot's recovery and
  -- nothing else; any other positive count is a different job.
  expected_file_count integer NOT NULL CHECK (expected_file_count = 6),
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
  s contained_job_repair_shape%ROWTYPE;
  before_row public.studio_upload_jobs%ROWTYPE;
  after_row public.studio_upload_jobs%ROWTYPE;
  expected_facts jsonb;
  purpose_multiset jsonb;
  row_found boolean := false;
  active_before bigint := 0;
  active_after bigint := 0;
  due_after integer := 0;
  update_rows integer := 0;
  audit_rows integer := 0;
  failure_reason text := 'uninitialized';
  repair_ok boolean := false;
BEGIN
  SELECT * INTO STRICT p FROM contained_job_repair_params;
  SELECT * INTO STRICT s FROM contained_job_repair_shape;

  -- Exact row lock. A concurrent state transition must settle before any
  -- assertion is evaluated; every later guard sees the same locked row.
  SELECT *
    INTO before_row
    FROM public.studio_upload_jobs
   WHERE id = p.job_id
   FOR UPDATE;
  -- Captured immediately: every later query overwrites FOUND.
  row_found := FOUND;

  IF row_found THEN
    -- The Owner-selected material shape, as a canonical multiset. One equality
    -- decides every material question at once: the total, each expected count,
    -- and the absence of Payment Plan, Project Archive, any other purpose, and
    -- any entry with no purpose at all (which aggregates as '(absent)').
    SELECT COALESCE(jsonb_object_agg(purpose, files), '{}'::jsonb)
      INTO purpose_multiset
      FROM (
        SELECT COALESCE(file_entry ->> 'materialPurpose', '(absent)') AS purpose,
               count(*) AS files
          FROM jsonb_array_elements(before_row.files) AS file_entry
         GROUP BY 1
      ) AS grouped;

    -- The whole `facts` object with exactly one path written. Computed from the
    -- locked row so the post-update comparison is an exact equality rather than
    -- a re-derivation, and built with an explicit merge because jsonb_set()
    -- returns its target UNCHANGED when an earlier path step is missing -- which
    -- is precisely the legacy row this procedure exists for.
    expected_facts := before_row.facts
      || jsonb_build_object(
           'retry',
           COALESCE(before_row.facts -> 'retry', '{}'::jsonb)
             || jsonb_build_object('automatic', s.required_automatic_state)
         );
  END IF;

  IF p.expected_workflow IS DISTINCT FROM s.required_workflow THEN
    failure_reason := 'workflow_not_authorized_shape';
  ELSIF NOT row_found THEN
    failure_reason := 'zero_rows';
  ELSIF before_row.status IS DISTINCT FROM 'failed' THEN
    failure_reason := 'status_changed';
  ELSIF before_row.retryable IS DISTINCT FROM false THEN
    failure_reason := 'retryable_not_false';
  ELSIF before_row.workflow IS DISTINCT FROM p.expected_workflow THEN
    failure_reason := 'workflow_changed';
  ELSIF before_row.attempt_count IS DISTINCT FROM p.expected_attempt_count THEN
    failure_reason := 'attempt_count_changed';
  ELSIF before_row.facts #>> '{storage,provider}' IS DISTINCT FROM s.required_storage_provider THEN
    failure_reason := 'provider_changed';
  ELSIF before_row.facts ? 'retry'
    AND jsonb_typeof(before_row.facts -> 'retry') IS DISTINCT FROM 'object' THEN
    failure_reason := 'retry_facts_not_object';
  ELSIF before_row.result_summary IS NOT NULL
     OR before_row.project_slug IS NOT NULL
     OR before_row.listing_id IS NOT NULL
     OR before_row.content_fingerprint IS NOT NULL THEN
    failure_reason := 'project_result_present';
  ELSIF before_row.processing_token IS NOT NULL
     OR before_row.processing_started_at IS NOT NULL THEN
    failure_reason := 'processing_attempt_active';
  ELSIF jsonb_array_length(before_row.files) IS DISTINCT FROM s.required_file_count THEN
    failure_reason := 'file_count_not_exactly_six';
  ELSIF jsonb_array_length(before_row.files) IS DISTINCT FROM p.expected_file_count THEN
    failure_reason := 'file_count_changed';
  ELSIF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(before_row.files) AS file_entry
     WHERE file_entry->>'storageProvider' IS DISTINCT FROM s.required_storage_provider
  ) THEN
    failure_reason := 'manifest_provider_changed';
  ELSIF purpose_multiset IS DISTINCT FROM s.required_purpose_multiset THEN
    failure_reason := 'material_purpose_multiset_changed';
  ELSIF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(before_row.files) AS file_entry
     WHERE file_entry ? 'purposeSource'
       AND file_entry->>'purposeSource' IS DISTINCT FROM s.required_purpose_source
  ) THEN
    failure_reason := 'material_purpose_source_changed';
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
    -- The automatic-lane number this row contributes to BEFORE the repair. The
    -- post-update assertion requires it to be exactly the same afterwards: the
    -- repaired row must not add itself to the dashboard's automatic work.
    active_before := public.studio_count_active_jobs(before_row.created_by);

    -- All available safe predicates are repeated on the write itself. The id
    -- is necessary but deliberately insufficient.
    --
    -- Both halves of the end state are assigned by this ONE statement, so no
    -- snapshot can observe retryable = true while the automatic lane still
    -- reads this row as eligible.
    UPDATE public.studio_upload_jobs AS job
       SET retryable = true,
           facts = job.facts
             || jsonb_build_object(
                  'retry',
                  COALESCE(job.facts -> 'retry', '{}'::jsonb)
                    || jsonb_build_object('automatic', expected.required_automatic_state)
                )
      FROM contained_job_repair_params AS expected_params,
           contained_job_repair_shape AS expected
     WHERE job.id = expected_params.job_id
       AND job.status = 'failed'
       AND job.retryable IS FALSE
       AND job.workflow = expected_params.expected_workflow
       AND job.workflow = expected.required_workflow
       AND job.attempt_count = expected_params.expected_attempt_count
       AND job.facts #>> '{storage,provider}' = expected.required_storage_provider
       AND (
         NOT job.facts ? 'retry'
         OR jsonb_typeof(job.facts -> 'retry') = 'object'
       )
       AND job.result_summary IS NULL
       AND job.project_slug IS NULL
       AND job.listing_id IS NULL
       AND job.content_fingerprint IS NULL
       AND job.processing_token IS NULL
       AND job.processing_started_at IS NULL
       AND jsonb_array_length(job.files) = expected.required_file_count
       AND jsonb_array_length(job.files) = expected_params.expected_file_count
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(job.files) AS file_entry
          WHERE file_entry->>'storageProvider' IS DISTINCT FROM expected.required_storage_provider
       )
       AND (
         SELECT COALESCE(jsonb_object_agg(purpose, files), '{}'::jsonb)
           FROM (
             SELECT COALESCE(file_entry ->> 'materialPurpose', '(absent)') AS purpose,
                    count(*) AS files
               FROM jsonb_array_elements(job.files) AS file_entry
              GROUP BY 1
           ) AS grouped
       ) = expected.required_purpose_multiset
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(job.files) AS file_entry
          WHERE file_entry ? 'purposeSource'
            AND file_entry->>'purposeSource' IS DISTINCT FROM expected.required_purpose_source
       )
       AND job.error_code = expected_params.expected_error_code
       AND encode(digest(convert_to(COALESCE(job.error, ''), 'UTF8'), 'sha256'), 'hex')
             = expected_params.expected_error_sha256
       AND encode(digest(convert_to(job.facts::text, 'UTF8'), 'sha256'), 'hex')
             = expected_params.expected_facts_sha256
       AND encode(digest(convert_to(job.files::text, 'UTF8'), 'sha256'), 'hex')
             = expected_params.expected_files_sha256
    RETURNING job.* INTO after_row;
    GET DIAGNOSTICS update_rows = ROW_COUNT;

    IF update_rows IS DISTINCT FROM 1 THEN
      failure_reason := 'affected_rows_not_one';
    ELSIF after_row.retryable IS DISTINCT FROM true THEN
      failure_reason := 'post_retryable_not_true';
    ELSIF after_row.facts #>> '{retry,automatic}' IS DISTINCT FROM s.required_automatic_state THEN
      failure_reason := 'post_automatic_state_not_exhausted';
    ELSIF NOT public.studio_job_automatic_retry_exhausted(after_row.facts) THEN
      failure_reason := 'post_automatic_lane_still_eligible';
    ELSIF after_row.facts IS DISTINCT FROM expected_facts THEN
      -- Exactly one path inside `facts` may differ. Any other key -- storage,
      -- projectFacts, an existing retry.automaticFailures streak -- must be
      -- carried through byte-identically.
      failure_reason := 'unrelated_facts_field_changed';
    ELSIF (to_jsonb(after_row) - 'retryable' - 'facts' - 'updated_at')
          IS DISTINCT FROM (to_jsonb(before_row) - 'retryable' - 'facts' - 'updated_at') THEN
      failure_reason := 'unrelated_field_changed';
    ELSE
      -- Scheduler isolation, asserted inside the transaction that created it.
      -- These are the two queries the automatic lane actually uses; if either
      -- admits the repaired row, nothing is committed.
      SELECT count(*)
        INTO due_after
        FROM public.studio_list_due_jobs(now(), 100, before_row.created_by) AS due
       WHERE due.id = p.job_id;
      active_after := public.studio_count_active_jobs(before_row.created_by);

      IF due_after IS DISTINCT FROM 0 THEN
        failure_reason := 'post_repair_job_is_due';
      ELSIF active_after IS DISTINCT FROM active_before THEN
        failure_reason := 'post_repair_active_count_changed';
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
          jsonb_build_object(
            'retryable', false,
            'automatic_retry', before_row.facts #>> '{retry,automatic}'
          ),
          jsonb_build_object(
            'retryable', true,
            'automatic_retry', s.required_automatic_state
          ),
          jsonb_build_object(
            'task', 'FOREVER-PR134-REPAIR-ISOLATION-AND-ABSOLUTE-DEADLINE-001',
            'approved_at', p.approved_at,
            'expected_workflow', p.expected_workflow,
            'expected_attempt_count', p.expected_attempt_count,
            'expected_file_count', p.expected_file_count,
            'material_purpose_multiset', s.required_purpose_multiset,
            'automatic_due_after', due_after,
            'automatic_active_unchanged', true,
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
  \echo 'contained_job_repair_committed affected_rows=1 automatic_retry=exhausted'
\else
  ROLLBACK;
  \echo 'contained_job_repair_rolled_back reason=' :repair_reason
  \quit 3
\endif
