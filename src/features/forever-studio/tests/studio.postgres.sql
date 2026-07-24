-- ============================================================================
-- FOREVER-STUDIO-001 — real-database behavioral suite.
--
-- Runs against a disposable PostgreSQL cluster after the COMPLETE committed
-- migration chain (see scripts/studio/run-postgres-tests.mjs). Proves the
-- corrective invariants at the database: RLS/grants, single-winner bootstrap,
-- concurrency-safe claim + stale recovery, atomic publish rollback, idempotent
-- retry, resale idempotency, private-contact isolation, anon visibility of
-- only published rows, and audit preservation after auth-user deletion.
-- No production connection.
-- ============================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'studio_pg_test_failed: %', message; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Internal-only RLS + grants
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE oid IN ('public.studio_members'::regclass,
                 'public.studio_upload_jobs'::regclass,
                 'public.studio_listing_contacts'::regclass,
                 'public.studio_object_owners'::regclass)),
  'studio internal tables have RLS enabled');

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename IN ('studio_members','studio_upload_jobs','studio_listing_contacts','studio_object_owners')),
  'studio internal tables have zero policies');

SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon','public.studio_members','SELECT')
  AND NOT has_table_privilege('authenticated','public.studio_members','SELECT')
  AND NOT has_table_privilege('anon','public.studio_upload_jobs','SELECT')
  AND NOT has_table_privilege('anon','public.studio_listing_contacts','SELECT')
  AND NOT has_table_privilege('authenticated','public.studio_listing_contacts','SELECT')
  AND NOT has_table_privilege('anon','public.studio_object_owners','SELECT')
  AND NOT has_table_privilege('authenticated','public.studio_object_owners','SELECT'),
  'anon/authenticated cannot read studio internal tables');

SELECT pg_temp.assert_true(
  has_table_privilege('service_role','public.studio_upload_jobs','INSERT')
  AND has_function_privilege('service_role','public.studio_publish_project(uuid,uuid,jsonb,boolean,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.studio_request_job_processing(uuid,uuid,integer)','EXECUTE')
  AND has_function_privilege('service_role','public.studio_count_active_jobs(uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.studio_list_due_jobs(timestamptz,integer,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.studio_update_resale(uuid,uuid,jsonb,jsonb,timestamptz,boolean)','EXECUTE')
  AND NOT has_function_privilege('anon','public.studio_publish_project(uuid,uuid,jsonb,boolean,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.studio_request_job_processing(uuid,uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('anon','public.studio_count_active_jobs(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.studio_list_due_jobs(timestamptz,integer,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.studio_update_resale(uuid,uuid,jsonb,jsonb,timestamptz,boolean)','EXECUTE'),
  'studio functions are service_role only');

-- ---------------------------------------------------------------------------
-- 2. Private contact isolation at the schema level
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='listings'
                AND column_name IN ('contact_name','contact_phone','contact_email')),
  'public listings row has no contact columns');
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='studio_listing_contacts'
            AND column_name='contact_email'),
  'private contact table carries the contact columns');

-- ---------------------------------------------------------------------------
-- 3. Single-winner Owner bootstrap
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-000000000001','owner@example.com',now()),
  ('00000000-0000-0000-0000-000000000002','other@example.com',now());

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_bootstrap_owner(
     '00000000-0000-0000-0000-000000000001','owner@example.com'))=1,
  'first bootstrap inserts the owner');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_bootstrap_owner(
     '00000000-0000-0000-0000-000000000002','other@example.com'))=0,
  'second bootstrap is a no-op on a non-empty roster');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_members WHERE role='owner')=1,
  'exactly one owner exists after racing bootstrap attempts');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.studio_members(user_id,role,email,invited_by)
      VALUES ('00000000-0000-0000-0000-000000000002','owner','other@example.com',NULL);
    RAISE EXCEPTION 'expected_unique_violation_absent';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

-- member disable keeps the row, denies via is_active flag
UPDATE public.studio_members SET is_active=false
  WHERE user_id='00000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(
  (SELECT NOT is_active FROM public.studio_members WHERE user_id='00000000-0000-0000-0000-000000000001'),
  'member disable retains the row');
UPDATE public.studio_members SET is_active=true
  WHERE user_id='00000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- 4. Concurrency-safe claim + stale recovery
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)
VALUES ('10000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001','owner','new_development','received');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_claim_job(
     '10000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',900))=0,
  'a pristine received manifest cannot be claimed');
SELECT pg_temp.assert_true(
  (SELECT processing_requested_at IS NULL FROM public.studio_upload_jobs
   WHERE id='10000000-0000-0000-0000-000000000001'),
  'a pristine received manifest remains explicitly unready');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_request_job_processing(
     '10000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',900))=1,
  'the explicit processing request marks readiness and wins the first claim');
SELECT pg_temp.assert_true(
  (SELECT processing_requested_at IS NOT NULL FROM public.studio_upload_jobs
   WHERE id='10000000-0000-0000-0000-000000000001'),
  'readiness is durable after the explicit processing request');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_claim_job(
     '10000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-00000000000b',900))=0,
  'a fresh concurrent claim gets nothing');

UPDATE public.studio_upload_jobs
  SET processing_started_at = now() - interval '20 minutes'
  WHERE id='10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_claim_job(
     '10000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-00000000000b',900))=1,
  'a stale claim is recoverable');

-- ---------------------------------------------------------------------------
-- 4b. Lease heartbeat: a live long-running worker is not considered dead
-- ---------------------------------------------------------------------------
-- Simulate 10 minutes of processing, then a heartbeat by the claim holder.
UPDATE public.studio_upload_jobs
  SET processing_started_at = now() - interval '10 minutes'
  WHERE id='10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(
  public.studio_heartbeat_job(
    '10000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-00000000000b'),
  'the claim holder heartbeat succeeds');
SELECT pg_temp.assert_true(
  NOT public.studio_heartbeat_job(
    '10000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a'),
  'a worker without the claim cannot heartbeat');
SELECT pg_temp.assert_true(
  (SELECT processing_started_at > now() - interval '1 minute'
   FROM public.studio_upload_jobs WHERE id='10000000-0000-0000-0000-000000000001'),
  'the heartbeat refreshed the lease');
-- The refreshed lease is FRESH: it cannot be stolen.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_claim_job(
     '10000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-0000000000cc',900))=0,
  'a heartbeaten lease cannot be stolen');
-- A stale worker (the OLD token) can no longer finalize the job.
DO $$
BEGIN
  BEGIN
    PERFORM public.studio_publish_project(
      '10000000-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-00000000000a',
      jsonb_build_object('schema_version','1','mode','create','batch_fingerprint',repeat('f',64),
        'project',jsonb_build_object('slug','stale-finalize','name','Stale Finalize')),
      true, '{}'::jsonb);
    RAISE EXCEPTION 'expected_stale_finalize_refusal_absent';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'studio_job_not_claimed' THEN RAISE; END IF;
  END;
END;
$$;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.projects WHERE slug='stale-finalize')=0,
  'a stale worker cannot finalize after losing its lease');

-- ---------------------------------------------------------------------------
-- 4c. Terminal failures: retryable=false is NEVER reclaimed
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  public.studio_fail_job(
    '10000000-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-00000000000b',
    'processing_failed','safe terminal message', false),
  'the claim holder can fail its job terminally');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_claim_job(
     '10000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-0000000000dd',900))=0,
  'a retryable=false job is never reclaimed');
-- Flipping it back to retryable makes it claimable again (manual recovery).
UPDATE public.studio_upload_jobs SET retryable = true
  WHERE id='10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_claim_job(
     '10000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-0000000000dd',900))=1,
  'a retryable failure stays recoverable');

-- ---------------------------------------------------------------------------
-- 4d. Disabled/missing source membership cannot mutate readiness or claims
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-000000000006','disabled-source@example.com',now());
INSERT INTO public.studio_members(user_id,role,email,invited_by,is_active) VALUES
  ('00000000-0000-0000-0000-000000000006','trusted_publisher','disabled-source@example.com',
   '00000000-0000-0000-0000-000000000001',true);
INSERT INTO public.studio_upload_jobs(
  id,created_by,creator_role,workflow,status,processing_requested_at
) VALUES
  ('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006',
   'owner','new_development','received',now()),
  ('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000006',
   'owner','new_development','received',NULL);
UPDATE public.studio_members SET is_active=false
WHERE user_id='00000000-0000-0000-0000-000000000006';

DO $$
DECLARE
  v_claim_before JSONB;
  v_request_before JSONB;
BEGIN
  SELECT to_jsonb(j) INTO v_claim_before FROM public.studio_upload_jobs j
  WHERE id='10000000-0000-0000-0000-000000000006';
  SELECT to_jsonb(j) INTO v_request_before FROM public.studio_upload_jobs j
  WHERE id='10000000-0000-0000-0000-000000000007';

  BEGIN
    PERFORM * FROM public.studio_claim_job(
      '10000000-0000-0000-0000-000000000006',
      'eeeeeeee-0000-0000-0000-0000000000ee',900);
    RAISE EXCEPTION 'expected_disabled_claim_refusal_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'studio_membership_required' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.studio_request_job_processing(
      '10000000-0000-0000-0000-000000000007',
      'ffffffff-0000-0000-0000-0000000000ff',900);
    RAISE EXCEPTION 'expected_disabled_request_refusal_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'studio_membership_required' THEN RAISE; END IF;
  END;

  IF (SELECT to_jsonb(j) FROM public.studio_upload_jobs j
      WHERE id='10000000-0000-0000-0000-000000000006') IS DISTINCT FROM v_claim_before THEN
    RAISE EXCEPTION 'studio_pg_test_failed: disabled source mutated claim state';
  END IF;
  IF (SELECT to_jsonb(j) FROM public.studio_upload_jobs j
      WHERE id='10000000-0000-0000-0000-000000000007') IS DISTINCT FROM v_request_before THEN
    RAISE EXCEPTION 'studio_pg_test_failed: disabled source mutated readiness state';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4e. Resume selection excludes disabled/missing sources before LIMIT, while
--     active counting is independent of any bounded history slice
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-000000000008','missing-source@example.com',now());

