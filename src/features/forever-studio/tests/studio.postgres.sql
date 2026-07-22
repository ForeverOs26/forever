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
  AND NOT has_function_privilege('anon','public.studio_publish_project(uuid,uuid,jsonb,boolean,jsonb)','EXECUTE'),
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
     '10000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a',900))=1,
  'first claim wins');
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
-- 5. Atomic publish rollback: a failure leaves no project, child, or batch
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)
VALUES ('10000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001','owner','new_development','received');
SELECT public.studio_claim_job(
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
SELECT public.studio_claim_job(
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
-- 7. Resale: atomic + idempotent + private contact
-- ---------------------------------------------------------------------------
INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)
VALUES ('10000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000001','owner','resale_listing','received');
SELECT public.studio_claim_job(
  '10000000-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-00000000000e',900);
SELECT public.studio_publish_resale(
  '10000000-0000-0000-0000-000000000004',
  'eeeeeeee-0000-0000-0000-00000000000e',
  jsonb_build_object('title','Resale One','slug','resale-one-abc',
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
  (SELECT created_by='00000000-0000-0000-0000-000000000001'::uuid
   FROM public.studio_object_owners o JOIN public.listings l ON l.id=o.object_id
   WHERE o.object_type='listing' AND l.slug='resale-one-abc'),
  'listing ownership attribution is private and immutable');

-- replay: no duplicate listing
SELECT public.studio_publish_resale(
  '10000000-0000-0000-0000-000000000004',
  'eeeeeeee-0000-0000-0000-00000000000e',
  jsonb_build_object('title','Resale One','slug','resale-one-abc',
    'photos',jsonb_build_array('https://cdn.test/project-images/x.jpg'),
    'availability_status','available','field_provenance','{}'::jsonb),
  jsonb_build_object('contact_name','Jane','contact_phone','+66 1','contact_email','jane@example.com'),
  '[]'::jsonb, '{}'::jsonb);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.listings WHERE slug='resale-one-abc')=1,
  'resale replay creates no duplicate listing');

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
        '000000ff-0000-0000-0000-0000000000ff','tempuser@example.com','trusted_publisher','resale_listing','published');
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

SELECT 'ALL STUDIO POSTGRES ASSERTIONS PASSED' AS result;
