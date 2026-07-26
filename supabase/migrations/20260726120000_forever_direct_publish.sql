-- FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001
--
-- Owner-authorized direct publication: one atomic operation that ingests a
-- project batch AND makes it public, with no intermediate Owner-actionable
-- Draft.
--
-- WHY THIS EXISTS
-- ---------------
-- `public.forever_progressive_ingest` deliberately hardcodes
-- `public_status = 'draft'` for a new project ("saved, NEVER auto-published")
-- and honours `project.publish` only in enrich mode. That is the correct
-- default for ordinary ingestion, and it is NOT changed here.
--
-- Direct publication needs a different, explicitly Owner-authorized guarantee:
-- a successful operation ends published, and a failed operation leaves no
-- partially public project. Doing that as two RPC calls (create, then enrich to
-- publish) would leave a real persisted draft between them, and would leave one
-- behind permanently if the second call failed. So the two steps are composed
-- inside a single Postgres function — one function call is one transaction, so
-- either the graph and the publication both land, or neither does.
--
-- SAFETY BOUNDARY
-- ---------------
--   * Additive only. No existing function, table, policy, grant or default is
--     modified; `forever_progressive_ingest` keeps its exact current behaviour
--     and remains the lane every other caller uses.
--   * `SECURITY INVOKER` with a locked empty search_path, exactly like the
--     function it wraps. It grants no privilege the caller does not already
--     hold.
--   * service_role only. Revoked from PUBLIC, anon and authenticated, so no
--     browser session and no public user can reach it.
--   * Publication is scoped to the ONE project the batch names. It can never
--     publish, unpublish or touch any other project.
--   * `is_active` is set true only for the named project, because a published
--     row that is not active is invisible and would be an untruthful "published".

-- ----------------------------------------------------------------------------
-- 1. Public media buckets
--
-- Direct publication uploads sanitized public derivatives, so the two public
-- buckets must exist. Their public-read storage.objects policies were already
-- created in 20260704114738; only the bucket rows may be missing.
--
-- `forever-direct-evidence` is PRIVATE: it holds the unmodified official
-- originals as provenance evidence. No storage.objects policy is added for it,
-- so only the service role can read or write it and nothing in it is ever
-- publicly reachable.
--
-- All three inserts are no-ops where the bucket already exists, and they
-- deliberately use the same ids as 20260721120000_forever_studio_v1 so the two
-- migrations compose in either order.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('project-images', 'project-images', true),
  ('project-documents', 'project-documents', true),
  ('forever-direct-evidence', 'forever-direct-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. forever_direct_publish(batch, options)
--
-- `batch`   an ordinary progressive batch (identical contract to
--           forever_progressive_ingest, including batch_fingerprint idempotency).
-- `options` Owner provenance for audit. Required keys:
--             source_trust      must be 'owner_approved_official'
--             publication_mode  must be 'direct'
--           Optional: actor_id, actor_email, actor_role, package_ref.
--
-- Returns the progressive summary with `public_status` reflecting the ACTUAL
-- post-publication state, plus `direct_published` and `replayed` flags.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forever_direct_publish(batch JSONB, options JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_summary JSONB;
  v_slug TEXT;
  v_project_id UUID;
  v_status TEXT;
  v_options JSONB := COALESCE(options, '{}'::jsonb);
BEGIN
  -- -------- Owner authorization stamps (technical envelope) --------
  -- These are not a content review. They prove the caller deliberately invoked
  -- the direct lane instead of reaching it by accident from ordinary tooling.
  IF v_options->>'source_trust' IS DISTINCT FROM 'owner_approved_official' THEN
    RAISE EXCEPTION 'forever_direct_publish: source_trust_required';
  END IF;
  IF v_options->>'publication_mode' IS DISTINCT FROM 'direct' THEN
    RAISE EXCEPTION 'forever_direct_publish: publication_mode_required';
  END IF;

  IF batch IS NULL OR jsonb_typeof(batch) <> 'object' THEN
    RAISE EXCEPTION 'forever_direct_publish: batch_malformed';
  END IF;
  v_slug := batch->'project'->>'slug';
  IF v_slug IS NULL OR btrim(v_slug) = '' THEN
    RAISE EXCEPTION 'forever_direct_publish: project_slug_required';
  END IF;

  -- -------- 1. the unchanged progressive graph write --------
  -- Any failure inside here aborts this whole function: no project row, no
  -- child rows, and no publication survive a failed direct publish.
  v_summary := public.forever_progressive_ingest(batch);

  v_project_id := (v_summary->>'project_id')::uuid;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'forever_direct_publish: project_id_unresolved';
  END IF;

  -- -------- 2. publication, same transaction, this project only --------
  -- Idempotent: running it again on an already-published project is a no-op
  -- update, so an exact package replay still ends published.
  UPDATE public.projects
     SET public_status = 'published',
         is_active = true,
         updated_at = now()
   WHERE id = v_project_id;

  SELECT p.public_status INTO v_status
    FROM public.projects p
   WHERE p.id = v_project_id;

  IF v_status IS DISTINCT FROM 'published' THEN
    -- Never report a publication that did not happen.
    RAISE EXCEPTION 'forever_direct_publish: publication_not_applied';
  END IF;

  RETURN v_summary
         || jsonb_build_object(
              'public_status', v_status,
              'direct_published', true,
              'source_trust', v_options->>'source_trust',
              'publication_mode', v_options->>'publication_mode'
            );
END;
$$;

-- Owner server-side tooling only. Never the browser, never anon.
REVOKE ALL ON FUNCTION public.forever_direct_publish(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forever_direct_publish(JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.forever_direct_publish(JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forever_direct_publish(JSONB, JSONB) TO service_role;

COMMENT ON FUNCTION public.forever_direct_publish(JSONB, JSONB) IS
  'FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001: atomic Owner-authorized ingest + publish. '
  'Wraps forever_progressive_ingest without altering it; no persisted draft on success, '
  'nothing public on failure. service_role only.';

-- Rollback note: this migration is additive and safely reversible with
--   DROP FUNCTION IF EXISTS public.forever_direct_publish(JSONB, JSONB);
-- Dropping it removes the direct lane and leaves ordinary progressive
-- ingestion, every project row, and every publication state untouched.