INSERT INTO public.studio_upload_jobs(
  id,created_by,creator_role,workflow,status,processing_requested_at,created_at
) VALUES
  ('12000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006',
   'trusted_publisher','new_development','received','2000-01-01','2000-01-01'),
  ('12000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000006',
   'trusted_publisher','new_development','received','2000-01-02','2000-01-02'),
  ('12000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000006',
   'trusted_publisher','new_development','received','2000-01-03','2000-01-03'),
  ('12000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000008',
   'trusted_publisher','new_development','received','2000-01-04','2000-01-04'),
  ('12000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000008',
   'trusted_publisher','new_development','received','2000-01-05','2000-01-05'),
  ('12000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000008',
   'trusted_publisher','new_development','received','2000-01-06','2000-01-06'),
  ('12000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001',
   'owner','new_development','received','2001-01-01','2001-01-01');

DO $$
DECLARE
  v_invalid_before JSONB;
  v_first_due UUID;
BEGIN
  SELECT jsonb_agg(to_jsonb(job) ORDER BY job.id) INTO v_invalid_before
  FROM public.studio_upload_jobs AS job
  WHERE job.id BETWEEN '12000000-0000-0000-0000-000000000001'
                   AND '12000000-0000-0000-0000-000000000006';

  SELECT id INTO v_first_due
  FROM public.studio_list_due_jobs(now(), 1, NULL);
  IF v_first_due IS DISTINCT FROM '12000000-0000-0000-0000-000000000007'::uuid THEN
    RAISE EXCEPTION 'studio_pg_test_failed: invalid sources consumed the resume limit';
  END IF;

  IF public.studio_count_active_jobs('00000000-0000-0000-0000-000000000006') <> 0
     OR public.studio_count_active_jobs('00000000-0000-0000-0000-000000000008') <> 0
     OR public.studio_count_active_jobs('00000000-0000-0000-0000-000000000001') < 1 THEN
    RAISE EXCEPTION 'studio_pg_test_failed: active count did not enforce actor/source eligibility';
  END IF;

  IF (SELECT jsonb_agg(to_jsonb(job) ORDER BY job.id)
      FROM public.studio_upload_jobs AS job
      WHERE job.id BETWEEN '12000000-0000-0000-0000-000000000001'
                       AND '12000000-0000-0000-0000-000000000006')
      IS DISTINCT FROM v_invalid_before THEN
    RAISE EXCEPTION 'studio_pg_test_failed: eligibility reads mutated invalid jobs';
  END IF;
END;
$$;

DELETE FROM public.studio_upload_jobs
WHERE created_by IN (
  '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000008'
) OR id='12000000-0000-0000-0000-000000000007';
DELETE FROM public.studio_members WHERE user_id='00000000-0000-0000-0000-000000000006';
DELETE FROM auth.users WHERE id IN (
  '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000008'
);

-- ---------------------------------------------------------------------------
-- 5. Atomic publish rollback: a failure leaves no project, child, or batch
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)
VALUES ('10000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001','owner','new_development','received');
SELECT public.studio_request_job_processing(
  '10000000-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-00000000000c',900);

DO $$
BEGIN
  BEGIN
    PERFORM public.studio_publish_project(
      '10000000-0000-0000-0000-000000000002',
      'cccccccc-0000-0000-0000-00000000000c',
      jsonb_build_object(
        'schema_version','1','mode','create','batch_fingerprint',repeat('a',64),
        'project',jsonb_build_object('slug','rollback-proj','name','Rollback'),
        -- a unit with no unit_code makes forever_progressive_ingest raise
        'units',jsonb_build_array(jsonb_build_object('unit_type','A'))),
      true, '{}'::jsonb);
    RAISE EXCEPTION 'expected_publish_failure_absent';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'expected_publish_failure_absent' THEN RAISE; END IF;
  END;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.projects WHERE slug='rollback-proj')=0,
  'rollback left no project');
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.ingestion_batches ib
              WHERE ib.batch_fingerprint=repeat('a',64)),
  'rollback left no ingestion batch');
SELECT pg_temp.assert_true(
  (SELECT status FROM public.studio_upload_jobs WHERE id='10000000-0000-0000-0000-000000000002')='processing',
  'a rolled-back job is not published');

-- ---------------------------------------------------------------------------
-- 6. Idempotent create + publish + retry (one project, one batch)
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)
VALUES ('10000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000001','owner','new_development','received');
SELECT public.studio_request_job_processing(
  '10000000-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-00000000000d',900);
SELECT public.studio_publish_project(
  '10000000-0000-0000-0000-000000000003',
  'dddddddd-0000-0000-0000-00000000000d',
  jsonb_build_object('schema_version','1','mode','create','batch_fingerprint',repeat('b',64),
    'project',jsonb_build_object('slug','retry-proj','name','Retry Project')),
  true, jsonb_build_object('pagePath','/projects/retry-proj'));

SELECT pg_temp.assert_true(
  (SELECT public_status FROM public.projects WHERE slug='retry-proj')='published',
  'create + publish is atomic and published');
SELECT pg_temp.assert_true(
  (SELECT created_by='00000000-0000-0000-0000-000000000001'::uuid
   FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
   WHERE o.object_type='project' AND p.slug='retry-proj'),
  'project ownership attribution is private and immutable');
SELECT pg_temp.assert_true(
  (SELECT status FROM public.studio_upload_jobs WHERE id='10000000-0000-0000-0000-000000000003')='published',
  'the job is finalized as published');

SELECT pg_temp.assert_true(
  (public.studio_publish_project(
     '10000000-0000-0000-0000-000000000003',
     'dddddddd-0000-0000-0000-00000000000d',
     jsonb_build_object('schema_version','1','mode','create','batch_fingerprint',repeat('b',64),
       'project',jsonb_build_object('slug','retry-proj','name','Retry Project')),
     true, '{}'::jsonb)->>'replayed')::boolean,
  'a published job replays instead of re-publishing');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.projects WHERE slug='retry-proj')=1,
  'exactly one project after replay');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.ingestion_batches ib JOIN public.projects p ON p.id=ib.project_id
   WHERE p.slug='retry-proj')=1,
  'exactly one ingestion batch after replay');

-- ---------------------------------------------------------------------------
-- 6b. Active Owner may update a Trusted Publisher-owned project without
--     transferring its immutable creation attribution
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_members(user_id,role,email,invited_by,is_active)
VALUES ('00000000-0000-0000-0000-000000000002','trusted_publisher',
        'other@example.com','00000000-0000-0000-0000-000000000001',true);

INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)
VALUES ('11000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002','trusted_publisher','new_development','received');
SELECT public.studio_request_job_processing(
  '11000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000011',900);
SELECT public.studio_publish_project(
  '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000011',
  jsonb_build_object('schema_version','1','mode','create','batch_fingerprint',repeat('1',64),
    'project',jsonb_build_object('slug','publisher-owned','name','Publisher Owned'),
    'units',jsonb_build_array(jsonb_build_object('unit_code','U1'))),
  true, '{}'::jsonb);

INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status,project_slug)
VALUES ('11000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001','trusted_publisher','project_update','received',
        'publisher-owned');
SELECT public.studio_request_job_processing(
  '11000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000012',900);
SELECT public.studio_publish_project(
  '11000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000012',
  jsonb_build_object('schema_version','1','mode','enrich','batch_fingerprint',repeat('2',64),
    'project',jsonb_build_object('slug','publisher-owned',
      'set',jsonb_build_object('short_description','Owner update'))),
  true, '{}'::jsonb);

SELECT pg_temp.assert_true(
  (SELECT short_description FROM public.projects WHERE slug='publisher-owned')='Owner update',
  'Owner update applies to a Publisher-owned project');
SELECT pg_temp.assert_true(
  (SELECT o.created_by='00000000-0000-0000-0000-000000000002'::uuid
   FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
   WHERE o.object_type='project' AND p.slug='publisher-owned'),
  'Owner update leaves immutable ownership with the creating Publisher');

-- The audit snapshot deliberately says trusted_publisher for every Owner job:
-- current active studio_members.role, not creator_role, controls authorization.
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status,project_slug)
VALUES ('11000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000001','trusted_publisher',
        'price_availability_update','received','publisher-owned');
SELECT public.studio_request_job_processing(
  '11000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000013',900);
SELECT public.studio_publish_project(
  '11000000-0000-0000-0000-000000000003',
  '11000000-0000-0000-0000-000000000013',
  jsonb_build_object('schema_version','1','mode','enrich','batch_fingerprint',repeat('3',64),
    'project',jsonb_build_object('slug','publisher-owned'),
    'prices',jsonb_build_array(jsonb_build_object(
      'unit_code','U1','price',12345678,'currency','THB',
      'price_source','studio','source_file','owner-price.json','price_list_date','2026-07-22'))),
  true, '{}'::jsonb);

INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status,project_slug)
VALUES ('11000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000001','trusted_publisher',
        'construction_media_update','received','publisher-owned');
SELECT public.studio_request_job_processing(
  '11000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000014',900);
SELECT public.studio_publish_project(
  '11000000-0000-0000-0000-000000000004',
  '11000000-0000-0000-0000-000000000014',
  jsonb_build_object('schema_version','1','mode','enrich','batch_fingerprint',repeat('4',64),
    'project',jsonb_build_object('slug','publisher-owned'),
    'media',jsonb_build_array(jsonb_build_object(
      'media_type','gallery','url','https://cdn.test/owner-construction.jpg',
      'title','Construction update 2026-07-22'))),
  true, '{}'::jsonb);

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.unit_price_history ph
   JOIN public.units u ON u.id=ph.unit_id JOIN public.projects p ON p.id=u.project_id
   WHERE p.slug='publisher-owned' AND ph.price=12345678)=1,
  'Owner price/availability workflow updates a Publisher-owned project');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.project_media m JOIN public.projects p ON p.id=m.project_id
   WHERE p.slug='publisher-owned' AND m.url='https://cdn.test/owner-construction.jpg')=1,
  'Owner construction-media workflow updates a Publisher-owned project');
