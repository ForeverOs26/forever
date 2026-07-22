-- FOREVER-STUDIO-005: durable resume eligibility independent of history and
-- invalid-source starvation.
--
-- These read-only, service-role-only functions apply actor scope and current
-- active source membership inside PostgreSQL before COUNT/LIMIT. Dashboard
-- history remains bounded independently, and disabled/deleted sources never
-- consume an automatic-resume batch slot.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_studio_upload_jobs_resume_eligibility
  ON public.studio_upload_jobs (created_at ASC, id ASC, created_by)
  WHERE processing_requested_at IS NOT NULL
    AND (
      status IN ('received', 'processing')
      OR (status = 'failed' AND retryable IS TRUE)
    );

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
    AND (
      job.status IN ('received', 'processing')
      OR (job.status = 'failed' AND job.retryable IS TRUE)
    );
$$;

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

REVOKE ALL ON FUNCTION public.studio_count_active_jobs(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_count_active_jobs(UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.studio_list_due_jobs(TIMESTAMPTZ, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_list_due_jobs(TIMESTAMPTZ, INTEGER, UUID)
  TO service_role;

COMMIT;
