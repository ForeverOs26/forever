-- ============================================================================
-- FOREVER STUDIO — FINAL MIGRATION DRAFT (not applied)
--
-- FOREVER-STUDIO-001: Authenticated Mobile Owner and Trusted Publisher
-- Direct Upload. This repository migration has NOT been applied to any
-- linked or production database. It layers on top of
-- 20260718113000_progressive_ingestion_v1.sql (also unapplied) and touches
-- nothing under forever_import / forever_execution.
-- The static test suite src/features/forever-studio/tests/
-- migration-contract.test.ts asserts this file's security contract verbatim.
--
-- Product rule (durable): an upload by an authenticated Owner or Trusted
-- Publisher IS direct publication authorization. Incomplete business data
-- never creates a follow-on approval or publication gate. This migration
-- therefore adds NO approval, readiness, review-queue, or second-confirmation
-- objects — only identity, job persistence, and storage.
--
-- Security model:
--   * studio_members is the ONLY authorization source for Studio. There is
--     no public self-registration: the table has RLS enabled with NO
--     policies, and only service_role may read or write it. Membership is
--     created exclusively by server-side owner tooling (invite) or the
--     one-time STUDIO_OWNER_EMAIL bootstrap in the server boundary.
--   * studio_upload_jobs is internal-only job/audit state (same pattern).
--   * The browser NEVER holds a service-role credential; every Studio write
--     goes through the app server, which verifies the caller's Supabase JWT
--     and an active studio_members row before using the service role.
--   * forever_progressive_ingest grants are unchanged (service_role only).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. studio_members: Owner and Trusted Publisher identity
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.studio_members (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'trusted_publisher')),
  display_name TEXT,
  email TEXT,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.studio_members IS
  'Forever Studio authorization. Server-managed only: no self-registration, no browser writes. An inactive row denies access without losing attribution history.';

GRANT ALL ON public.studio_members TO service_role;
ALTER TABLE public.studio_members ENABLE ROW LEVEL SECURITY;
-- RLS on, NO policies: internal-only (audit_log pattern). Authorization is
-- enforced at the app-server boundary, never in the browser.

CREATE TRIGGER trg_studio_members_updated_at
  BEFORE UPDATE ON public.studio_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. studio_upload_jobs: durable, retryable upload work records
--
-- A job is created BEFORE any file processing, so a temporary infrastructure
-- failure preserves a retryable record instead of losing the upload. Retries
-- replay the same progressive batches; the RPC's fingerprint idempotency
-- guarantees no duplicate writes. Jobs also answer "who created or changed
-- this record" together with public.audit_log.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.studio_upload_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_email TEXT,
  creator_role TEXT NOT NULL CHECK (creator_role IN ('owner', 'trusted_publisher')),
  workflow TEXT NOT NULL CHECK (workflow IN (
    'new_development',
    'project_update',
    'price_availability_update',
    'construction_media_update',
    'resale_listing'
  )),
  project_slug TEXT,
  listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'processing', 'published', 'failed'
  )),
  -- Manually entered facts exactly as submitted (audit + retry input).
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Declared upload targets and their outcomes:
  -- [{name, bucket, path, content_type, size, category, status}]
  files JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_summary JSONB,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.studio_upload_jobs IS
  'Forever Studio upload jobs. A failed job stays retryable; progressive batch fingerprints make retries idempotent. Internal-only: served to publishers through the authorized app-server boundary.';

GRANT ALL ON public.studio_upload_jobs TO service_role;
ALTER TABLE public.studio_upload_jobs ENABLE ROW LEVEL SECURITY;
-- RLS on, NO policies: internal-only.

CREATE TRIGGER trg_studio_upload_jobs_updated_at
  BEFORE UPDATE ON public.studio_upload_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_studio_upload_jobs_created_by
  ON public.studio_upload_jobs(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_upload_jobs_status
  ON public.studio_upload_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_upload_jobs_project_slug
  ON public.studio_upload_jobs(project_slug)
  WHERE project_slug IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Storage buckets
--
-- project-images / project-documents already exist in the linked project
-- (their public-read policies were created in 20260704114738). The inserts
-- below are no-ops there and only matter for a fresh local database.
-- studio-uploads is NEW and PRIVATE: raw sources (price lists, archives,
-- unclassified files) are retained for provenance and later enrichment but
-- never publicly readable. No storage.objects policy is added for it, so
-- only the service role (and the short-lived signed upload tokens it issues)
-- can touch it.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('project-images', 'project-images', true),
  ('project-documents', 'project-documents', true),
  ('studio-uploads', 'studio-uploads', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------------------
-- DOWN (reversal reference only — never bundle with the UP migration)
-- ----------------------------------------------------------------------------
-- DROP TABLE IF EXISTS public.studio_upload_jobs;
-- DROP TABLE IF EXISTS public.studio_members;
-- DELETE FROM storage.buckets WHERE id = 'studio-uploads';
--   -- project-images / project-documents predate this migration; never drop.