SELECT pg_temp.assert_true(
  (SELECT o.created_by='00000000-0000-0000-0000-000000000002'::uuid
   FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
   WHERE o.object_type='project' AND p.slug='publisher-owned'),
  'all Owner workflows preserve Publisher creation attribution');

-- Exact published-job replays do not duplicate graph, price, media, warning,
-- or ownership rows.
SELECT public.studio_publish_project(
  '11000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000012',
  '{}'::jsonb,true,'{}'::jsonb);
SELECT public.studio_publish_project(
  '11000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000013',
  '{}'::jsonb,true,'{}'::jsonb);
SELECT public.studio_publish_project(
  '11000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000014',
  '{}'::jsonb,true,'{}'::jsonb);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.projects WHERE slug='publisher-owned')=1
  AND (SELECT count(*) FROM public.unit_price_history ph
       JOIN public.units u ON u.id=ph.unit_id JOIN public.projects p ON p.id=u.project_id
       WHERE p.slug='publisher-owned' AND ph.price=12345678)=1
  AND (SELECT count(*) FROM public.project_media m JOIN public.projects p ON p.id=m.project_id
       WHERE p.slug='publisher-owned' AND m.url='https://cdn.test/owner-construction.jpg')=1
  AND (SELECT count(*) FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
       WHERE o.object_type='project' AND p.slug='publisher-owned')=1,
  'Owner workflow replay creates no duplicate graph, price, media, or ownership');

-- A different Publisher remains denied even when creator_role is forged as
-- owner; the failed function call leaves project and ownership unchanged.
INSERT INTO auth.users(id,email,email_confirmed_at)
VALUES ('00000000-0000-0000-0000-000000000006','publisher-c@example.com',now()),
       ('00000000-0000-0000-0000-000000000007','nonmember@example.com',now());
INSERT INTO public.studio_members(user_id,role,email,invited_by,is_active)
VALUES ('00000000-0000-0000-0000-000000000006','trusted_publisher',
        'publisher-c@example.com','00000000-0000-0000-0000-000000000001',true);
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status,project_slug)
VALUES ('11000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006','owner','project_update','received',
        'publisher-owned');
SELECT public.studio_request_job_processing(
  '11000000-0000-0000-0000-000000000005','11000000-0000-0000-0000-000000000015',900);
DO $$ BEGIN
  BEGIN
    PERFORM public.studio_publish_project(
      '11000000-0000-0000-0000-000000000005','11000000-0000-0000-0000-000000000015',
      jsonb_build_object('schema_version','1','mode','enrich','batch_fingerprint',repeat('5',64),
        'project',jsonb_build_object('slug','publisher-owned',
          'set',jsonb_build_object('short_description','Cross-publisher overwrite'))),
      true,'{}'::jsonb);
    RAISE EXCEPTION 'expected_cross_publisher_denial_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'studio_object_ownership_conflict' THEN RAISE; END IF;
  END;
END $$;
SELECT pg_temp.assert_true(
  (SELECT short_description FROM public.projects WHERE slug='publisher-owned')='Owner update'
  AND (SELECT o.created_by='00000000-0000-0000-0000-000000000002'::uuid
       FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
       WHERE o.object_type='project' AND p.slug='publisher-owned'),
  'cross-Publisher denial has zero project or ownership effect');

-- Legacy/unassigned objects remain Owner-only. The first successful Owner
-- update writes the one immutable Owner attribution.
SELECT public.forever_progressive_ingest(jsonb_build_object(
  'schema_version','1','mode','create','batch_fingerprint',repeat('6',64),
  'project',jsonb_build_object('slug','legacy-review','name','Legacy Review')));
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status,project_slug)
VALUES ('11000000-0000-0000-0000-000000000006',
        '00000000-0000-0000-0000-000000000006','owner','project_update','received',
        'legacy-review');
SELECT public.studio_request_job_processing(
  '11000000-0000-0000-0000-000000000006','11000000-0000-0000-0000-000000000016',900);
DO $$ BEGIN
  BEGIN
    PERFORM public.studio_publish_project(
      '11000000-0000-0000-0000-000000000006','11000000-0000-0000-0000-000000000016',
      jsonb_build_object('schema_version','1','mode','enrich','batch_fingerprint',repeat('7',64),
        'project',jsonb_build_object('slug','legacy-review',
          'set',jsonb_build_object('short_description','Publisher legacy overwrite'))),
      true,'{}'::jsonb);
    RAISE EXCEPTION 'expected_legacy_publisher_denial_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'studio_object_ownership_conflict' THEN RAISE; END IF;
  END;
END $$;
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
              WHERE o.object_type='project' AND p.slug='legacy-review'),
  'denied Publisher does not attribute or mutate a legacy object');

INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status,project_slug)
VALUES ('11000000-0000-0000-0000-000000000007',
        '00000000-0000-0000-0000-000000000001','trusted_publisher','project_update','received',
        'legacy-review');
SELECT public.studio_request_job_processing(
  '11000000-0000-0000-0000-000000000007','11000000-0000-0000-0000-000000000017',900);
SELECT public.studio_publish_project(
  '11000000-0000-0000-0000-000000000007','11000000-0000-0000-0000-000000000017',
  jsonb_build_object('schema_version','1','mode','enrich','batch_fingerprint',repeat('8',64),
    'project',jsonb_build_object('slug','legacy-review',
      'set',jsonb_build_object('short_description','Owner legacy update'))),
  true,'{}'::jsonb);
SELECT pg_temp.assert_true(
  (SELECT short_description FROM public.projects WHERE slug='legacy-review')='Owner legacy update'
  AND (SELECT o.created_by='00000000-0000-0000-0000-000000000001'::uuid
       FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
       WHERE o.object_type='project' AND p.slug='legacy-review'),
  'Owner updates and receives attribution for a legacy object');

-- Disabled and non-member identities fail on current membership even when
-- their immutable job snapshot says owner.
UPDATE public.studio_members SET is_active=false
WHERE user_id='00000000-0000-0000-0000-000000000001';
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status,project_slug)
VALUES
  ('11000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001',
   'owner','project_update','received','publisher-owned'),
  ('11000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000007',
   'owner','project_update','received','publisher-owned');
DO $$ DECLARE v_job uuid; v_token uuid; BEGIN
  FOR v_job,v_token IN VALUES
    ('11000000-0000-0000-0000-000000000008'::uuid,'11000000-0000-0000-0000-000000000018'::uuid),
    ('11000000-0000-0000-0000-000000000009'::uuid,'11000000-0000-0000-0000-000000000019'::uuid)
  LOOP
    BEGIN
      PERFORM * FROM public.studio_request_job_processing(v_job,v_token,900);
      RAISE EXCEPTION 'expected_membership_denial_absent';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'studio_membership_required' THEN RAISE; END IF;
    END;
  END LOOP;
END $$;
UPDATE public.studio_members SET is_active=true
WHERE user_id='00000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(
  (SELECT short_description FROM public.projects WHERE slug='publisher-owned')='Owner update'
  AND (SELECT bool_and(status='received' AND processing_requested_at IS NULL
                       AND processing_token IS NULL AND attempt_count=0)
       FROM public.studio_upload_jobs
       WHERE id IN ('11000000-0000-0000-0000-000000000008',
                    '11000000-0000-0000-0000-000000000009')),
  'disabled and non-member processing attempts have zero job or project effect');

-- ---------------------------------------------------------------------------
-- 7. Resale: atomic + idempotent + private contact
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)
VALUES ('10000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000002','trusted_publisher','resale_listing','received');
SELECT public.studio_request_job_processing(
  '10000000-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-00000000000e',900);
SELECT public.studio_publish_resale(
  '10000000-0000-0000-0000-000000000004',
  'eeeeeeee-0000-0000-0000-00000000000e',
  jsonb_build_object('title','Resale One','slug','resale-one-abc',
    'price',4000000,
    'photos',jsonb_build_array('https://cdn.test/project-images/x.jpg'),
    'availability_status','available','field_provenance','{}'::jsonb),
  jsonb_build_object('contact_name','Jane','contact_phone','+66 1','contact_email','jane@example.com'),
  '[]'::jsonb, '{}'::jsonb);

SELECT pg_temp.assert_true(
  (SELECT publication_status FROM public.listings WHERE slug='resale-one-abc')='published',
  'resale listing published atomically');
SELECT pg_temp.assert_true(
  (SELECT contact_email FROM public.studio_listing_contacts c
   JOIN public.listings l ON l.id=c.listing_id WHERE l.slug='resale-one-abc')='jane@example.com',
  'contact stored in the private table');
SELECT pg_temp.assert_true(
  (SELECT created_by='00000000-0000-0000-0000-000000000002'::uuid
   FROM public.studio_object_owners o JOIN public.listings l ON l.id=o.object_id
   WHERE o.object_type='listing' AND l.slug='resale-one-abc'),
  'listing ownership attribution is private and immutable');

-- replay: no duplicate listing
SELECT public.studio_publish_resale(
  '10000000-0000-0000-0000-000000000004',
  'eeeeeeee-0000-0000-0000-00000000000e',
  jsonb_build_object('title','Resale One','slug','resale-one-abc',
    'price',4000000,
    'photos',jsonb_build_array('https://cdn.test/project-images/x.jpg'),
    'availability_status','available','field_provenance','{}'::jsonb),
  jsonb_build_object('contact_name','Jane','contact_phone','+66 1','contact_email','jane@example.com'),
  '[]'::jsonb, '{}'::jsonb);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.listings WHERE slug='resale-one-abc')=1,
  'resale replay creates no duplicate listing');

-- Resale editing is one transaction across public facts/provenance, private
-- contact, and deduplicated conflict warnings. The Owner may edit this
-- Publisher-owned listing without transferring its creation attribution.
UPDATE public.listings
SET field_provenance=jsonb_build_object(
  'price',jsonb_build_object('status','owner_verified','supplied_at',now()))
