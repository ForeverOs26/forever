-- FOREVER-PR134-AUTOMATIC-RETRY-SURFACING-FIX-001: automatically exhausted jobs
-- stop being offered to the automatic lane, before ORDER BY / LIMIT / COUNT.
--
-- WHY THIS CANNOT BE FIXED IN THE CALLERS
-- ---------------------------------------
-- The bounded automatic-retry policy stops the SCHEDULER from processing a job
-- whose automatic budget is spent, but the database still OFFERS that job:
-- studio_list_due_jobs returns it and studio_count_active_jobs counts it.
--
-- studio_list_due_jobs owns its own ORDER BY created_at ASC and LIMIT (default
-- five). An application-side filter necessarily runs AFTER that LIMIT, so five
-- old exhausted rows occupy all five returned slots and every genuinely
-- eligible job behind them starves — permanently, because the exhausted rows
-- never change and never leave the front of the ordering. Filtering later
-- cannot recover a row the database never returned.
--
-- studio_count_active_jobs has the same problem in a different shape: it is the
-- single number the dashboard uses to decide whether to poll every five
-- seconds, whether to call automatic resume, and whether to tell the Owner
-- "Processing N uploads… this continues automatically even if you close the
-- page." For a job nothing will ever pick up, all three are false.
--
-- This is the same class of defect FOREVER-STUDIO-005 fixed for disabled and
-- deleted sources, and it is fixed the same way: the predicate moves inside
-- PostgreSQL, ahead of COUNT and LIMIT.
--
-- WHAT IS DELIBERATELY NOT IN THE PREDICATE
-- -----------------------------------------
-- No threshold. The database does not ask "have there been five failures"; it
-- asks "did the application record this job as exhausted". A numeric limit here
-- would be a second copy of a constant that lives in retry-policy.ts, and the
-- two would drift the first time anyone tuned it. The decision is made once,
-- where the failure is recorded; this reads the answer.
--
-- EXHAUSTED IS NOT TERMINAL
-- -------------------------
-- `retryable` is untouched and keeps its existing meaning: it is the admission
-- predicate studio_claim_job applies to BOTH lanes, so an exhausted job with
-- retryable = true remains claimable by an explicit Owner-controlled retry.
-- Three distinct states, none collapsed:
--
--   retryable = true,  automatic <> 'exhausted'  -> automatic lane may run it
--   retryable = true,  automatic  = 'exhausted'  -> only a person may run it
--   retryable = false                            -> neither, until repaired
--
-- SCOPE
-- -----
-- Additive and idempotent. No table, column, index, RLS policy, grant widening,
-- membership, Auth, publication or storage semantics is created or altered, and
-- no row is read, written or backfilled. Both replaced functions keep their
-- exact signature, return type, language, volatility, SET search_path and
-- SECURITY INVOKER status, and their existing REVOKE/GRANT set is re-asserted
-- verbatim rather than assumed.
--
-- The existing partial index idx_studio_upload_jobs_resume_eligibility stays
-- valid: its predicate is now a strict SUPERSET of the query's, which PostgreSQL
-- may still use and then filter. No index is created here, because an exhausted
-- job is a rare tail state and a second partial index would cost every write.
BEGIN;

-- The one place the automatic-retry state is interpreted in SQL.
--
-- Extracted so studio_list_due_jobs and studio_count_active_jobs cannot express
-- the question two subtly different ways: "due" and "counted" must mean the
-- same thing or the dashboard polls for work the scheduler will not do.
--
-- Total and never NULL. `facts` is NOT NULL DEFAULT '{}', but `facts->'retry'`
-- and `->>'automatic'` are absent on every job that has never failed
-- automatically — which is every job that exists today — so the COALESCE is
-- what keeps those rows eligible instead of filtering them out on a NULL
-- comparison. Any value that is not exactly 'exhausted' is eligible, matching
-- `automaticRetryState` in retry-policy.ts exactly.
CREATE OR REPLACE FUNCTION public.studio_job_automatic_retry_exhausted(
  p_facts JSONB
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_facts -> 'retry' ->> 'automatic', 'eligible') = 'exhausted';
$$;

-- Active automatic work only.
--
-- This number is the dashboard's entire basis for polling, for calling
-- automatic resume, and for the "continues automatically" banner. A job the
-- automatic lane has given up on is none of those things in any status, so the
-- exclusion is unconditional rather than attached to one status branch: the
-- field means "jobs the dashboard is auto-resuming", and an exhausted job is
-- not being auto-resumed whatever it is currently doing.
CREATE OR REPLACE FUNCTION public.studio_count_active_jobs(
  p_created_by UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.studio_upload_jobs AS job
  INNER JOIN public.studio_members AS source
    ON source.user_id = job.created_by
   AND source.is_active IS TRUE
  WHERE (p_created_by IS NULL OR job.created_by = p_created_by)
    AND job.processing_requested_at IS NOT NULL
    AND NOT public.studio_job_automatic_retry_exhausted(job.facts)
    AND (
      job.status IN ('received', 'processing')
      OR (job.status = 'failed' AND job.retryable IS TRUE)
    );
$$;

-- Due jobs for automatic continuation.
--
-- The exclusion sits in the WHERE clause, so it is applied before ORDER BY and
-- before LIMIT by definition — five exhausted rows at the front of the
-- created_at ordering can no longer consume the batch, and the sixth genuinely
-- eligible job is returned.
CREATE OR REPLACE FUNCTION public.studio_list_due_jobs(
  p_stale_before TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 5,
  p_created_by UUID DEFAULT NULL
) RETURNS SETOF public.studio_upload_jobs
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT job.*
  FROM public.studio_upload_jobs AS job
  INNER JOIN public.studio_members AS source
    ON source.user_id = job.created_by
   AND source.is_active IS TRUE
  WHERE (p_created_by IS NULL OR job.created_by = p_created_by)
    AND job.processing_requested_at IS NOT NULL
    AND NOT public.studio_job_automatic_retry_exhausted(job.facts)
    AND (
      job.status = 'received'
      OR (job.status = 'failed' AND job.retryable IS TRUE)
      OR (
        job.status = 'processing'
        AND (job.processing_started_at IS NULL OR job.processing_started_at < p_stale_before)
      )
    )
  ORDER BY job.created_at ASC, job.id ASC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 5), 100), 0);
$$;

-- Same service-role-only posture as every other Studio RPC, re-asserted rather
-- than assumed: the helper is new, and CREATE OR REPLACE on the other two must
-- not be read as evidence that their grants were reviewed.
REVOKE ALL ON FUNCTION public.studio_job_automatic_retry_exhausted(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_job_automatic_retry_exhausted(JSONB)
  TO service_role;
REVOKE ALL ON FUNCTION public.studio_count_active_jobs(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_count_active_jobs(UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.studio_list_due_jobs(TIMESTAMPTZ, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_list_due_jobs(TIMESTAMPTZ, INTEGER, UUID)
  TO service_role;

COMMIT;
