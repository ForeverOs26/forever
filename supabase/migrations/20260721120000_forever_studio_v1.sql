-- ============================================================================
-- FOREVER STUDIO — ADDITIVE MIGRATION DRAFT (pending; not applied here)
--
-- FOREVER-STUDIO-001: Authenticated Mobile Owner and Trusted Publisher
-- Direct Upload. This migration is the ONLY pending Studio migration. It is
-- additive and layers on top of the ALREADY-APPLIED progressive ingestion
-- migration 20260718113000_progressive_ingestion_v1.sql (canonical evidence:
-- Coralina is imported as an unpublished progressive draft — 1 project,
-- 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch). This
-- file has NOT been applied by this task; before applying it, Codex performs
-- a read-only live-schema and migration-history check. It touches nothing
-- under forever_import / forever_execution and does not re-run or alter the
-- already-applied progressive migration.
--
-- The static suite src/features/forever-studio/tests/migration-contract.test.ts
-- pins this file's security contract, and the real-database suite
-- src/features/forever-studio/tests/studio.postgres.sql exercises its
-- behavior against a disposable PostgreSQL instance.
--
-- Product rule (durable): an upload by an authenticated Owner or Trusted
-- Publisher IS direct publication authorization. Incomplete business data
-- never creates a follow-on approval or publication gate. This migration
-- therefore adds NO approval, readiness, review-queue, or second-confirmation
-- objects — only identity, durable retryable jobs, private staging/contact
-- boundaries, and the atomic ingest+publish transaction functions.
--
-- Security model:
--   * studio_members is the ONLY authorization source for Studio. There is
--     no public self-registration: RLS is enabled with NO policies, only
--     service_role may read or write it, and a partial unique index makes the
--     one-time Owner bootstrap single-winner at the database.
--   * studio_upload_jobs and studio_listing_contacts are internal-only
--     (RLS on, no policies, service_role only). Deleting an auth account
--     never cascade-deletes Studio history (ON DELETE SET NULL + retained
--     email/role snapshot).
--   * Private seller/partner contact data lives only in
--     studio_listing_contacts. The public listings row and its anonymous
--     SELECT surface carry NO contact columns at all.
--   * The browser NEVER holds a service-role credential; every Studio write
--     goes through the app server, which verifies the caller's Supabase JWT
--     and an active studio_members row before using the service role.
--   * The Studio transaction functions are service_role only and compose the
--     unchanged public.forever_progressive_ingest inside one transaction.
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

-- Database-enforced single Owner bootstrap: at most one self-bootstrapped
-- owner (role='owner' with no inviter) can ever exist, so a bootstrap race
-- cannot mint two owners even if the application guard were bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS studio_members_single_bootstrap_owner
  ON public.studio_members ((true))
  WHERE role = 'owner' AND invited_by IS NULL;

CREATE TRIGGER trg_studio_members_updated_at
  BEFORE UPDATE ON public.studio_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. studio_upload_jobs: durable, retryable, concurrency-safe upload jobs
--
-- A job is created BEFORE any file processing, so a temporary infrastructure
-- failure preserves a retryable record instead of losing the upload. A single
-- worker claims a job by compare-and-set (processing_token); a request that
-- dies mid-processing is recovered after processing_started_at goes stale.
-- created_by is nullable with ON DELETE SET NULL and a retained creator
-- email/role snapshot, so deleting an auth account never erases job history.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.studio_upload_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
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
  -- One-winner processing claim + stale recovery.
  processing_token UUID,
  processing_started_at TIMESTAMPTZ,
  -- Stable per-job content identity (batch fingerprint / resale slug seed) so
  -- retries and concurrent calls converge on the same project/listing.
  content_fingerprint TEXT,
  -- Manually entered facts exactly as submitted (audit + retry input).
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Declared + observed upload records: [{name, staging_bucket, staging_path,
  -- declared_size, observed_size, sha256, media_class, public_bucket,
  -- public_path, status}]. Observed values come from actual stored bytes.
  files JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_summary JSONB,
  -- Sanitized operator error only: a stable code + a concise user-facing
  -- message. Raw database/filesystem/SQL/path text is NEVER stored here.
  error_code TEXT,
  error TEXT,
  retryable BOOLEAN NOT NULL DEFAULT true,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.studio_upload_jobs IS
  'Forever Studio upload jobs. A failed job stays retryable and is resumed automatically; a stale processing claim is recoverable. Internal-only: served to publishers through the authorized app-server boundary.';

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
CREATE INDEX IF NOT EXISTS idx_studio_upload_jobs_due
  ON public.studio_upload_jobs(status, processing_started_at);