WHERE slug='resale-one-abc';
DO $$ DECLARE v_listing uuid; BEGIN
  SELECT id INTO v_listing FROM public.listings WHERE slug='resale-one-abc';
  BEGIN
    PERFORM public.studio_update_resale(
      v_listing,'00000000-0000-0000-0000-000000000001',
      jsonb_build_object('description','Atomic description','price',1),
      jsonb_build_object('contact_phone','+66 rollback'),now(),true);
    RAISE EXCEPTION 'expected_resale_edit_failure_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'studio_resale_edit_injected_failure' THEN RAISE; END IF;
  END;
END $$;
SELECT pg_temp.assert_true(
  (SELECT description IS NULL AND price=4000000 FROM public.listings WHERE slug='resale-one-abc')
  AND (SELECT contact_phone='+66 1' FROM public.studio_listing_contacts c
       JOIN public.listings l ON l.id=c.listing_id WHERE l.slug='resale-one-abc')
  AND NOT EXISTS (SELECT 1 FROM public.ingestion_warnings w JOIN public.listings l ON l.id=w.listing_id
                  WHERE l.slug='resale-one-abc' AND w.code='listing_field_conflict_preserved'),
  'injected resale edit failure rolls back facts, provenance, contact, and warning');

SELECT public.studio_update_resale(
  (SELECT id FROM public.listings WHERE slug='resale-one-abc'),
  '00000000-0000-0000-0000-000000000001',
  jsonb_build_object('description','Atomic description','price',1),
  jsonb_build_object('contact_phone','+66 committed'),
  '2026-07-22T12:00:00Z',false);
SELECT public.studio_update_resale(
  (SELECT id FROM public.listings WHERE slug='resale-one-abc'),
  '00000000-0000-0000-0000-000000000001',
  jsonb_build_object('description','Atomic description','price',1),
  jsonb_build_object('contact_phone','+66 committed'),
  '2026-07-22T12:00:00Z',false);
SELECT pg_temp.assert_true(
  (SELECT description='Atomic description' AND price=4000000
          AND field_provenance#>>'{description,status}'='owner_provided'
   FROM public.listings WHERE slug='resale-one-abc')
  AND (SELECT contact_phone='+66 committed' FROM public.studio_listing_contacts c
       JOIN public.listings l ON l.id=c.listing_id WHERE l.slug='resale-one-abc')
  AND (SELECT count(*) FROM public.ingestion_warnings w JOIN public.listings l ON l.id=w.listing_id
       WHERE l.slug='resale-one-abc' AND w.code='listing_field_conflict_preserved'
         AND w.field='price')=1
  AND (SELECT o.created_by='00000000-0000-0000-0000-000000000002'::uuid
       FROM public.studio_object_owners o JOIN public.listings l ON l.id=o.object_id
       WHERE o.object_type='listing' AND l.slug='resale-one-abc'),
  'resale edit commits atomically, replays without warning duplicates, and preserves ownership');

-- ---------------------------------------------------------------------------
-- 8. Anon sees only published rows; never private contacts
-- ---------------------------------------------------------------------------
-- a draft project must be invisible to anon
SELECT public.forever_progressive_ingest(jsonb_build_object(
  'schema_version','1','mode','create','batch_fingerprint',repeat('c',64),
  'project',jsonb_build_object('slug','draft-proj','name','Draft Project')));

SET ROLE anon;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.projects WHERE slug='retry-proj')=1,
  'anon sees the published project');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.projects WHERE slug='draft-proj')=0,
  'anon cannot see the draft project');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.listings WHERE slug='resale-one-abc')=1,
  'anon sees the published listing');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 9. Cross-project isolation (each project keeps its own units)
-- ---------------------------------------------------------------------------
SELECT public.forever_progressive_ingest(jsonb_build_object(
  'schema_version','1','mode','create','batch_fingerprint',repeat('d',64),
  'project',jsonb_build_object('slug','iso-a','name','Iso A'),
  'units',jsonb_build_array(jsonb_build_object('unit_code','U1'))));
SELECT public.forever_progressive_ingest(jsonb_build_object(
  'schema_version','1','mode','create','batch_fingerprint',repeat('e',64),
  'project',jsonb_build_object('slug','iso-b','name','Iso B'),
  'units',jsonb_build_array(jsonb_build_object('unit_code','U1'))));
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.units u JOIN public.projects p ON p.id=u.project_id
   WHERE p.slug='iso-a')=1
  AND (SELECT count(*) FROM public.units u JOIN public.projects p ON p.id=u.project_id
       WHERE p.slug='iso-b')=1,
  'each project owns exactly its own unit');

-- ---------------------------------------------------------------------------
-- 10. Audit/history preservation on auth-user deletion
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id,email) VALUES
  ('000000ff-0000-0000-0000-0000000000ff','tempuser@example.com');
INSERT INTO public.studio_upload_jobs(id,created_by,creator_email,creator_role,workflow,status)
VALUES ('100000ff-0000-0000-0000-0000000000ff',
        '000000ff-0000-0000-0000-0000000000ff','tempuser@example.com','trusted_publisher','project_update','published');
DELETE FROM auth.users WHERE id='000000ff-0000-0000-0000-0000000000ff';

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_upload_jobs WHERE id='100000ff-0000-0000-0000-0000000000ff')=1,
  'the job survives auth-user deletion');
SELECT pg_temp.assert_true(
  (SELECT created_by IS NULL AND creator_email='tempuser@example.com'
   FROM public.studio_upload_jobs WHERE id='100000ff-0000-0000-0000-0000000000ff'),
  'created_by is nulled but the creator snapshot is retained');

-- ---------------------------------------------------------------------------
-- 11. Deterministic ownership backfill for the applied boundary
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  ('00000000-0000-0000-0000-000000000003','publisher-a@example.com',now()),
  ('00000000-0000-0000-0000-000000000004','publisher-b@example.com',now());
INSERT INTO public.studio_members(user_id,role,email,invited_by) VALUES
  ('00000000-0000-0000-0000-000000000003','trusted_publisher','publisher-a@example.com','00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000004','trusted_publisher','publisher-b@example.com','00000000-0000-0000-0000-000000000001');

-- These objects simulate data present before the ownership table existed.
SELECT public.forever_progressive_ingest(jsonb_build_object(
  'schema_version','1','mode','create','batch_fingerprint',repeat('1',64),
  'project',jsonb_build_object('slug','backfill-project','name','Backfill Project')));
INSERT INTO public.listings(title,slug,publication_status)
VALUES ('Backfill Listing','backfill-listing','published');

-- The earliest successful creation is authoritative. A later update by B is
-- deliberately irrelevant and must never transfer A's project.
INSERT INTO public.studio_upload_jobs(
  id,created_by,creator_role,workflow,status,project_slug,result_summary,created_at
) VALUES
  ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','trusted_publisher','new_development','published',
   'backfill-project',jsonb_build_object('projectId',(SELECT id::text FROM public.projects WHERE slug='backfill-project')),
   now() - interval '2 minutes'),
  ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','trusted_publisher','project_update','published',
   'backfill-project','{}'::jsonb,now() - interval '1 minute'),
  ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','trusted_publisher','resale_listing','published',
   NULL,jsonb_build_object('listingId',(SELECT id::text FROM public.listings WHERE slug='backfill-listing'),'slug','backfill-listing'),
   now());
UPDATE public.studio_upload_jobs SET listing_id=(SELECT id FROM public.listings WHERE slug='backfill-listing'),
  content_fingerprint='backfill-listing'
WHERE id='20000000-0000-0000-0000-000000000003';

-- A matching pre-existing row is preserved, not replaced.
INSERT INTO public.studio_object_owners(object_type,object_id,created_by)
SELECT 'project',id,'00000000-0000-0000-0000-000000000001'::uuid
FROM public.projects WHERE slug='draft-proj';

SELECT public.studio_backfill_existing_object_owners();
SELECT pg_temp.assert_true(
  (SELECT created_by='00000000-0000-0000-0000-000000000003'::uuid
   FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
   WHERE o.object_type='project' AND p.slug='backfill-project'),
  'existing project receives its earliest successful creator ownership');
SELECT pg_temp.assert_true(
  (SELECT created_by='00000000-0000-0000-0000-000000000004'::uuid
   FROM public.studio_object_owners o JOIN public.listings l ON l.id=o.object_id
   WHERE o.object_type='listing' AND l.slug='backfill-listing'),
  'existing listing receives its successful creator ownership');
SELECT pg_temp.assert_true(
  (SELECT created_by='00000000-0000-0000-0000-000000000003'::uuid
   FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
   WHERE o.object_type='project' AND p.slug='backfill-project'),
  'later update jobs do not transfer ownership');
SELECT pg_temp.assert_true(
  (SELECT created_by='00000000-0000-0000-0000-000000000001'::uuid
   FROM public.studio_object_owners o JOIN public.projects p ON p.id=o.object_id
   WHERE o.object_type='project' AND p.slug='draft-proj'),
  'legacy pre-Studio objects are Owner-managed and matching ownership is preserved');

DO $$
DECLARE v_before INTEGER; v_after INTEGER;
BEGIN
  SELECT count(*) INTO v_before FROM public.studio_object_owners;
  PERFORM public.studio_backfill_existing_object_owners();
  SELECT count(*) INTO v_after FROM public.studio_object_owners;
  IF v_before <> v_after THEN RAISE EXCEPTION 'studio_pg_test_failed: backfill replay duplicated ownership'; END IF;
END;
$$;

-- Every rejection runs in a subtransaction, proving that the failed backfill
-- writes no partial ownership and leaves no unrelated database state changed.
DO $$
DECLARE v_project UUID;
BEGIN
  BEGIN
    SELECT (public.forever_progressive_ingest(jsonb_build_object(
      'schema_version','1','mode','create','batch_fingerprint',repeat('2',64),
      'project',jsonb_build_object('slug','backfill-conflicting-creators','name','Conflict')))->>'project_id')::uuid INTO v_project;
    INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status,project_slug,result_summary)
    VALUES
      ('20000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003','trusted_publisher','new_development','published','backfill-conflicting-creators',jsonb_build_object('projectId',v_project::text)),
      ('20000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004','trusted_publisher','new_development','published','backfill-conflicting-creators',jsonb_build_object('projectId',v_project::text));
    PERFORM public.studio_backfill_existing_object_owners();
    RAISE EXCEPTION 'expected_creator_conflict_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'studio_owner_backfill_creator_conflict' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO auth.users(id,email) VALUES ('00000000-0000-0000-0000-000000000005','second-owner@example.com');
    -- The bootstrap index permits invited owners; the corrective migration
    -- independently rejects every multi-Owner roster before it writes.
    INSERT INTO public.studio_members(user_id,role,email,invited_by)
    VALUES ('00000000-0000-0000-0000-000000000005','owner','second-owner@example.com','00000000-0000-0000-0000-000000000001');
    PERFORM public.studio_backfill_existing_object_owners();
    RAISE EXCEPTION 'expected_multiple_owner_failure_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'studio_owner_backfill_multiple_owners' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
