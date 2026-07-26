-- FOREVER-PRODUCTION-ACTIVATION-001: public unit-price projection.
--
-- WHY THIS EXISTS
-- ---------------
-- A public project page must show each unit's current official price. The
-- authoritative record is `public.unit_price_history`, but that table carries
-- `source_file`, `source_page`, `price_source` and a `metadata` blob holding
-- repository paths, Telegram message URLs and currency-decision provenance.
-- `20260723130000_public_projection_privacy.sql` therefore revokes it from
-- anon/authenticated entirely, and that revocation is NOT relaxed here.
--
-- Instead this migration takes the projection route: the direct-publish
-- transaction mirrors the ONE current price per unit into
-- `public.units.base_price_thb`, an existing column the public projection
-- already grants and the Project Detail page already selects. No new public
-- surface, no provenance exposure, no view or RPC for anonymous callers.
--
-- SAFETY BOUNDARY
-- ---------------
--   * Additive. `20260726120000_forever_direct_publish.sql` is not edited;
--     `forever_direct_publish` is replaced in place so the two compose.
--   * The projection is scoped to ONE project id. It can never read or write
--     another project's units.
--   * It runs inside the existing direct-publish transaction, so the graph
--     write, the publication and the public price all land together or not
--     at all.
--   * It only ever UPDATEs `units`. It inserts no price row, so an exact
--     package replay produces no duplicate history and no second current price.
--   * `unit_price_history` gains no grant. Anonymous access to it stays revoked.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Close the `buildings` provenance leak, and expose only the building code.
--
-- `20260723130000` restricted projects, developers, units, project_media and
-- investment_data to their public presentation columns but left `buildings`
-- with the broad table grant from `20260707101000`. Progressive ingestion
-- writes `buildings.metadata.field_provenance.*.source_ref`, which for the
-- packages being published now contains the Owner's private Google Drive file
-- URLs. Publishing a project would make those anonymously readable.
--
-- The same REVOKE-then-column-GRANT shape as the privacy migration is used, so
-- the public contract stays one consistent rule. `metadata` is excluded.
-- ----------------------------------------------------------------------------
REVOKE SELECT ON TABLE public.buildings FROM anon, authenticated;
GRANT SELECT (
  id, project_id, name, building_code, description, building_type,
  floors_count, units_count, construction_status, completion_date, sort_order
) ON public.buildings TO anon, authenticated;

-- The Project Detail page resolves a unit's building through this foreign key.
-- It is an opaque surrogate id carrying no provenance. Granting it lets the
-- public read join units to the building code above; without it the column
-- grant made by the privacy migration would make the join unreadable.
GRANT SELECT (building_id) ON public.units TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. The projection itself.
--
-- "Current price" is the newest recorded row per unit, decided by
-- price_list_date first (the developer's own effective date), then by
-- recorded_at / created_at / id so the choice is total and deterministic even
-- when two rows share a date.
--
-- Currency is respected rather than assumed. `base_price_thb` is a THB column,
-- so a price whose recorded currency is NOT THB — including the NULL the
-- progressive ingest deliberately writes when the currency is unknown — is
-- projected as NULL. The page then honestly renders no price instead of
-- restating a foreign amount as baht. `upper(btrim(NULL)) = 'THB'` is NULL,
-- which the CASE treats as not-THB, so the NULL currency case needs no special
-- branch.
--
-- Units with no price history at all are untouched, so a price already set by
-- another import path is never blanked by a publication that carries no price.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forever_project_price_projection(p_project_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'forever_project_price_projection: project_id_required';
  END IF;

  WITH current_price AS (
    SELECT DISTINCT ON (h.unit_id)
           h.unit_id,
           h.price,
           h.currency
      FROM public.unit_price_history h
      JOIN public.units u ON u.id = h.unit_id
     WHERE u.project_id = p_project_id
     ORDER BY h.unit_id,
              h.price_list_date DESC NULLS LAST,
              h.recorded_at DESC,
              h.created_at DESC,
              h.id DESC
  )
  UPDATE public.units u
     SET base_price_thb = CASE
           WHEN upper(btrim(c.currency)) = 'THB' THEN c.price
           ELSE NULL
         END
    FROM current_price c
   WHERE u.id = c.unit_id
     AND u.project_id = p_project_id
     -- Idempotence: an unchanged price is not rewritten, so a replay reports 0.
     AND u.base_price_thb IS DISTINCT FROM (
           CASE WHEN upper(btrim(c.currency)) = 'THB' THEN c.price ELSE NULL END
         );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.forever_project_price_projection(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forever_project_price_projection(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.forever_project_price_projection(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forever_project_price_projection(UUID) TO service_role;

COMMENT ON FUNCTION public.forever_project_price_projection(UUID) IS
  'FOREVER-PRODUCTION-ACTIVATION-001: mirror each unit''s current THB price from '
  'unit_price_history into the public-safe units.base_price_thb, for one project. '
  'Never grants public access to the private history table. service_role only.';

-- ----------------------------------------------------------------------------
-- 3. Re-declare forever_direct_publish with the projection step.
--
-- Identical to 20260726120000 except for step 3. Replaced rather than altered
-- so the shipped migration file stays byte-for-byte immutable and the two
-- migrations compose in ledger order.
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
  v_priced INTEGER := 0;
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
  -- Runs after the graph write so it sees this batch's prices, and before the
  -- function returns so a published project never sits in a state where its
  -- units are public but their prices are not.
  v_priced := public.forever_project_price_projection(v_project_id);

  RETURN v_summary
         || jsonb_build_object(
              'public_status', v_status,
              'direct_published', true,
              'public_prices_projected', v_priced,
              'source_trust', v_options->>'source_trust',
              'publication_mode', v_options->>'publication_mode'
            );
END;
$$;

REVOKE ALL ON FUNCTION public.forever_direct_publish(JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forever_direct_publish(JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.forever_direct_publish(JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forever_direct_publish(JSONB, JSONB) TO service_role;

COMMENT ON FUNCTION public.forever_direct_publish(JSONB, JSONB) IS
  'FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001 + FOREVER-PRODUCTION-ACTIVATION-001: '
  'atomic Owner-authorized ingest + publish + public THB price projection. '
  'No persisted draft on success, nothing public on failure. service_role only.';

COMMIT;

-- Rollback:
--   -- restore the pre-projection publish function
--   \i supabase/migrations/20260726120000_forever_direct_publish.sql
--   DROP FUNCTION IF EXISTS public.forever_project_price_projection(UUID);
--   REVOKE SELECT (building_id) ON public.units FROM anon, authenticated;
--   GRANT SELECT ON TABLE public.buildings TO anon, authenticated;
-- Dropping the projection stops future publications from refreshing
-- units.base_price_thb; it changes no price already projected and removes no
-- history row.