CREATE INDEX IF NOT EXISTS idx_studio_upload_jobs_project_slug
  ON public.studio_upload_jobs(project_slug)
  WHERE project_slug IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. studio_listing_contacts: PRIVATE seller/partner contact data
--
-- Resale contact details supplied by clients and partners are private and
-- must never reach the anonymous public surface. They live here (RLS on, no
-- policies, service_role only) and are joined only through the authorized
-- Studio boundary. The public listings row carries no contact columns.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.studio_listing_contacts (
  listing_id UUID PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.studio_listing_contacts IS
  'Private resale contact data. Never exposed to anon/authenticated: RLS on, no policies, service_role only. The public listings row has no contact columns.';

GRANT ALL ON public.studio_listing_contacts TO service_role;
ALTER TABLE public.studio_listing_contacts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_studio_listing_contacts_updated_at
  BEFORE UPDATE ON public.studio_listing_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Non-destructive relocation: preserve any existing listing contact data into
-- the private table (none is expected — Studio is the only, and as-yet
-- unshipped, writer of listings), THEN remove the public columns so the
-- anonymous PostgREST surface is structurally incapable of returning them.
INSERT INTO public.studio_listing_contacts (listing_id, contact_name, contact_phone, contact_email)
  SELECT id, contact_name, contact_phone, contact_email
  FROM public.listings
  WHERE contact_name IS NOT NULL OR contact_phone IS NOT NULL OR contact_email IS NOT NULL
  ON CONFLICT (listing_id) DO NOTHING;

ALTER TABLE public.listings
  DROP COLUMN IF EXISTS contact_name,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS contact_email;

-- ----------------------------------------------------------------------------
-- 4. Storage buckets
--
-- project-images / project-documents already exist in the linked project
-- (their public-read policies were created in 20260704114738). The inserts
-- below are no-ops there and only matter for a fresh local database.
-- studio-uploads is PRIVATE and is the single staging destination for EVERY
-- incoming file. Only selected, byte-verified final media are copied to the
-- public buckets during finalization; raw PDFs, ZIPs, price lists, legal
-- files, and unselected media never leave the private bucket. No
-- storage.objects policy is added for studio-uploads, so only the service
-- role (and the short-lived signed upload tokens it issues) can touch it.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('project-images', 'project-images', true),
  ('project-documents', 'project-documents', true),
  ('studio-uploads', 'studio-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. studio_bootstrap_owner: atomic, single-winner Owner bootstrap
--
-- Serialized by a transaction-scoped advisory lock and guarded by the partial
-- unique index above. Inserts the Owner only when the roster is empty; a
-- concurrent second call sees a non-empty roster and returns nothing.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_bootstrap_owner(
  p_user_id UUID,
  p_email TEXT
) RETURNS SETOF public.studio_members
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('studio_bootstrap_owner'));
  IF EXISTS (SELECT 1 FROM public.studio_members) THEN
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO public.studio_members (user_id, role, email, is_active, invited_by)
    VALUES (p_user_id, 'owner', p_email, true, NULL)
    RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. studio_claim_job: single-winner processing claim with stale recovery
--
-- Compare-and-set: exactly one caller transitions a received/failed/stale job
-- to 'processing' and stamps its processing_token. A fresh in-flight claim by
-- another worker is left untouched (0 rows returned). A published job is never
-- reclaimed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_claim_job(
  p_job_id UUID,
  p_token UUID,
  p_stale_seconds INTEGER DEFAULT 900
) RETURNS SETOF public.studio_upload_jobs
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
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
      AND status <> 'published'
      AND (
        status IN ('received', 'failed')
        OR (status = 'processing'
            AND (processing_started_at IS NULL
                 OR processing_started_at < now() - make_interval(secs => p_stale_seconds)))
      )
    RETURNING *;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. studio_fail_job: release a claim as a retryable/terminal failure
--
-- Only the current claim holder may fail its job; a token mismatch is a no-op
-- so a stale worker can never clobber a fresh claim's state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_fail_job(
  p_job_id UUID,
  p_token UUID,
  p_error_code TEXT,
  p_error_message TEXT,
  p_retryable BOOLEAN
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.studio_upload_jobs
  SET status = 'failed',
      processing_token = NULL,
      error_code = p_error_code,
      error = left(p_error_message, 500),
      retryable = COALESCE(p_retryable, true),
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND processing_token = p_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. studio_publish_project: ONE atomic ingest + publish + finalize
--
-- Composes the unchanged public.forever_progressive_ingest and the authorized
-- 'published' transition in a single transaction. Any failure rolls back the
-- entire operation — no project, children, batch, or public page survives a
-- partial run. An exact retry converges once (the progressive fingerprint is
-- idempotent and a published job returns its stored result).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_publish_project(
  p_job_id UUID,
  p_token UUID,
  p_batch JSONB,
  p_publish BOOLEAN,
  p_result JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_job public.studio_upload_jobs;
  v_summary JSONB;
  v_project_id UUID;
  v_public TEXT;
BEGIN
  SELECT * INTO v_job FROM public.studio_upload_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'studio_job_not_found';
  END IF;
  IF v_job.status = 'published' THEN
    -- Idempotent replay: return the stored result in the normal shape.
    RETURN jsonb_build_object(
      'project_id', COALESCE(v_job.result_summary->>'projectId', ''),
      'project_slug', COALESCE(v_job.project_slug, ''),
      'public_status', COALESCE(v_job.result_summary->>'publicStatus', 'published'),
      'counts', COALESCE(v_job.result_summary->'counts', '{}'::jsonb),
      'replayed', true);
  END IF;
  IF v_job.processing_token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'studio_job_not_claimed';
  END IF;

  -- Atomic graph write (create or presence-aware enrich).
  v_summary := public.forever_progressive_ingest(p_batch);
  v_project_id := (v_summary->>'project_id')::uuid;

  IF p_publish THEN
    -- Direct publication authorization from the authorized upload.
    UPDATE public.projects
      SET public_status = 'published', is_active = true, updated_at = now()
      WHERE id = v_project_id;
    v_public := 'published';
  ELSE
    v_public := v_summary->>'public_status';
  END IF;

  UPDATE public.studio_upload_jobs
    SET status = 'published',
        processing_token = NULL,
        project_slug = v_summary->>'project_slug',
        content_fingerprint = p_batch->>'batch_fingerprint',
        result_summary = p_result
          || jsonb_build_object(
               'projectId', v_project_id::text,
               'publicStatus', v_public,
               'counts', v_summary->'counts'),
        error = NULL,
        error_code = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'project_id', v_project_id::text,
    'project_slug', v_summary->>'project_slug',
    'public_status', v_public,
    'counts', v_summary->'counts',
    'replayed', false);
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. studio_publish_resale: ONE atomic listing upsert + private contact +
--    warnings + finalize
--
-- The deterministic per-job slug makes the whole operation idempotent: two
-- concurrent calls converge on one listing (ON CONFLICT (slug)), the private
-- contact row is upserted, this job's listing warnings are replaced, and the
-- job is finalized — all in one transaction.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_publish_resale(
  p_job_id UUID,
  p_token UUID,
  p_listing JSONB,
  p_contact JSONB,
  p_warnings JSONB,
  p_result JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_job public.studio_upload_jobs;
  v_listing_id UUID;
  v_slug TEXT;
  v_item JSONB;
BEGIN
  SELECT * INTO v_job FROM public.studio_upload_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'studio_job_not_found';
  END IF;
  IF v_job.status = 'published' THEN
    RETURN jsonb_build_object(
      'listing_id', COALESCE(v_job.listing_id::text, ''),
      'slug', COALESCE(v_job.content_fingerprint, ''),
      'replayed', true);
  END IF;
  IF v_job.processing_token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'studio_job_not_claimed';
  END IF;

  v_slug := NULLIF(trim(p_listing->>'slug'), '');
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'studio_resale_slug_required';
  END IF;

  INSERT INTO public.listings (
    kind, title, slug, project_id, project_name_raw, location_id, location_name_raw,
    property_type, bedrooms, bathrooms, area_sqm, price, currency,
    availability_status, description, photos, field_provenance, publication_status
  ) VALUES (
    'resale',
    p_listing->>'title',
    v_slug,
    (p_listing->>'project_id')::uuid,
    p_listing->>'project_name_raw',
    (p_listing->>'location_id')::uuid,
    p_listing->>'location_name_raw',
    p_listing->>'property_type',
    (p_listing->>'bedrooms')::int,
    (p_listing->>'bathrooms')::int,
    (p_listing->>'area_sqm')::numeric,
    (p_listing->>'price')::numeric,
    NULLIF(trim(COALESCE(p_listing->>'currency', '')), ''),
    COALESCE(NULLIF(trim(p_listing->>'availability_status'), ''), 'available'),
    p_listing->>'description',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_listing->'photos', '[]'::jsonb))),
    COALESCE(p_listing->'field_provenance', '{}'::jsonb),
    'published'
  )
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    project_id = EXCLUDED.project_id,
    project_name_raw = EXCLUDED.project_name_raw,
    location_id = EXCLUDED.location_id,
    location_name_raw = EXCLUDED.location_name_raw,
    property_type = EXCLUDED.property_type,
    bedrooms = EXCLUDED.bedrooms,
    bathrooms = EXCLUDED.bathrooms,
    area_sqm = EXCLUDED.area_sqm,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    availability_status = EXCLUDED.availability_status,
    description = EXCLUDED.description,
    photos = EXCLUDED.photos,
    field_provenance = EXCLUDED.field_provenance,
    publication_status = 'published',
    updated_at = now()
  RETURNING id INTO v_listing_id;

  -- Private contact data — never on the public listing row.
  INSERT INTO public.studio_listing_contacts (listing_id, contact_name, contact_phone, contact_email)
  VALUES (
    v_listing_id,
    NULLIF(trim(p_contact->>'contact_name'), ''),
    NULLIF(trim(p_contact->>'contact_phone'), ''),
    NULLIF(trim(p_contact->>'contact_email'), '')
  )
  ON CONFLICT (listing_id) DO UPDATE SET
    contact_name = EXCLUDED.contact_name,
    contact_phone = EXCLUDED.contact_phone,
    contact_email = EXCLUDED.contact_email,
    updated_at = now();

  -- Replace this listing's warnings so retries do not accumulate duplicates.
  DELETE FROM public.ingestion_warnings WHERE listing_id = v_listing_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_warnings, '[]'::jsonb))
  LOOP
    INSERT INTO public.ingestion_warnings (listing_id, entity, field, code, severity, message, payload)
    VALUES (
      v_listing_id,
      v_item->>'entity',
      v_item->>'field',
      v_item->>'code',
      COALESCE(v_item->>'severity', 'warning'),
      v_item->>'message',
      COALESCE(v_item->'payload', '{}'::jsonb)
    );
  END LOOP;

  UPDATE public.studio_upload_jobs
    SET status = 'published',
        processing_token = NULL,
        listing_id = v_listing_id,
        content_fingerprint = v_slug,
        result_summary = p_result || jsonb_build_object('listingId', v_listing_id::text, 'slug', v_slug),
        error = NULL,
        error_code = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = p_job_id;

  RETURN jsonb_build_object('listing_id', v_listing_id::text, 'slug', v_slug, 'replayed', false);
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. studio_lookup_auth_user_id: exact-email → auth.users id
--
-- Lets the Owner invite an EXISTING Supabase Auth account that is not yet a
-- Studio member, without exposing the auth schema through PostgREST. SECURITY
-- DEFINER so it can read auth.users, but it returns only a single uuid for an
-- exact lowercased email and is executable by service_role only. It grants no
-- access to anything else and never returns password or token material.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_lookup_auth_user_id(p_email TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 11. Grants: every Studio function is service_role only.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.studio_bootstrap_owner(uuid, text)',
    'public.studio_claim_job(uuid, uuid, integer)',
    'public.studio_fail_job(uuid, uuid, text, text, boolean)',
    'public.studio_publish_project(uuid, uuid, jsonb, boolean, jsonb)',
    'public.studio_publish_resale(uuid, uuid, jsonb, jsonb, jsonb, jsonb)',
    'public.studio_lookup_auth_user_id(text)'
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

-- ----------------------------------------------------------------------------
-- DOWN (reversal reference only — never bundle with the UP migration)
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.studio_lookup_auth_user_id(text);
-- DROP FUNCTION IF EXISTS public.studio_publish_resale(uuid, uuid, jsonb, jsonb, jsonb, jsonb);
-- DROP FUNCTION IF EXISTS public.studio_publish_project(uuid, uuid, jsonb, boolean, jsonb);
-- DROP FUNCTION IF EXISTS public.studio_fail_job(uuid, uuid, text, text, boolean);
-- DROP FUNCTION IF EXISTS public.studio_claim_job(uuid, uuid, integer);
-- DROP FUNCTION IF EXISTS public.studio_bootstrap_owner(uuid, text);
-- DROP TABLE IF EXISTS public.studio_listing_contacts;
--   -- listings.contact_* columns were relocated, not preserved separately;
--   -- restoring them would require re-adding the columns and copying back.
-- DROP TABLE IF EXISTS public.studio_upload_jobs;
-- DROP TABLE IF EXISTS public.studio_members;
-- DELETE FROM storage.buckets WHERE id = 'studio-uploads';
--   -- project-images / project-documents predate this migration; never drop.