DECLARE v_project UUID;
BEGIN
  BEGIN
    SELECT (public.forever_progressive_ingest(jsonb_build_object(
      'schema_version','1','mode','create','batch_fingerprint',repeat('3',64),
      'project',jsonb_build_object('slug','backfill-existing-conflict','name','Existing Conflict')))->>'project_id')::uuid INTO v_project;
    INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status,project_slug,result_summary)
    VALUES ('20000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003','trusted_publisher','new_development','published','backfill-existing-conflict',jsonb_build_object('projectId',v_project::text));
    INSERT INTO public.studio_object_owners(object_type,object_id,created_by)
    VALUES ('project',v_project,'00000000-0000-0000-0000-000000000004');
    PERFORM public.studio_backfill_existing_object_owners();
    RAISE EXCEPTION 'expected_existing_owner_conflict_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'studio_owner_backfill_existing_owner_conflict' THEN RAISE; END IF;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. Public projection grants: real PostgreSQL role behavior
-- ---------------------------------------------------------------------------
INSERT INTO public.developers(id,name,description,website,contact_name,contact_phone,contact_email)
VALUES (
  '90000000-0000-0000-0000-000000000001','Privacy Developer','Recorded description',
  'https://developer.example','Private Contact','+66-private','private-developer@example.com'
);
INSERT INTO public.projects(
  id,developer_id,name,slug,is_active,public_status,field_provenance,start_date_display,completion_date_display
) VALUES (
  '90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001',
  'Privacy Published','privacy-published',true,'published',
  '{"source_path":"forever-data/projects/coralina/source/private.pdf"}'::jsonb,'Q1 2026','Q4 2027'
),(
  '90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001',
  'Privacy Draft','privacy-draft',true,'draft','{"source_path":"private/draft.pdf"}'::jsonb,NULL,NULL
);
INSERT INTO public.units(id,project_id,unit_code,metadata)
VALUES
  ('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000002','P-1','{"private_path":"units/P-1.pdf"}'::jsonb),
  ('90000000-0000-0000-0000-000000000007','90000000-0000-0000-0000-000000000003','D-1','{"private_path":"units/D-1.pdf"}'::jsonb);
INSERT INTO public.project_media(id,project_id,media_type,url,metadata)
VALUES
  ('90000000-0000-0000-0000-000000000005','90000000-0000-0000-0000-000000000002','gallery','https://cdn.example/privacy.jpg','{"private_path":"media/private.jpg"}'::jsonb),
  ('90000000-0000-0000-0000-000000000008','90000000-0000-0000-0000-000000000003','gallery','https://cdn.example/draft-private.jpg','{"private_path":"media/draft-private.jpg"}'::jsonb);
INSERT INTO public.investment_data(id,project_id,notes)
VALUES
  ('90000000-0000-0000-0000-000000000006','90000000-0000-0000-0000-000000000002','Recorded only'),
  ('90000000-0000-0000-0000-000000000009','90000000-0000-0000-0000-000000000003','Draft private');
INSERT INTO public.unit_price_history(unit_id,price,currency,source_file,source_page,metadata)
VALUES ('90000000-0000-0000-0000-000000000004',1000000,'THB','forever-data/projects/coralina/source/price-list/private.pdf',1,'{"private_path":"prices/private.pdf"}'::jsonb);

SELECT pg_temp.assert_true(
  has_column_privilege('anon','public.projects','developer_id','SELECT')
  AND has_column_privilege('authenticated','public.projects','developer_id','SELECT')
  AND has_column_privilege('anon','public.units','project_id','SELECT')
  AND has_column_privilege('authenticated','public.units','project_id','SELECT')
  AND has_column_privilege('anon','public.project_media','project_id','SELECT')
  AND has_column_privilege('authenticated','public.project_media','project_id','SELECT')
  AND has_column_privilege('anon','public.projects','public_status','SELECT')
  AND has_column_privilege('authenticated','public.projects','public_status','SELECT')
  AND has_column_privilege('anon','public.investment_data','project_id','SELECT')
  AND has_column_privilege('authenticated','public.investment_data','project_id','SELECT'),
  'anon/authenticated have every FK and cross-table RLS column required by public embeds');
SELECT pg_temp.assert_true(
  has_column_privilege('anon','public.projects','start_date_display','SELECT')
  AND has_column_privilege('authenticated','public.projects','completion_date_display','SELECT')
  AND has_column_privilege('anon','public.developers','logo_url','SELECT')
  AND has_column_privilege('authenticated','public.units','notes','SELECT')
  AND has_column_privilege('anon','public.project_media','sort_order','SELECT')
  AND has_column_privilege('authenticated','public.investment_data','created_at','SELECT'),
  'anon/authenticated retain every public nested-query projection column');
SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon','public.projects','SELECT')
  AND NOT has_table_privilege('authenticated','public.projects','SELECT')
  AND NOT has_table_privilege('anon','public.developers','SELECT')
  AND NOT has_table_privilege('authenticated','public.developers','SELECT')
  AND NOT has_table_privilege('anon','public.units','SELECT')
  AND NOT has_table_privilege('authenticated','public.units','SELECT')
  AND NOT has_table_privilege('anon','public.project_media','SELECT')
  AND NOT has_table_privilege('authenticated','public.project_media','SELECT')
  AND NOT has_table_privilege('anon','public.investment_data','SELECT')
  AND NOT has_table_privilege('authenticated','public.investment_data','SELECT'),
  'public projections execute without table-wide SELECT');
SELECT pg_temp.assert_true(
  NOT has_column_privilege('anon','public.projects','field_provenance','SELECT')
  AND NOT has_column_privilege('authenticated','public.projects','field_provenance','SELECT')
  AND NOT has_column_privilege('anon','public.units','metadata','SELECT')
  AND NOT has_column_privilege('authenticated','public.units','metadata','SELECT')
  AND NOT has_column_privilege('anon','public.project_media','metadata','SELECT')
  AND NOT has_column_privilege('authenticated','public.project_media','metadata','SELECT')
  AND NOT has_column_privilege('anon','public.unit_price_history','source_file','SELECT')
  AND NOT has_column_privilege('authenticated','public.unit_price_history','source_page','SELECT')
  AND NOT has_column_privilege('anon','public.unit_price_history','metadata','SELECT')
  AND NOT has_column_privilege('authenticated','public.developers','contact_name','SELECT')
  AND NOT has_column_privilege('anon','public.developers','contact_phone','SELECT')
  AND NOT has_column_privilege('authenticated','public.developers','contact_email','SELECT'),
  'public roles cannot select provenance, source paths, metadata, or private developer contacts');
SELECT pg_temp.assert_true(
  has_column_privilege('service_role','public.projects','field_provenance','SELECT')
  AND has_column_privilege('service_role','public.units','metadata','SELECT')
  AND has_column_privilege('service_role','public.project_media','metadata','SELECT')
  AND has_column_privilege('service_role','public.unit_price_history','source_file','SELECT')
  AND has_column_privilege('service_role','public.developers','contact_email','SELECT'),
  'service_role retains required private-column access');

