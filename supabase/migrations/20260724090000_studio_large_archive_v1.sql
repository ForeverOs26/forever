-- ============================================================================
-- FOREVER-STUDIO-LARGE-ARCHIVE-001 — durable large-archive intake (v1)
--
-- MIGRATION DRAFT (pending; not applied here). PURELY ADDITIVE: two new
-- internal tables and five new service-role-only functions, layered after the
-- pending Studio chain (20260721120000..20260723130000). It has NOT been
-- applied by this task; it is exercised end-to-end by the disposable
-- PostgreSQL test harness only. Nothing existing is altered, dropped,
-- re-applied, or re-scheduled. Never re-apply any earlier migration.
--
-- Purpose. Studio's synchronous 16 MiB ZIP path buffers a whole archive in
-- one request. This migration adds the durable state a 300 MiB chunked-upload
-- archive needs instead:
--   * studio_archives         — one row per uploaded ZIP: the server-verified
--                               part manifest (sizes + SHA-256 per part),
--                               lifecycle status, and adopted structured
--                               artifacts (price list / facts) so a later
--                               slice finalizes from durable state.
--   * studio_archive_entries  — one row per archive entry: the durable
--                               entry-level inventory (identity, sizes,
--                               verified SHA-256, byte class, routing outcome,
--                               public derivative location, private evidence).
--                               Completion is derived from these rows, never
--                               from an in-memory loop.
--
-- Concurrency contract (same one-winner model as studio_upload_jobs):
--   * Every processing-phase write is guarded by the JOB's live processing
--     claim (status = 'processing' AND processing_token matches) inside one
--     transaction, so a stale worker can never overwrite a newer claim's
--     archive state, entry outcomes, or inventory.
--   * Entry settlement is additionally pending-only: an entry leaves
--     'pending' exactly once. Retries and repeated processing are idempotent.
--   * studio_release_job ends a bounded processing slice by returning the job
--     to 'received' (readiness marker preserved) so the next poll continues
--     promptly instead of waiting out the stale-claim window.
--
-- Privacy: both tables carry ORIGINAL client filenames / raw entry paths and
-- full media-truth evidence (including extracted claims). They are internal
-- only: RLS enabled with NO policies, all grants revoked except service_role.
-- Public projections use neutral labels; these rows never reach the browser.
--
-- DOWN (manual, destructive — NOT a complete automatic rollback):
--   DROP FUNCTION IF EXISTS public.studio_release_job(UUID, UUID);
--   DROP FUNCTION IF EXISTS public.studio_update_archive_claimed(UUID, UUID, UUID, JSONB);
--   DROP FUNCTION IF EXISTS public.studio_index_archive_entries(UUID, UUID, UUID, JSONB);
--   DROP FUNCTION IF EXISTS public.studio_settle_archive_entry(UUID, UUID, UUID, JSONB);
--   DROP FUNCTION IF EXISTS public.studio_job_archive_entry_counts(UUID);
--   DROP TABLE IF EXISTS public.studio_archive_entries;
--   DROP TABLE IF EXISTS public.studio_archives;
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. studio_archives — one uploaded ZIP archive (chunked, part-verified)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.studio_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.studio_upload_jobs(id) ON DELETE CASCADE,
  -- Plan-order sequence within the job: the deterministic processing order
  -- (first archive wins fact/price adoption regardless of clock resolution).
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  -- PRIVATE original filename (service-role only; never projected publicly).
  file_name TEXT NOT NULL,
  declared_size BIGINT NOT NULL CHECK (declared_size > 0),
  part_size INTEGER NOT NULL CHECK (part_size > 0),
  part_count INTEGER NOT NULL CHECK (part_count > 0),
  -- [{index, size, declaredSha256, sha256, verified}] — bounded (≤ 64 parts).
  parts JSONB NOT NULL DEFAULT '[]',
  observed_size BIGINT,
  composite_sha256 TEXT CHECK (composite_sha256 IS NULL OR composite_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','uploaded','verifying','indexed','completed','rejected')),
  entry_count INTEGER,
  total_uncompressed BIGINT,
  -- Durable adopted structured artifacts (sanitized price list, fact fields).
  extracted JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_archives_job
  ON public.studio_archives (job_id, ordinal, created_at, id);

ALTER TABLE public.studio_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_archives FROM PUBLIC;
REVOKE ALL ON public.studio_archives FROM anon;
REVOKE ALL ON public.studio_archives FROM authenticated;
GRANT ALL ON public.studio_archives TO service_role;

-- ----------------------------------------------------------------------------
-- 2. studio_archive_entries — durable per-entry inventory and outcomes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.studio_archive_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id UUID NOT NULL REFERENCES public.studio_archives(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.studio_upload_jobs(id) ON DELETE CASCADE,
  entry_index INTEGER NOT NULL CHECK (entry_index >= 0),
  -- PRIVATE raw entry path (service-role only; never projected publicly).
  entry_name TEXT NOT NULL,
  -- Neutral public-safe label used by warnings and progress UI.
  display_label TEXT NOT NULL,
  category TEXT NOT NULL,
  compressed_size BIGINT NOT NULL CHECK (compressed_size >= 0),
  uncompressed_size BIGINT NOT NULL CHECK (uncompressed_size >= 0),
  observed_size BIGINT,
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  media_class TEXT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','published_public','retained_private','skipped_duplicate','failed')),
  outcome_code TEXT,
  public_bucket TEXT,
  public_path TEXT,
  public_url TEXT,
  media_type TEXT,
  media_title TEXT,
  -- Full private evidence (claims allowed here — internal table only).
  media_truth JSONB,
  attempt TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (archive_id, entry_index)
);

CREATE INDEX IF NOT EXISTS idx_studio_archive_entries_job_state
  ON public.studio_archive_entries (job_id, state);
CREATE INDEX IF NOT EXISTS idx_studio_archive_entries_archive_state
  ON public.studio_archive_entries (archive_id, state, entry_index);
CREATE INDEX IF NOT EXISTS idx_studio_archive_entries_job_sha
  ON public.studio_archive_entries (job_id, sha256);

ALTER TABLE public.studio_archive_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_archive_entries FROM PUBLIC;
REVOKE ALL ON public.studio_archive_entries FROM anon;
REVOKE ALL ON public.studio_archive_entries FROM authenticated;
GRANT ALL ON public.studio_archive_entries TO service_role;

-- ----------------------------------------------------------------------------
-- 3. studio_release_job: end one bounded slice, keep the job promptly due
--
-- Compare-and-set on the live claim. The readiness marker
-- (processing_requested_at) and attempt_count are preserved so the job stays
-- eligible for the very next resume poll. A stale token is a no-op.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_release_job(
  p_job_id UUID,
  p_token UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.studio_upload_jobs
  SET status = 'received',
      processing_token = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND processing_token = p_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. studio_update_archive_claimed: claim-checked archive patch
--
-- Whitelisted fields only; applies inside the same transaction that verifies
-- the caller still holds the job's processing claim (FOR UPDATE), so a stale
-- worker can never move archive state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_update_archive_claimed(
  p_job_id UUID,
  p_token UUID,
  p_archive_id UUID,
  p_patch JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claimed INTEGER;
  v_updated INTEGER;
BEGIN
  PERFORM 1 FROM public.studio_upload_jobs
   WHERE id = p_job_id AND status = 'processing' AND processing_token = p_token
   FOR UPDATE;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.studio_archives
  SET status = COALESCE(p_patch->>'status', status),
      parts = COALESCE(p_patch->'parts', parts),
      observed_size = COALESCE((p_patch->>'observed_size')::BIGINT, observed_size),
      composite_sha256 = COALESCE(p_patch->>'composite_sha256', composite_sha256),
      entry_count = COALESCE((p_patch->>'entry_count')::INTEGER, entry_count),
      total_uncompressed = COALESCE((p_patch->>'total_uncompressed')::BIGINT, total_uncompressed),
      extracted = COALESCE(p_patch->'extracted', extracted),
      error_code = COALESCE(p_patch->>'error_code', error_code),
      updated_at = now()
  WHERE id = p_archive_id AND job_id = p_job_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. studio_index_archive_entries: claim-checked idempotent inventory insert
--
-- Inserts the durable entry inventory in one transaction with the claim
-- check. ON CONFLICT (archive_id, entry_index) DO NOTHING makes a re-run
-- after a crashed indexing slice fill only the missing rows — never
-- duplicates, never an overwrite of settled outcomes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_index_archive_entries(
  p_job_id UUID,
  p_token UUID,
  p_archive_id UUID,
  p_entries JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claimed INTEGER;
BEGIN
  PERFORM 1 FROM public.studio_upload_jobs
   WHERE id = p_job_id AND status = 'processing' AND processing_token = p_token
   FOR UPDATE;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.studio_archive_entries (
    archive_id, job_id, entry_index, entry_name, display_label, category,
    compressed_size, uncompressed_size
  )
  SELECT
    p_archive_id,
    p_job_id,
    (e->>'entry_index')::INTEGER,
    e->>'entry_name',
    e->>'display_label',
    e->>'category',
    (e->>'compressed_size')::BIGINT,
    (e->>'uncompressed_size')::BIGINT
  FROM jsonb_array_elements(p_entries) AS e
  ON CONFLICT (archive_id, entry_index) DO NOTHING;
  RETURN TRUE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. studio_settle_archive_entry: claim-checked, pending-only settlement
--
-- The ONLY transition out of 'pending'. Guarded by the job claim AND the
-- pending state in one statement: a stale worker (or a duplicate slice)
-- matches zero rows, learns it lost, and must treat its own uploaded objects
-- as orphans. Settled outcomes are immutable.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_settle_archive_entry(
  p_job_id UUID,
  p_token UUID,
  p_entry_id UUID,
  p_outcome JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claimed INTEGER;
  v_updated INTEGER;
BEGIN
  PERFORM 1 FROM public.studio_upload_jobs
   WHERE id = p_job_id AND status = 'processing' AND processing_token = p_token
   FOR UPDATE;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.studio_archive_entries
  SET state = p_outcome->>'state',
      outcome_code = p_outcome->>'outcomeCode',
      observed_size = (p_outcome->>'observedSize')::BIGINT,
      sha256 = p_outcome->>'sha256',
      media_class = p_outcome->>'mediaClass',
      public_bucket = p_outcome->>'publicBucket',
      public_path = p_outcome->>'publicPath',
      public_url = p_outcome->>'publicUrl',
      media_type = p_outcome->>'mediaType',
      media_title = p_outcome->>'mediaTitle',
      media_truth = p_outcome->'mediaTruth',
      attempt = p_outcome->>'attempt',
      processed_at = COALESCE((p_outcome->>'processedAt')::TIMESTAMPTZ, now())
  WHERE id = p_entry_id
    AND job_id = p_job_id
    AND state = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. studio_job_archive_entry_counts: aggregate progress (read-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_job_archive_entry_counts(
  p_job_id UUID
) RETURNS TABLE (state TEXT, entries BIGINT)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT e.state, COUNT(*)::BIGINT
  FROM public.studio_archive_entries e
  WHERE e.job_id = p_job_id
  GROUP BY e.state;
$$;

-- ----------------------------------------------------------------------------
-- 8. Function grants: service_role only (same posture as every Studio RPC)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.studio_release_job(uuid, uuid)',
    'public.studio_update_archive_claimed(uuid, uuid, uuid, jsonb)',
    'public.studio_index_archive_entries(uuid, uuid, uuid, jsonb)',
    'public.studio_settle_archive_entry(uuid, uuid, uuid, jsonb)',
    'public.studio_job_archive_entry_counts(uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;

COMMIT;
