-- FOREVER-STUDIO-004: authorize job claims from current active membership.
--
-- job.creator_role is an immutable source-provenance snapshot only. Job
-- processing authorization always comes from the creator's current active
-- studio_members row, before a claim can mutate the job or permit storage work.
BEGIN;

CREATE OR REPLACE FUNCTION public.studio_claim_job(
  p_job_id UUID,
  p_token UUID,
  p_stale_seconds INTEGER DEFAULT 900
) RETURNS SETOF public.studio_upload_jobs
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_created_by UUID;
BEGIN
  SELECT created_by INTO v_created_by
  FROM public.studio_upload_jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM 1
  FROM public.studio_members
  WHERE user_id = v_created_by AND is_active
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'studio_membership_required';
  END IF;

  RETURN QUERY
    UPDATE public.studio_upload_jobs
    SET status = 'processing',
        processing_token = p_token,
        processing_started_at = now(),
        attempt_count = attempt_count + 1,
        error = NULL,
        error_code = NULL,
        updated_at = now()
    WHERE id = p_job_id
      AND processing_requested_at IS NOT NULL
      AND status <> 'published'
      AND (
        status = 'received'
        OR (status = 'failed' AND retryable IS TRUE)
        OR (status = 'processing'
            AND (processing_started_at IS NULL
                 OR processing_started_at < now() - make_interval(secs => p_stale_seconds)))
      )
    RETURNING *;
END;
$$;

-- Readiness and the authorized first claim remain one transaction. If current
-- membership is missing or disabled, studio_claim_job raises and this marker
-- update rolls back with it.
CREATE OR REPLACE FUNCTION public.studio_request_job_processing(
  p_job_id UUID,
  p_token UUID,
  p_stale_seconds INTEGER DEFAULT 900
) RETURNS SETOF public.studio_upload_jobs
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.studio_upload_jobs
  SET processing_requested_at = COALESCE(processing_requested_at, now()),
      updated_at = now()
  WHERE id = p_job_id
    AND status <> 'published';

  RETURN QUERY
    SELECT * FROM public.studio_claim_job(p_job_id, p_token, p_stale_seconds);
END;
$$;

REVOKE ALL ON FUNCTION public.studio_claim_job(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_claim_job(UUID, UUID, INTEGER)
  TO service_role;
REVOKE ALL ON FUNCTION public.studio_request_job_processing(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_request_job_processing(UUID, UUID, INTEGER)
  TO service_role;

COMMIT;