CREATE OR REPLACE FUNCTION pg_temp.assert_public_query_contract(expected_role text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  catalogue jsonb;
  detail jsonb;
BEGIN
  PERFORM pg_temp.assert_true(current_user::text = expected_role, 'public query runs as ' || expected_role);

  -- SQL equivalent of ProjectService's exact PostgREST projection. The FK
  -- predicates are what PostgREST generates for the developer and media embeds.
  SELECT to_jsonb(public_catalogue) INTO catalogue
  FROM (
    SELECT
      p.id, p.slug, p.name, p.project_type, p.location_area, p.short_description,
      p.full_description, p.construction_status, p.distance_to_beach, p.distance_to_airport,
      p.main_image_url, p.is_featured, p.is_active, p.created_at, p.sales_status,
      p.starting_price_thb, p.price_range, p.price_per_sqm_display, p.last_price_update,
      p.tagline, p.highlights, p.beds_display, p.area_range, p.nearby_schools,
      p.nearby_hospitals, p.lifestyle, p.start_date_display, p.completion_date_display,
      (SELECT to_jsonb(public_developer) FROM (
        SELECT d.name FROM public.developers d WHERE d.id=p.developer_id
      ) public_developer) AS developer,
      COALESCE((SELECT jsonb_agg(to_jsonb(public_media) ORDER BY public_media.sort_order) FROM (
        SELECT m.media_type, m.url, m.sort_order
        FROM public.project_media m WHERE m.project_id=p.id
      ) public_media), '[]'::jsonb) AS media
    FROM public.projects p
    WHERE p.is_active=true AND p.slug='privacy-published'
    ORDER BY p.is_featured DESC, p.created_at ASC
  ) public_catalogue;

  PERFORM pg_temp.assert_true(
    catalogue->>'slug'='privacy-published'
    AND catalogue#>>'{developer,name}'='Privacy Developer'
    AND jsonb_array_length(catalogue->'media')=1,
    expected_role || ' can execute the exact ProjectService embedded projection');

  -- SQL equivalent of PROJECT_DETAIL_SELECT, including every public scalar and
  -- all four PostgREST relationship predicates under the invoker's real role.
  SELECT to_jsonb(public_detail) INTO detail
  FROM (
    SELECT
      p.id, p.name, p.slug, p.project_type, p.location_area, p.address,
      p.short_description, p.full_description, p.construction_status,
      p.ownership_type, p.distance_to_beach, p.distance_to_airport, p.latitude, p.longitude,
      p.main_image_url, p.brochure_url, p.is_featured, p.is_active, p.sales_status,
      p.starting_price_thb, p.price_range, p.price_per_sqm_display, p.last_price_update,
      p.tagline, p.highlights, p.beds_display, p.area_range, p.nearby_schools,
      p.nearby_hospitals, p.lifestyle, p.developer_name_raw, p.location_name_raw,
      (SELECT to_jsonb(public_developer) FROM (
        SELECT d.id, d.name, d.description, d.website, d.logo_url
        FROM public.developers d WHERE d.id=p.developer_id
      ) public_developer) AS developer,
      COALESCE((SELECT jsonb_agg(to_jsonb(public_media) ORDER BY public_media.sort_order) FROM (
        SELECT m.id, m.media_type, m.title, m.url, m.sort_order
        FROM public.project_media m WHERE m.project_id=p.id
      ) public_media), '[]'::jsonb) AS media,
      COALESCE((SELECT jsonb_agg(to_jsonb(public_unit) ORDER BY public_unit.unit_code) FROM (
        SELECT u.id, u.unit_code, u.unit_type, u.bedrooms, u.bathrooms, u.size_sqm,
          u.floor, u.view_type, u.ownership_type, u.base_price_thb, u.discounted_price_thb,
          u.price_per_sqm, u.availability_status, u.payment_plan, u.furniture_package,
          u.rental_guarantee, u.roi_estimate, u.notes
        FROM public.units u WHERE u.project_id=p.id
      ) public_unit), '[]'::jsonb) AS units,
      COALESCE((SELECT jsonb_agg(to_jsonb(public_investment) ORDER BY public_investment.created_at) FROM (
        SELECT i.id, i.project_id, i.unit_id, i.expected_daily_rate, i.expected_monthly_rent,
          i.expected_yearly_rent, i.occupancy_rate, i.annual_roi_percent,
          i.guaranteed_rental_percent, i.guarantee_years, i.management_company, i.notes, i.created_at
        FROM public.investment_data i WHERE i.project_id=p.id
      ) public_investment), '[]'::jsonb) AS investment
    FROM public.projects p
    WHERE p.is_active=true AND p.slug='privacy-published'
  ) public_detail;

  PERFORM pg_temp.assert_true(
    detail->>'slug'='privacy-published'
    AND detail#>>'{developer,name}'='Privacy Developer'
    AND jsonb_array_length(detail->'media')=1
    AND jsonb_array_length(detail->'units')=1
    AND jsonb_array_length(detail->'investment')=1,
    expected_role || ' can execute PROJECT_DETAIL_SELECT with all four embeds');

  PERFORM pg_temp.assert_true(
    (SELECT count(*) FROM public.projects WHERE slug='privacy-published')=1
    AND (SELECT count(*) FROM public.projects WHERE slug='privacy-draft')=0
    AND (SELECT count(*) FROM public.units WHERE unit_code='P-1')=1
    AND (SELECT count(*) FROM public.units WHERE unit_code='D-1')=0
    AND (SELECT count(*) FROM public.project_media WHERE url='https://cdn.example/privacy.jpg')=1
    AND (SELECT count(*) FROM public.project_media WHERE url='https://cdn.example/draft-private.jpg')=0
    AND (SELECT count(*) FROM public.investment_data WHERE notes='Recorded only')=1
    AND (SELECT count(*) FROM public.investment_data WHERE notes='Draft private')=0,
    expected_role || ' sees published projects and children while draft rows stay hidden by RLS');
END;
$$;

SET ROLE anon;
SELECT pg_temp.assert_public_query_contract('anon');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.assert_public_query_contract('authenticated');
RESET ROLE;

DO $$
DECLARE
  role_name text;
  forbidden_sql text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH forbidden_sql IN ARRAY ARRAY[
      'SELECT field_provenance FROM public.projects',
      'SELECT metadata FROM public.units',
      'SELECT metadata FROM public.project_media',
      'SELECT source_file FROM public.unit_price_history',
      'SELECT source_page FROM public.unit_price_history',
      'SELECT metadata FROM public.unit_price_history',
      'SELECT contact_name,contact_phone,contact_email FROM public.developers'
    ] LOOP
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', role_name);
        EXECUTE forbidden_sql;
        RAISE EXCEPTION 'expected_public_projection_denial_absent: %: %', role_name, forbidden_sql;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
  END LOOP;
END;
$$;

SET ROLE service_role;
SELECT pg_temp.assert_true(
  (SELECT field_provenance->>'source_path' FROM public.projects WHERE slug='privacy-published')
    ='forever-data/projects/coralina/source/private.pdf'
  AND (SELECT metadata->>'private_path' FROM public.units WHERE unit_code='P-1')='units/P-1.pdf'
  AND (SELECT metadata->>'private_path' FROM public.project_media WHERE url='https://cdn.example/privacy.jpg')='media/private.jpg'
  AND (SELECT source_file FROM public.unit_price_history WHERE unit_id='90000000-0000-0000-0000-000000000004')
    ='forever-data/projects/coralina/source/price-list/private.pdf'
  AND (SELECT contact_email FROM public.developers WHERE id='90000000-0000-0000-0000-000000000001')
    ='private-developer@example.com',
  'service_role can execute private-column queries');
RESET ROLE;

-- ===========================================================================
-- LARGE ARCHIVES (FOREVER-STUDIO-LARGE-ARCHIVE-001)
-- Durable inventory tables, claim-checked + ownership-proved slice functions,
-- the DB-enforced lifecycle transition matrix, and cross-job adversarial
-- proofs. Every write below runs against the REAL migration SQL.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- LA-1. Internal-only posture of the archive tables
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE oid IN ('public.studio_archives'::regclass,
                 'public.studio_archive_entries'::regclass)),
  'archive tables have RLS enabled');

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename IN ('studio_archives','studio_archive_entries')),
  'archive tables have zero policies');

SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon','public.studio_archives','SELECT')
  AND NOT has_table_privilege('authenticated','public.studio_archives','SELECT')
  AND NOT has_table_privilege('anon','public.studio_archive_entries','SELECT')
  AND NOT has_table_privilege('authenticated','public.studio_archive_entries','SELECT')
  AND has_table_privilege('service_role','public.studio_archives','INSERT')
  AND has_table_privilege('service_role','public.studio_archive_entries','INSERT'),
  'archive tables are service-role only');

SELECT pg_temp.assert_true(
  has_function_privilege('service_role','public.studio_release_job(uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.studio_update_archive_claimed(uuid,uuid,uuid,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.studio_index_archive_entries(uuid,uuid,uuid,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.studio_settle_archive_entry(uuid,uuid,uuid,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.studio_job_archive_entry_counts(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.studio_release_job(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.studio_settle_archive_entry(uuid,uuid,uuid,jsonb)','EXECUTE'),
  'archive slice functions are service-role only');

-- ---------------------------------------------------------------------------
-- LA-2. Schema constraints: manifest identity, initial status, legacy states
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)
VALUES ('60000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001','owner','new_development','received');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_request_job_processing(
     '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',900))=1,
  'archive test job is claimed by its worker token');

-- The archive is planned with its COMPLETE per-part manifest bound up front.
INSERT INTO public.studio_archives(
  id,job_id,ordinal,file_name,manifest_sha256,declared_size,part_size,part_count,status,parts)
VALUES ('61000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000001',0,'dossier.zip',
        repeat('a',64),16777216,8388608,2,'planned',
        ('[{"index":0,"size":null,"declaredSha256":"' || repeat('d',64)
         || '","sha256":null,"verified":false},'
         || '{"index":1,"size":null,"declaredSha256":"' || repeat('e',64)
         || '","sha256":null,"verified":false}]')::jsonb);

DO $$
BEGIN
  -- Malformed manifest identity is rejected by the column CHECK.
  BEGIN
    INSERT INTO public.studio_archives(
      id,job_id,ordinal,file_name,manifest_sha256,declared_size,part_size,part_count,status)
    VALUES ('61000000-0000-0000-0000-00000000000f',
            '60000000-0000-0000-0000-000000000001',1,'badmanifest.zip',
            'not-a-digest',16777216,8388608,2,'planned');
    RAISE EXCEPTION 'expected_bad_manifest_rejection_absent';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A retired ambiguous status value is rejected (the lifecycle guard fires
  -- before the CHECK constraint; both layers forbid it).
  BEGIN
    INSERT INTO public.studio_archives(
      id,job_id,ordinal,file_name,manifest_sha256,declared_size,part_size,part_count,status)
    VALUES ('61000000-0000-0000-0000-00000000000e',
            '60000000-0000-0000-0000-000000000001',1,'legacy.zip',
            repeat('b',64),16777216,8388608,2,'uploaded');
    RAISE EXCEPTION 'expected_legacy_status_rejection_absent';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'studio_archive_invalid_initial_status%' THEN RAISE; END IF;
  END;
  -- The lifecycle guard forbids inserting an archive past 'planned'.
  BEGIN
    INSERT INTO public.studio_archives(
      id,job_id,ordinal,file_name,manifest_sha256,declared_size,part_size,part_count,status)
    VALUES ('61000000-0000-0000-0000-00000000000d',
            '60000000-0000-0000-0000-000000000001',1,'skipstart.zip',
            repeat('c',64),16777216,8388608,2,'byte_verified');
    RAISE EXCEPTION 'expected_initial_status_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'studio_archive_invalid_initial_status%' THEN RAISE; END IF;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- LA-3. Lifecycle walk under the live claim — every valid transition, with
--       the trigger demanding real state evidence at each gate
-- ---------------------------------------------------------------------------
-- A stale token can neither index nor patch (unchanged contract).
SELECT pg_temp.assert_true(
  NOT public.studio_index_archive_entries(
    '60000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-00000000000d',
    '61000000-0000-0000-0000-000000000001',
    '[{"entry_index":0,"entry_name":"photos/a.jpg","display_label":"entry 1 (photo)","category":"photo","compressed_size":10,"uncompressed_size":10}]'::jsonb),
  'a stale token cannot insert inventory');
