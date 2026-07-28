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
-- (semantic_role)`, and issuing no REVOKE — this must never be the statement
-- that changes any other column's reachability.
--
-- ORDER OF APPLICATION MATTERS, IN ONE DIRECTION.
--
-- Ledger order applies 20260723130000_public_projection_privacy.sql before this
-- file, and then this grant is the final word and everything is correct. But
-- that migration does `REVOKE SELECT ON TABLE public.project_media FROM anon`,
-- and in PostgreSQL a column-less REVOKE removes COLUMN-level grants too. So
-- applying it AFTER this one takes `semantic_role` away again — and because
-- PostgREST fails an ENTIRE embedded select with 42703 for a column the caller
-- cannot read, the catalogue and every project page would blank together.
--
-- On a target where 20260723130000 is still pending, apply it FIRST. The
-- release gate measures this rather than trusting it:
-- `node scripts/media/role-completeness-report.mjs --stage before_backfill`
-- blocks when `anon` cannot read `semantic_role`, and blocks when `anon` CAN
-- read `metadata`.
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
-- The policy is RETIRE, not delete. A superseded cover is moved to an explicit
-- `superseded_cover` presentation state. It keeps its row, its storage object
-- and its retained private original, so no source media evidence is destroyed
-- and the change is a single UPDATE to reverse.
--
-- `superseded_cover` rather than `gallery` for two reasons, both load-bearing:
--
--   1. The reader admits `gallery` and `cover` into the photo strip
--      (project-detail-mappers.ts). Demoting to `gallery` would move a row
--      between two members of the same set — a no-op for the public page, which
--      is precisely the defect being fixed. `superseded_cover` is in neither
--      set, so the retired image leaves the strip.
--   2. `project_media`'s natural key is (project_id, media_type, url). A
--      re-published project can already hold the same URL as both `cover` and
--      `gallery`, so demoting to `gallery` would collide with a row that
--      already exists.
--
--      A distinct state does NOT make collision impossible — an earlier version
--      of this comment claimed it did, and that was wrong. A cover that returns
--      (A -> B -> A) leaves both a retired and a live row for A, and retiring A
--      again would write a duplicate. The reconciler collapses that exact
--      duplicate before retiring; see the DELETE below.
--
-- It never leaves a project cover-less: the replacement is written before this
-- runs, and the function is a no-op when no replacement is named — which
-- preserves the deliberate behaviour that a price-only enrichment must not
-- strip a good cover, and which leaves Villa Kirara correctly cover-less until
-- a safe exterior derivative exists.
--
-- Idempotent: a second run finds nothing left to retire.
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
  v_retired INTEGER := 0;
BEGIN
  -- No replacement named: leave the existing designation exactly as it is.
  IF p_cover_url IS NULL OR btrim(p_cover_url) = '' THEN
    RETURN 0;
  END IF;

  -- Only act once the replacement actually exists, so there is never a moment
  -- with no valid cover.
  IF NOT EXISTS (
    SELECT 1 FROM public.project_media
     WHERE project_id = p_project_id
       AND media_type = 'cover'
       AND url = btrim(p_cover_url)
  ) THEN
    RETURN 0;
  END IF;

  -- A cover can return. Coralina A -> B -> A leaves this project holding a
  -- `superseded_cover` row for A *and* a live `cover` row for A, and retiring A
  -- again would write a second (project_id, 'superseded_cover', A) — which
  -- `project_media_natural_key` forbids. Independent review found this; the
  -- earlier claim that "a distinct state cannot collide" was wrong.
  --
  -- The invariant that makes retirement safe: **a URL is never both the active
  -- cover and a retired one.** The incoming cover is, by definition, not
  -- superseded, so any retirement recorded for it on an earlier cycle is now
  -- obsolete and is cleared here.
  --
  -- Holding that invariant is what prevents the collision. Without it, A -> B
  -- -> A leaves `superseded_cover` A beside a live `cover` A, and the next
  -- retirement of A writes a duplicate key. With it, that state cannot form,
  -- so the UPDATE below can never collide.
  --
  -- Nothing is lost: the row removed names the same project and the same URL as
  -- the live cover row that supersedes it, so the storage object, the retained
  -- private original and the public URL are all untouched. This removes a
  -- stale *designation*, never source media evidence.
  DELETE FROM public.project_media
   WHERE project_id = p_project_id
     AND media_type = 'superseded_cover'
     AND url = btrim(p_cover_url);

  UPDATE public.project_media
     SET media_type = 'superseded_cover'
   WHERE project_id = p_project_id
     AND media_type = 'cover'
     AND url IS DISTINCT FROM btrim(p_cover_url);

  GET DIAGNOSTICS v_retired = ROW_COUNT;
  RETURN v_retired;
END;
$$;

-- ---------------------------------------------------------------------------
-- Withdraw a project's cover entirely, when the policy rejected every candidate.
--
-- `planPublicMedia` distinguishes two ways a publish can end with no hero, and
-- only one of them is a judgement:
--
--   `hero_image_missing`     — no publishable photograph was supplied at all.
--                              A price-only or document-only enrichment. The
--                              existing cover is still the best thing known and
--                              must be left alone.
--   `hero_candidate_missing` — photographs WERE supplied and the policy looked
--                              at them and determined that none depicts the
--                              property.
--
-- Only the second reaches here, and `publish.ts` expresses it by putting an
-- explicit JSON `null` at `project.set.main_image_url`.
--
-- That expression did nothing. `forever_progressive_ingest` (20260718113000)
-- writes `main_image_url = CASE WHEN v_set ? 'main_image_url' AND
-- v_set->>'main_image_url' IS NOT NULL THEN … ELSE main_image_url END` — a
-- deliberate guard so a partial batch cannot blank a column, and one that
-- discards an explicit null along with an accidental one. So the branch whose
-- own comment says "leaving the stored cover in place would make
-- `hero_candidate_missing` a report with no effect" was itself a report with no
-- effect: the rejected cover kept being served.
--
-- Same remedy as the semantic projection above, for the same reason: the ingest
-- is applied, so what it discards is re-applied afterwards rather than by
-- editing a shipped file.
--
-- The cover row is retired, not deleted, exactly as `_reconcile` retires one —
-- the storage object, the retained private original and the audit trail are
-- untouched. And the same "a URL is never both active and retired" invariant is
-- held, so retiring a cover that was already retired on an earlier cycle cannot
-- violate `project_media_natural_key`.
--
-- Idempotent: a second run finds no active cover and returns 0.
CREATE OR REPLACE FUNCTION public.forever_project_cover_withdraw(p_project_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_retired INTEGER := 0;
BEGIN
  -- Hold the invariant before the UPDATE can break it: any retirement already
  -- recorded for a URL that is currently the active cover is obsolete.
  DELETE FROM public.project_media old
   WHERE old.project_id = p_project_id
     AND old.media_type = 'superseded_cover'
     AND EXISTS (
       SELECT 1 FROM public.project_media live
        WHERE live.project_id = p_project_id
          AND live.media_type = 'cover'
          AND live.url = old.url
     );

  UPDATE public.project_media
     SET media_type = 'superseded_cover'
   WHERE project_id = p_project_id
     AND media_type = 'cover';

  GET DIAGNOSTICS v_retired = ROW_COUNT;

  -- The column and the rows must agree. Leaving the column pointing at a row
  -- that is now retired is the exact state the public reader has to defend
  -- against by joining URLs, and it should not have to.
  UPDATE public.projects
     SET main_image_url = NULL,
         updated_at = now()
   WHERE id = p_project_id
     AND main_image_url IS NOT NULL;

  RETURN v_retired;
END;
$$;

-- ---------------------------------------------------------------------------
-- Write the semantic role the Factory chose onto the public media rows.
--
-- `forever_progressive_ingest` (20260718113000) is the only writer of
-- project_media, and its media loop reads a fixed key set — project_id,
-- media_type, title, url, sort_order, metadata. An unknown `semantic_role` key
-- in the batch item is silently discarded by jsonb. That applied migration must
-- not be edited, so the role is projected here instead, immediately afterwards
-- and inside the same transaction — the precedent set by
-- forever_project_price_projection in 20260726140000.
--
-- Presence-aware: a batch item that carries no `semantic_role` never overwrites
-- a role already recorded. Matching is on the same natural key the ingest loop
-- uses, so a row is identified exactly as it was written.
CREATE OR REPLACE FUNCTION public.forever_project_media_semantic_projection(
  p_project_id UUID,
  p_media JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item JSONB;
  v_applied INTEGER := 0;
  v_rows INTEGER := 0;
BEGIN
  IF p_media IS NULL OR jsonb_typeof(p_media) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_media)
  LOOP
    CONTINUE WHEN NOT (v_item ? 'semantic_role');
    CONTINUE WHEN NULLIF(btrim(COALESCE(v_item->>'semantic_role', '')), '') IS NULL;

    UPDATE public.project_media
       SET semantic_role = btrim(v_item->>'semantic_role')
     WHERE project_id = p_project_id
       AND media_type = btrim(v_item->>'media_type')
       AND url = btrim(v_item->>'url');

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_applied := v_applied + v_rows;
  END LOOP;

  RETURN v_applied;
END;
$$;

REVOKE ALL ON FUNCTION public.forever_project_media_semantic_projection(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forever_project_media_semantic_projection(UUID, JSONB)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forever_project_media_semantic_projection(UUID, JSONB)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Re-declare forever_direct_publish with the two new steps.
--
-- Identical to 20260726140000 except for steps 4 and 5. Replaced rather than
-- altered so the shipped migration file stays byte-for-byte immutable and the
-- migrations compose in ledger order.
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
  v_priced INTEGER := 0;
  v_roles INTEGER := 0;
  v_retired INTEGER := 0;
  v_withdrawn INTEGER := 0;
  v_cover_url TEXT;
  v_options JSONB := COALESCE(options, '{}'::jsonb);
BEGIN
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
  v_summary := public.forever_progressive_ingest(batch);

  v_project_id := (v_summary->>'project_id')::uuid;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'forever_direct_publish: project_id_unresolved';
  END IF;

  -- -------- 2. publication, same transaction, this project only --------
  UPDATE public.projects
     SET public_status = 'published',
         is_active = true,
         updated_at = now()
   WHERE id = v_project_id;

  SELECT p.public_status INTO v_status
    FROM public.projects p
   WHERE p.id = v_project_id;

  IF v_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'forever_direct_publish: publication_not_applied';
  END IF;

  -- -------- 3. public price projection, same transaction --------
  v_priced := public.forever_project_price_projection(v_project_id);

  -- -------- 4. semantic roles, same transaction --------
  -- After the graph write, so the rows exist; before the function returns, so a
  -- published project is never briefly readable with its media unclassified.
  v_roles := public.forever_project_media_semantic_projection(
    v_project_id, batch->'media'
  );

  -- -------- 5. exactly one active cover, same transaction --------
  -- Only when this batch actually declares a cover. A price-only enrichment
  -- carries none and must leave the existing designation untouched.
  -- ORDER BY, not just LIMIT 1. `planPublicMedia` emits exactly one cover, so
  -- in practice the set has one element — but "in practice" is how the rest of
  -- this file's defects were argued. An unordered LIMIT 1 over a malformed or
  -- hand-built batch picks an arbitrary cover, retires the other, and does it
  -- differently on a replay. Ordering by the URL makes the choice a stated one
  -- and the whole publish replayable.
  SELECT btrim(m->>'url') INTO v_cover_url
    FROM jsonb_array_elements(COALESCE(batch->'media', '[]'::jsonb)) AS m
   WHERE btrim(m->>'media_type') = 'cover'
   ORDER BY btrim(m->>'url')
   LIMIT 1;

  v_retired := public.forever_project_cover_reconcile(v_project_id, v_cover_url);

  -- -------- 6. an explicitly withdrawn cover, same transaction --------
  -- Only on the explicit signal — a JSON `null` the caller wrote at
  -- `project.set.main_image_url` — and only when this batch names no
  -- replacement cover. `jsonb_typeof` is what separates "the key is present and
  -- its value is null" from "the key is absent", which `->>` collapses together
  -- and which is why the ingest could not act on it.
  IF v_cover_url IS NULL
     AND jsonb_typeof(batch->'project'->'set'->'main_image_url') = 'null' THEN
    v_withdrawn := public.forever_project_cover_withdraw(v_project_id);
  END IF;

  RETURN v_summary
         || jsonb_build_object(
              'public_status', v_status,
              'direct_published', true,
              'public_prices_projected', v_priced,
              'semantic_roles_applied', v_roles,
              'covers_retired', v_retired,
              'covers_withdrawn', v_withdrawn,
              'source_trust', v_options->>'source_trust',
              'publication_mode', v_options->>'publication_mode'
            );
END;
$$;

REVOKE ALL ON FUNCTION public.forever_project_cover_reconcile(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forever_project_cover_reconcile(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forever_project_cover_reconcile(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.forever_project_cover_withdraw(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forever_project_cover_withdraw(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forever_project_cover_withdraw(UUID) TO service_role;

COMMENT ON FUNCTION public.forever_project_cover_reconcile(UUID, TEXT) IS
  'Retires superseded cover rows of one project to media_type = superseded_cover '
  'so exactly one active cover remains. Deliberately NOT gallery: the public '
  'reader admits both cover and gallery, so moving a row between them would be '
  'invisible, and (project_id, media_type, url) could collide with an existing '
  'gallery row. Deletes exactly one thing: a retirement already recorded for the '
  'incoming cover, which is obsolete the moment that URL is active again. That '
  'holds the invariant "a URL is never both the active cover and a retired one", '
  'without which a returning cover violates project_media_natural_key. No source '
  'media is ever deleted. No-op when no replacement cover is named, and no-op '
  'until the replacement row exists, so an enrichment run cannot strip a good '
  'cover and a project is never briefly cover-less.';

COMMENT ON FUNCTION public.forever_project_cover_withdraw(UUID) IS
  'Retires EVERY active cover of one project and clears projects.main_image_url, '
  'for the single case where the hero policy examined the supplied photographs '
  'and determined that none depicts the property. Invoked only on an explicit '
  'JSON null at project.set.main_image_url, which forever_progressive_ingest '
  'discards by design — so without this step hero_candidate_missing was a report '
  'with no effect and the rejected cover kept being served. Retires, never '
  'deletes media: the storage object and the retained private original are '
  'untouched.';

COMMENT ON COLUMN public.project_media.semantic_role IS
  'What the image depicts, from the fixed vocabulary in hero-policy.ts. '
  'Presentation data only — never provenance. NULL means no classification was '
  'recorded, which readers must treat as "show it", not "hide it".';

COMMIT;

-- Rollback:
--
--   BEGIN;
--   -- Restore forever_direct_publish from 20260726140000 verbatim first.
--   DROP FUNCTION IF EXISTS public.forever_project_media_semantic_projection(UUID, JSONB);
--   DROP FUNCTION IF EXISTS public.forever_project_cover_reconcile(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.forever_project_cover_withdraw(UUID);
--   UPDATE public.project_media pm SET media_type = 'cover'
--     WHERE pm.media_type = 'superseded_cover'
--       AND NOT EXISTS (
--         SELECT 1 FROM public.project_media live
--          WHERE live.project_id = pm.project_id
--            AND live.media_type = 'cover'
--            AND live.url = pm.url
--       );
--   -- The NOT EXISTS guard is required, not defensive. An unguarded restore
--   -- violates project_media_natural_key the moment any project holds both a
--   -- live cover and a retired row for the same URL, which two publishes can
--   -- produce. A row it skips keeps media_type = 'superseded_cover': its
--   -- current cover already carries that URL, so nothing is lost.
--   -- This statement is deliberately unscoped — a rollback reverses the whole
--   -- migration. Add `AND pm.project_id = '<uuid>'` to reverse one project.
--   GRANT SELECT (
--     id, project_id, media_type, title, url, sort_order
--   ) ON public.project_media TO anon, authenticated;
--   ALTER TABLE public.project_media
--     DROP CONSTRAINT IF EXISTS project_media_semantic_role_vocabulary;
--   ALTER TABLE public.project_media DROP COLUMN IF EXISTS semantic_role;
--   COMMIT;
--
-- The rollback restores every `superseded_cover` row to `cover`, because the
-- `superseded_cover` value only has meaning while this migration's reader and
-- reconciler are in place. That deliberately re-introduces the two-cover state
-- the migration corrects — which is what a rollback is for. A project's
-- displayed cover is whatever `main_image_url` names either way, so the hero
-- slot stays correct; what returns is the superseded row's visibility in the
-- photo strip.
--
-- Dropping the column discards classifications but no source media: every
-- published asset remains in storage and every private original remains
-- retained. Re-running the publish lane restores the roles.
