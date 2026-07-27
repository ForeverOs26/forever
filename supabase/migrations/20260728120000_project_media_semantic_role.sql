-- FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001: project_media.semantic_role.
--
-- The publish lane already classifies every file into a fixed vocabulary of
-- seventeen semantic roles (src/features/forever-direct-publish/hero-policy.ts)
-- and the package manifest already carries the result. It is dropped one line
-- before the database: publish.ts writes media_type, url and sort_order and
-- nothing else, so the browser receives a content-addressed URL
-- (228e15880eb29ab81db1f526.jpg) and, on all 329 published assets, an empty
-- title. There is no evidence in the payload from which the UI could tell a
-- launch-party photograph from a pool render, and deriving one from the URL or
-- the slug in the browser would be exactly the media-truth hack that is
-- forbidden.
--
-- This migration adds the missing column and makes it — and only it — readable
-- by the public role.
--
-- ADDITIVE AND UNAPPLIED. It edits no existing migration. Run it only through
-- the normal, separately authorised migration process, and BEFORE deploying any
-- client that selects the column: PostgREST fails an entire embedded select
-- with 42703 when a requested column does not exist, which would blank the
-- whole project page rather than one section.

BEGIN;

-- Nullable, and that is the rollout contract, not an oversight. Every row
-- published before today has no role. NOT NULL would either fail the migration
-- on those rows or force a default that fabricates a classification nobody
-- made. The reader treats NULL as "no opinion recorded" and shows the image.
ALTER TABLE public.project_media
  ADD COLUMN IF NOT EXISTS semantic_role TEXT;

-- The vocabulary, quoted verbatim from SEMANTIC_ROLES in hero-policy.ts. NULL
-- is permitted; any value outside the list is not, so a typo in a publish run
-- fails loudly at write time rather than silently disabling a filter later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_media_semantic_role_vocabulary'
      AND conrelid = 'public.project_media'::regclass
  ) THEN
    ALTER TABLE public.project_media
      ADD CONSTRAINT project_media_semantic_role_vocabulary
      CHECK (
        semantic_role IS NULL
        OR semantic_role IN (
          'property_exterior',
          'property_aerial',
          'property_pool_exterior',
          'villa_exterior',
          'architecture_render',
          'property_interior',
          'amenity',
          'landscape',
          'lifestyle',
          'event',
          'group_photo',
          'portrait',
          'decorative_detail',
          'text_promo',
          'plan',
          'map',
          'unknown'
        )
      );
  END IF;
END
$$;

-- Public read access to the presentation column, and nothing else.
--
-- Restated as a full column list rather than a bare `GRANT SELECT
-- (semantic_role)`, so this migration is correct whether or not
-- 20260723130000_public_projection_privacy.sql has been applied, and issues no
-- REVOKE — it must never be the statement that changes any other column's
-- reachability.
--
-- `metadata` and `created_at` are deliberately excluded. `metadata` carries
-- provenance: source filesystem paths, package directories, sanitizer records
-- and Drive/Telegram references. None of it may reach an anonymous client.
GRANT SELECT (
  id, project_id, media_type, title, url, sort_order, semantic_role
) ON public.project_media TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Exactly one active cover per project.
--
-- Re-publishing a project appends its new cover row instead of replacing the
-- old one, so both survive at sort_order = 0. Fresh verification on 2026-07-28
-- found this on both projects that have been re-published:
--
--   The Title Sierra  — two cover rows. main_image_url points at the corrected
--                       exterior render, but the superseded row still carries
--                       the "HOLIDAY MOMENTS" seasonal graphic, and it is still
--                       served to the public as image 2 of 40.
--   Coralina          — two cover rows. The superseded row is the launch-event
--                       group photograph, served as image 2.
--
-- Correcting `main_image_url` alone never fixed this, because the detail mapper
-- folds every cover-typed row into the gallery.
--
-- The policy is DEMOTE, not delete: a superseded cover becomes an ordinary
-- gallery row. It keeps its storage object, its private retained original and
-- its row, so no source media evidence is destroyed and the change is
-- reversible. It also never leaves a project cover-less: the new cover is
-- written before this runs, and the function is a no-op when the caller names
-- no replacement — which is what preserves the deliberate behaviour that a
-- price-only enrichment must not strip a good cover, and what leaves Villa
-- Kirara correctly cover-less until a safe exterior derivative exists.
--
-- Idempotent: running it twice with the same cover URL changes nothing the
-- second time, because the rows it would demote have already been demoted.
CREATE OR REPLACE FUNCTION public.forever_project_cover_reconcile(
  p_project_id UUID,
  p_cover_url TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_demoted INTEGER := 0;
BEGIN
  -- No replacement named: leave the existing designation exactly as it is.
  IF p_cover_url IS NULL OR btrim(p_cover_url) = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.project_media
     SET media_type = 'gallery'
   WHERE project_id = p_project_id
     AND media_type = 'cover'
     AND url IS DISTINCT FROM p_cover_url;

  GET DIAGNOSTICS v_demoted = ROW_COUNT;
  RETURN v_demoted;
END;
$$;

REVOKE ALL ON FUNCTION public.forever_project_cover_reconcile(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forever_project_cover_reconcile(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forever_project_cover_reconcile(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.forever_project_cover_reconcile(UUID, TEXT) IS
  'Demotes superseded cover rows of one project to gallery so exactly one '
  'active cover remains. Deletes nothing. No-op when no replacement cover is '
  'named, so an enrichment run cannot strip a good cover.';

COMMENT ON COLUMN public.project_media.semantic_role IS
  'What the image depicts, from the fixed vocabulary in hero-policy.ts. '
  'Presentation data only — never provenance. NULL means no classification was '
  'recorded, which readers must treat as "show it", not "hide it".';

COMMIT;

-- Rollback:
--
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.forever_project_cover_reconcile(UUID, TEXT);
--   GRANT SELECT (
--     id, project_id, media_type, title, url, sort_order
--   ) ON public.project_media TO anon, authenticated;
--   ALTER TABLE public.project_media
--     DROP CONSTRAINT IF EXISTS project_media_semantic_role_vocabulary;
--   ALTER TABLE public.project_media DROP COLUMN IF EXISTS semantic_role;
--   COMMIT;
--
-- Rolling back does NOT re-promote a demoted cover row. Demotion is recorded in
-- `media_type` and a project's active cover is whatever `main_image_url` names,
-- so the public page is correct either way; restoring a superseded designation
-- would mean re-introducing the defect.
--
-- Dropping the column discards classifications but no source media: every
-- published asset remains in storage and every private original remains
-- retained. Re-running the publish lane restores the roles.