SELECT pg_temp.assert_true(
  NOT public.studio_update_archive_claimed(
    '60000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-00000000000d',
    '61000000-0000-0000-0000-000000000001','{"status":"rejected"}'::jsonb),
  'a stale token cannot patch archive state');

-- planned -> uploaded_unverified (storage acceptance evidence: sizes).
SELECT pg_temp.assert_true(
  public.studio_update_archive_claimed(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    '61000000-0000-0000-0000-000000000001',
    ('{"status":"uploaded_unverified","observed_size":16777216,'
     || '"parts":[{"index":0,"size":8388608,"declaredSha256":"' || repeat('d',64)
     || '","sha256":null,"verified":false},'
     || '{"index":1,"size":8388608,"declaredSha256":"' || repeat('e',64)
     || '","sha256":null,"verified":false}]}')::jsonb),
  'planned -> uploaded_unverified is a valid transition');

-- Skipping straight to byte_verified is forbidden by the matrix.
DO $$
BEGIN
  BEGIN
    PERFORM public.studio_update_archive_claimed(
      '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
      '61000000-0000-0000-0000-000000000001','{"status":"byte_verified"}'::jsonb);
    RAISE EXCEPTION 'expected_skip_transition_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'studio_archive_invalid_transition%' THEN RAISE; END IF;
  END;
END;
$$;
SELECT pg_temp.assert_true(
  (SELECT status='uploaded_unverified' FROM public.studio_archives
   WHERE id='61000000-0000-0000-0000-000000000001'),
  'a forbidden transition changed nothing');

-- uploaded_unverified -> byte_verifying.
SELECT pg_temp.assert_true(
  public.studio_update_archive_claimed(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    '61000000-0000-0000-0000-000000000001','{"status":"byte_verifying"}'::jsonb),
  'uploaded_unverified -> byte_verifying is a valid transition');

DO $$
BEGIN
  -- byte_verified with ONE unverified part is refused.
  BEGIN
    PERFORM public.studio_update_archive_claimed(
      '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
      '61000000-0000-0000-0000-000000000001',
      ('{"status":"byte_verified","archive_sha256":"' || repeat('9',64) || '",'
       || '"parts":[{"index":0,"size":8388608,"declaredSha256":"' || repeat('d',64)
       || '","sha256":"' || repeat('1',64) || '","verified":true},'
       || '{"index":1,"size":8388608,"declaredSha256":"' || repeat('e',64)
       || '","sha256":null,"verified":false}]}')::jsonb);
    RAISE EXCEPTION 'expected_partial_evidence_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'studio_archive_byte_verification_evidence_missing%' THEN RAISE; END IF;
  END;
  -- byte_verified without the exact archive SHA-256 is refused.
  BEGIN
    PERFORM public.studio_update_archive_claimed(
      '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
      '61000000-0000-0000-0000-000000000001',
      ('{"status":"byte_verified",'
       || '"parts":[{"index":0,"size":8388608,"declaredSha256":"' || repeat('d',64)
       || '","sha256":"' || repeat('1',64) || '","verified":true},'
       || '{"index":1,"size":8388608,"declaredSha256":"' || repeat('e',64)
       || '","sha256":"' || repeat('2',64) || '","verified":true}]}')::jsonb);
    RAISE EXCEPTION 'expected_missing_archive_sha_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'studio_archive_byte_verification_evidence_missing%' THEN RAISE; END IF;
  END;
END;
$$;

-- byte_verifying -> byte_verified with COMPLETE evidence.
SELECT pg_temp.assert_true(
  public.studio_update_archive_claimed(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    '61000000-0000-0000-0000-000000000001',
    ('{"status":"byte_verified","archive_sha256":"' || repeat('9',64)
     || '","composite_sha256":"' || repeat('8',64) || '",'
     || '"parts":[{"index":0,"size":8388608,"declaredSha256":"' || repeat('d',64)
     || '","sha256":"' || repeat('1',64) || '","verified":true},'
     || '{"index":1,"size":8388608,"declaredSha256":"' || repeat('e',64)
     || '","sha256":"' || repeat('2',64) || '","verified":true}]}')::jsonb),
  'byte_verifying -> byte_verified succeeds with complete part evidence');
SELECT pg_temp.assert_true(
  (SELECT status='byte_verified' AND archive_sha256=repeat('9',64)
      AND composite_sha256=repeat('8',64)
   FROM public.studio_archives WHERE id='61000000-0000-0000-0000-000000000001'),
  'the byte-verified evidence (including the exact archive SHA-256) is durable');

-- The claim holder inserts the inventory; a re-run fills nothing twice.
SELECT pg_temp.assert_true(
  public.studio_index_archive_entries(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    '61000000-0000-0000-0000-000000000001',
    '[{"entry_index":0,"entry_name":"photos/a.jpg","display_label":"entry 1 (photo)","category":"photo","compressed_size":10,"uncompressed_size":10},
      {"entry_index":1,"entry_name":"video/b.mp4","display_label":"entry 2 (video)","category":"video","compressed_size":20,"uncompressed_size":20}]'::jsonb),
  'the claim holder inserts the inventory');
SELECT pg_temp.assert_true(
  public.studio_index_archive_entries(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    '61000000-0000-0000-0000-000000000001',
    '[{"entry_index":0,"entry_name":"photos/a.jpg","display_label":"entry 1 (photo)","category":"photo","compressed_size":10,"uncompressed_size":10}]'::jsonb)
  AND (SELECT count(*) FROM public.studio_archive_entries
       WHERE archive_id='61000000-0000-0000-0000-000000000001')=2,
  're-indexing is idempotent (conflict-skip, no duplicates)');

-- processing_entries with a WRONG entry_count is refused by the trigger.
DO $$
BEGIN
  BEGIN
    PERFORM public.studio_update_archive_claimed(
      '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
      '61000000-0000-0000-0000-000000000001',
      '{"status":"processing_entries","entry_count":1,"total_uncompressed":30}'::jsonb);
    RAISE EXCEPTION 'expected_inventory_mismatch_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'studio_archive_inventory_incomplete%' THEN RAISE; END IF;
  END;
END;
$$;

-- byte_verified -> processing_entries with the true inventory numbers.
SELECT pg_temp.assert_true(
  public.studio_update_archive_claimed(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    '61000000-0000-0000-0000-000000000001',
    '{"status":"processing_entries","entry_count":2,"total_uncompressed":30}'::jsonb),
  'byte_verified -> processing_entries succeeds with the durable inventory');

-- ---------------------------------------------------------------------------
-- LA-4. Cross-job archive ownership — a VALID claim on job B can touch
--       nothing that belongs to job A
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)
VALUES ('60000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001','owner','new_development','received');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_request_job_processing(
     '60000000-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-0000000000b2',900))=1,
  'job B is claimed by its own worker token');

-- Job B cannot index entries into job A's archive (FALSE, zero rows).
SELECT pg_temp.assert_true(
  NOT public.studio_index_archive_entries(
    '60000000-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-0000000000b2',
    '61000000-0000-0000-0000-000000000001',
    '[{"entry_index":7,"entry_name":"stolen.bin","display_label":"entry 8 (document)","category":"document","compressed_size":1,"uncompressed_size":1}]'::jsonb),
  'job B cannot index entries into job A''s archive');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_archive_entries
   WHERE archive_id='61000000-0000-0000-0000-000000000001')=2,
  'the cross-job index attempt inserted nothing');

-- Job B cannot patch job A's archive state.
SELECT pg_temp.assert_true(
  NOT public.studio_update_archive_claimed(
    '60000000-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-0000000000b2',
    '61000000-0000-0000-0000-000000000001','{"status":"rejected"}'::jsonb)
  AND (SELECT status='processing_entries' FROM public.studio_archives
       WHERE id='61000000-0000-0000-0000-000000000001'),
  'job B cannot patch job A''s archive');

-- Job B cannot settle job A's entries.
SELECT pg_temp.assert_true(
  NOT public.studio_settle_archive_entry(
    '60000000-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-0000000000b2',
    (SELECT id FROM public.studio_archive_entries WHERE entry_index=0
      AND archive_id='61000000-0000-0000-0000-000000000001'),
    '{"state":"failed","outcomeCode":"stolen","attempt":"b2","processedAt":"2026-07-24T00:00:00Z"}'::jsonb)
  AND (SELECT state='pending' FROM public.studio_archive_entries WHERE entry_index=0
       AND archive_id='61000000-0000-0000-0000-000000000001'),
  'job B cannot settle job A''s entries');

-- The composite FK rejects a cross-job (archive_id, job_id) pair outright.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.studio_archive_entries(
      archive_id,job_id,entry_index,entry_name,display_label,category,
      compressed_size,uncompressed_size)
    VALUES ('61000000-0000-0000-0000-000000000001',
            '60000000-0000-0000-0000-000000000002',
            50,'forged.bin','entry 51 (document)','document',1,1);
    RAISE EXCEPTION 'expected_cross_job_fk_rejection_absent';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

-- The TRUE (archive_id, job_id) pair remains representable.
INSERT INTO public.studio_archive_entries(
  id,archive_id,job_id,entry_index,entry_name,display_label,category,
  compressed_size,uncompressed_size)
VALUES ('62000000-0000-0000-0000-0000000000aa',
        '61000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000001',
        60,'legit.bin','entry 61 (document)','document',1,1);
DELETE FROM public.studio_archive_entries
WHERE id='62000000-0000-0000-0000-0000000000aa';

-- ---------------------------------------------------------------------------
-- LA-5. Pending-only, claim-checked settlement (settled outcomes immutable)
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  NOT public.studio_settle_archive_entry(
    '60000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-00000000000d',
    (SELECT id FROM public.studio_archive_entries WHERE entry_index=0
      AND archive_id='61000000-0000-0000-0000-000000000001'),
    '{"state":"published_public","outcomeCode":null,"attempt":"stale","processedAt":"2026-07-24T00:00:00Z"}'::jsonb),
  'a stale token cannot settle an entry');

SELECT pg_temp.assert_true(
  public.studio_settle_archive_entry(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    (SELECT id FROM public.studio_archive_entries WHERE entry_index=0
      AND archive_id='61000000-0000-0000-0000-000000000001'),
    '{"state":"published_public","outcomeCode":null,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observedSize":10,"publicBucket":"project-images","publicPath":"studio/x/att/00-a.jpg","publicUrl":"https://cdn/x.jpg","mediaType":"gallery","attempt":"cccccccc0000","processedAt":"2026-07-24T00:00:00Z"}'::jsonb),
  'the claim holder settles a pending entry');

-- completed with a pending entry left is refused by the trigger.
DO $$
BEGIN
  BEGIN
    PERFORM public.studio_update_archive_claimed(
      '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
      '61000000-0000-0000-0000-000000000001','{"status":"completed"}'::jsonb);
    RAISE EXCEPTION 'expected_pending_completion_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'studio_archive_completed_with_pending_entries%' THEN RAISE; END IF;
  END;
END;
$$;

-- The private evidence manifest persists durably on a retained settlement.
SELECT pg_temp.assert_true(
  public.studio_settle_archive_entry(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    (SELECT id FROM public.studio_archive_entries WHERE entry_index=1
      AND archive_id='61000000-0000-0000-0000-000000000001'),
    ('{"state":"retained_private","outcomeCode":"entry_over_size_limit",'
     || '"sha256":"' || repeat('b',64) || '","observedSize":20,'
     || '"evidence":{"bucket":"studio-uploads","prefix":"jobs/j/evidence/a/00001",'
     || '"partSize":8388608,"partCount":1,'
     || '"parts":[{"index":0,"size":20,"sha256":"' || repeat('c',64) || '"}],'
     || '"totalSize":20,"crc32Verified":true},'
     || '"attempt":"cccccccc0000","processedAt":"2026-07-24T00:00:00Z"}')::jsonb),
  'the claim holder settles a retained entry with its evidence manifest');
SELECT pg_temp.assert_true(
  (SELECT evidence->>'prefix'='jobs/j/evidence/a/00001'
      AND (evidence->>'partCount')::int=1
      AND (evidence->'parts'->0->>'sha256')=repeat('c',64)
      AND (evidence->>'crc32Verified')::boolean
   FROM public.studio_archive_entries WHERE entry_index=1
     AND archive_id='61000000-0000-0000-0000-000000000001'),
  'the evidence manifest is durable and structured');

SELECT pg_temp.assert_true(
  NOT public.studio_settle_archive_entry(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    (SELECT id FROM public.studio_archive_entries WHERE entry_index=0
      AND archive_id='61000000-0000-0000-0000-000000000001'),
    '{"state":"failed","outcomeCode":"rewrite","attempt":"late","processedAt":"2026-07-24T00:00:01Z"}'::jsonb),
  'a settled entry never re-settles, even under the live claim');
SELECT pg_temp.assert_true(
  (SELECT state FROM public.studio_archive_entries WHERE entry_index=0
    AND archive_id='61000000-0000-0000-0000-000000000001')='published_public',
  'the settled outcome remains immutable');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_job_archive_entry_counts(
     '60000000-0000-0000-0000-000000000001'))=2,
  'entry counts aggregate by state');

-- With every entry settled, processing_entries -> completed succeeds …
SELECT pg_temp.assert_true(
  public.studio_update_archive_claimed(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    '61000000-0000-0000-0000-000000000001','{"status":"completed"}'::jsonb),
  'processing_entries -> completed succeeds once every entry settled');

-- … and completed is TERMINAL: no regression, not even to rejected.
DO $$
DECLARE v_target TEXT;
BEGIN
  FOREACH v_target IN ARRAY ARRAY['processing_entries','byte_verified','rejected'] LOOP
    BEGIN
      PERFORM public.studio_update_archive_claimed(
        '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
        '61000000-0000-0000-0000-000000000001',
        jsonb_build_object('status', v_target));
      RAISE EXCEPTION 'expected_completed_regression_rejection_absent: %', v_target;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'studio_archive_invalid_transition%' THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;

-- The archive identity is immutable even for direct service-role SQL.
DO $$
BEGIN
  BEGIN
    UPDATE public.studio_archives SET declared_size = declared_size + 1
    WHERE id='61000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'expected_identity_mutation_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'studio_archive_identity_immutable%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.studio_archives SET manifest_sha256 = repeat('f',64)
    WHERE id='61000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'expected_manifest_mutation_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'studio_archive_identity_immutable%' THEN RAISE; END IF;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- LA-6. Rejection lane and terminal 'rejected' on a second archive
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_archives(
  id,job_id,ordinal,file_name,manifest_sha256,declared_size,part_size,part_count,status)
VALUES ('61000000-0000-0000-0000-000000000002',
        '60000000-0000-0000-0000-000000000001',1,'reject-lane.zip',
        repeat('b',64),8388608,8388608,1,'planned');

-- planned -> rejected is legal (e.g. incomplete upload at processing time).
SELECT pg_temp.assert_true(
  public.studio_update_archive_claimed(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
    '61000000-0000-0000-0000-000000000002',
    '{"status":"rejected","error_code":"archive_upload_incomplete"}'::jsonb),
  'planned -> rejected is a valid transition');

-- rejected is TERMINAL.
DO $$
DECLARE v_target TEXT;
BEGIN
  FOREACH v_target IN ARRAY ARRAY['planned','uploaded_unverified','byte_verifying',
                                  'byte_verified','processing_entries','completed'] LOOP
    BEGIN
      PERFORM public.studio_update_archive_claimed(
        '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
        '61000000-0000-0000-0000-000000000002',
        jsonb_build_object('status', v_target));
      RAISE EXCEPTION 'expected_rejected_regression_rejection_absent: %', v_target;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'studio_archive_invalid_transition%' THEN RAISE; END IF;
    END;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- LA-7. Malformed JSON patches and outcomes fail safely, changing nothing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before JSONB;
  v_patch JSONB;
BEGIN
  SELECT to_jsonb(a) INTO v_before FROM public.studio_archives a
  WHERE id='61000000-0000-0000-0000-000000000002';

  FOREACH v_patch IN ARRAY ARRAY[
    '{"status":"bogus_state"}'::jsonb,
    '{"status":42}'::jsonb,
    '{"observed_size":"16777216"}'::jsonb,
    '{"observed_size":1.5}'::jsonb,
    '{"entry_count":"2"}'::jsonb,
    '{"total_uncompressed":true}'::jsonb,
    '{"parts":{"index":0}}'::jsonb,
    '{"archive_sha256":"nothex"}'::jsonb,
    '{"composite_sha256":123}'::jsonb,
    '{"extracted":[1,2]}'::jsonb,
    '{"error_code":7}'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.studio_update_archive_claimed(
        '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
        '61000000-0000-0000-0000-000000000002', v_patch);
      RAISE EXCEPTION 'expected_malformed_patch_rejection_absent: %', v_patch::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'studio_archive_patch_invalid%' THEN RAISE; END IF;
    END;
  END LOOP;

  IF (SELECT to_jsonb(a) FROM public.studio_archives a
      WHERE id='61000000-0000-0000-0000-000000000002') IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'studio_pg_test_failed: malformed patches mutated archive state';
  END IF;

  -- Malformed settlement outcomes are refused before any write.
  FOREACH v_patch IN ARRAY ARRAY[
    '{"state":"pending","attempt":"x","processedAt":"2026-07-24T00:00:00Z"}'::jsonb,
    '{"state":"exploded","attempt":"x","processedAt":"2026-07-24T00:00:00Z"}'::jsonb,
    '{"state":"failed","sha256":"nothex","attempt":"x","processedAt":"2026-07-24T00:00:00Z"}'::jsonb,
    '{"state":"failed","observedSize":"20","attempt":"x","processedAt":"2026-07-24T00:00:00Z"}'::jsonb,
    '{"state":"failed","processedAt":"not-a-time","attempt":"x"}'::jsonb,
    '{"state":"failed","evidence":"not-an-object","attempt":"x","processedAt":"2026-07-24T00:00:00Z"}'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.studio_settle_archive_entry(
        '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
        (SELECT id FROM public.studio_archive_entries WHERE entry_index=0
          AND archive_id='61000000-0000-0000-0000-000000000001'),
        v_patch);
      RAISE EXCEPTION 'expected_malformed_outcome_rejection_absent: %', v_patch::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'studio_archive_outcome_invalid%' THEN RAISE; END IF;
    END;
  END LOOP;

  -- A malformed inventory payload is refused before any insert.
  BEGIN
    PERFORM public.studio_index_archive_entries(
      '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c',
      '61000000-0000-0000-0000-000000000001',
      '[{"entry_index":"zero","entry_name":"x","display_label":"x","category":"photo","compressed_size":1,"uncompressed_size":1}]'::jsonb);
    RAISE EXCEPTION 'expected_malformed_entries_rejection_absent';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'studio_archive_entries_invalid%' THEN RAISE; END IF;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- LA-8. Slice release: prompt continuation without the stale window
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  NOT public.studio_release_job(
    '60000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-00000000000d'),
  'a stale token cannot release the job');
SELECT pg_temp.assert_true(
  public.studio_release_job(
    '60000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c'),
  'the claim holder releases the slice');
SELECT pg_temp.assert_true(
  (SELECT status='received' AND processing_token IS NULL AND processing_requested_at IS NOT NULL
   FROM public.studio_upload_jobs WHERE id='60000000-0000-0000-0000-000000000001'),
  'release restores received with readiness preserved');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_claim_job(
     '60000000-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-00000000000e',900))=1,
  'a released job is immediately claimable by the next poll');

-- ---------------------------------------------------------------------------
-- LA-9. Job deletion cascades the durable inventory
-- ---------------------------------------------------------------------------
DELETE FROM public.studio_upload_jobs
WHERE id IN ('60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002');
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_archives
    WHERE job_id='60000000-0000-0000-0000-000000000001')=0
  AND (SELECT count(*) FROM public.studio_archive_entries
    WHERE job_id='60000000-0000-0000-0000-000000000001')=0,
  'deleting a job cascades its archives and entries');

SELECT 'ALL STUDIO POSTGRES ASSERTIONS PASSED' AS result;
