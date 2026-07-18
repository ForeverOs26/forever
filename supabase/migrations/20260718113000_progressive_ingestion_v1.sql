-- ============================================================================
-- PROGRESSIVE INGESTION — FINAL MIGRATION DRAFT (not applied)
--
-- Promoted after full-chain validation in an isolated local Supabase
-- PostgreSQL 17.6 database. This repository migration has NOT been applied
-- to any linked or production database.
-- The static test suite src/features/forever-ingestion/tests/
-- migration-contract.test.ts asserts this file's security and behavior
-- contract verbatim.
--
-- Scope: the progressive ingestion lane (default for ALL ordinary imports,
-- any row count) — raw dependency fallbacks, per-field provenance, resale
-- listings, persisted warnings, batch idempotency, one atomic batch RPC,
-- and full publication isolation. No object under forever_import /
-- forever_execution is touched; the strict lane is unchanged.
--
-- FLAGGED STATEMENTS (each verified against the in-repo migration chain;
-- Codex re-verifies against the live schema inventory before scheduling):
--   [F1] projects public SELECT policy now requires public_status='published'.
--        A one-time backfill publishes exactly the rows that are publicly
--        visible TODAY under the old is_active-only rule, so integration
--        removes nothing from the website and requires no per-row decision.
--        Future progressive creates default to public_status='draft'.
--   [F2] Every project-scoped public child SELECT policy is tightened to a
--        published active parent in this same migration (18 tables).
--   [F3] projects.forever_verified default true -> false.
--   [F4] unit_price_history.currency drops DEFAULT 'THB' and NOT NULL.
--        Verified safe: the strict boundary validates currency as a JSON
--        string and inserts it explicitly
--        (20260715120000_rc55d_import_execution_boundary.sql lines ~717,
--        ~1059-1062), and the legacy TS writer supplies row.currency
--        explicitly (src/import/persistence-projection.ts). Existing rows
--        keep their stored 'THB'.
--   [F5] UNIQUE index on project_media(project_id, media_type, url) for
--        idempotent media replays. Pre-check production for duplicates; if
--        any exist, dedup is an owner-approved correction (strict-lane
--        class) before this migration.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. projects: raw dependency fallbacks + per-field provenance
-- ----------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS developer_name_raw TEXT,
  ADD COLUMN IF NOT EXISTS location_name_raw TEXT,
  ADD COLUMN IF NOT EXISTS field_provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.projects.developer_name_raw IS
  'Verbatim source developer name; retained even after developer_id is linked.';
COMMENT ON COLUMN public.projects.location_name_raw IS
  'Verbatim source location text; location_area remains the curated display label.';
COMMENT ON COLUMN public.projects.field_provenance IS
  'Per-column provenance map: {"<column>": {status, source_type, source_ref, source_date, supplied_at, checked_at, confidence, note}}.';

ALTER TABLE public.project_media
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.project_media.metadata IS
  'Progressive ingestion metadata, including per-field provenance for title and sort_order.';

CREATE INDEX IF NOT EXISTS idx_projects_developer_unresolved
  ON public.projects(developer_name_raw)
  WHERE developer_id IS NULL AND developer_name_raw IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_location_unresolved
  ON public.projects(location_name_raw)
  WHERE location_id IS NULL AND location_name_raw IS NOT NULL;

-- [F3] progressive drafts are never born "Forever verified".
ALTER TABLE public.projects
  ALTER COLUMN forever_verified SET DEFAULT false;

-- ----------------------------------------------------------------------------
-- 2. Publication isolation with safe visibility preservation
-- ----------------------------------------------------------------------------
-- [F1] Backfill FIRST: every row publicly visible under the old rule
-- (is_active = true) keeps its visibility by becoming 'published'.
-- Inactive rows are neither activated nor published.
UPDATE public.projects
  SET public_status = 'published'
  WHERE is_active = true AND public_status IS DISTINCT FROM 'published';

DROP POLICY IF EXISTS "Active projects are viewable by everyone" ON public.projects;
CREATE POLICY "Published projects are viewable by everyone"
  ON public.projects FOR SELECT
  USING (is_active = true AND public_status = 'published');

-- [F2] Project-scoped child tables: public reads require a published active
-- parent. Tables covered (policy names taken verbatim from the migration
-- chain): units, project_media, investment_data, buildings,
-- unit_price_history, project_facilities, sources, project_assets,
-- documents, images, videos, project_intelligence, project_translations,
-- project_status_history, project_tags, project_amenities, nearby_places,
-- project_seo.
-- Deliberately NOT changed (justified as not project-specific):
--   developers, locations, developer_translations, tags, amenities,
--   facilities (master/reference data); leads (INSERT-only for the public,
--   no SELECT policy); price_updates / audit_log / ingestion_* (no public
--   policy at all); storage.objects bucket policies (bucket-wide, out of
--   scope here — noted in the report).

DROP POLICY IF EXISTS "Units of active projects are viewable by everyone" ON public.units;
CREATE POLICY "Units of published projects are viewable by everyone"
  ON public.units FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = units.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Media of active projects is viewable by everyone" ON public.project_media;
CREATE POLICY "Media of published projects is viewable by everyone"
  ON public.project_media FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = project_media.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Investment data of active projects is viewable by everyone" ON public.investment_data;
CREATE POLICY "Investment data of published projects is viewable by everyone"
  ON public.investment_data FOR SELECT USING (
    (project_id IS NULL OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = investment_data.project_id
        AND p.is_active = true AND p.public_status = 'published'))
    AND (unit_id IS NULL OR EXISTS (
      SELECT 1 FROM public.units u JOIN public.projects p ON p.id = u.project_id
      WHERE u.id = investment_data.unit_id
        AND p.is_active = true AND p.public_status = 'published'))
  );

DROP POLICY IF EXISTS "Buildings of active projects are viewable" ON public.buildings;
CREATE POLICY "Buildings of published projects are viewable"
  ON public.buildings FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = buildings.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Price history of active project units is viewable" ON public.unit_price_history;
CREATE POLICY "Price history of published project units is viewable"
  ON public.unit_price_history FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.units u JOIN public.projects p ON p.id = u.project_id
            WHERE u.id = unit_price_history.unit_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Facilities of active projects are viewable" ON public.project_facilities;
CREATE POLICY "Facilities of published projects are viewable"
  ON public.project_facilities FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = project_facilities.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public sources for active projects are viewable" ON public.sources;
CREATE POLICY "Public sources for published projects are viewable"
  ON public.sources FOR SELECT USING (
    is_public = true
    AND (sources.project_id IS NULL OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = sources.project_id
        AND p.is_active = true AND p.public_status = 'published'))
  );

DROP POLICY IF EXISTS "Public assets of active projects are viewable" ON public.project_assets;
CREATE POLICY "Public assets of published projects are viewable"
  ON public.project_assets FOR SELECT USING (
    is_public = true
    AND EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = project_assets.project_id
                  AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public documents of active projects are viewable" ON public.documents;
CREATE POLICY "Public documents of published projects are viewable"
  ON public.documents FOR SELECT USING (
    is_public = true
    AND EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = documents.project_id
                  AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public images of active projects are viewable" ON public.images;
CREATE POLICY "Public images of published projects are viewable"
  ON public.images FOR SELECT USING (
    is_public = true
    AND EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = images.project_id
                  AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public videos of active projects are viewable" ON public.videos;
CREATE POLICY "Public videos of published projects are viewable"
  ON public.videos FOR SELECT USING (
    is_public = true
    AND EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = videos.project_id
                  AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Current published intelligence is viewable" ON public.project_intelligence;
CREATE POLICY "Current published intelligence of published projects is viewable"
  ON public.project_intelligence FOR SELECT USING (
    is_current = true
    AND published_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = project_intelligence.project_id
                  AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public read project translations" ON public.project_translations;
CREATE POLICY "Translations of published projects are viewable"
  ON public.project_translations FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = project_translations.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public read status history" ON public.project_status_history;
CREATE POLICY "Status history of published projects is viewable"
  ON public.project_status_history FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = project_status_history.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public read project tags" ON public.project_tags;
CREATE POLICY "Tags of published projects are viewable"
  ON public.project_tags FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = project_tags.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public read project amenities" ON public.project_amenities;
CREATE POLICY "Amenities of published projects are viewable"
  ON public.project_amenities FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = project_amenities.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public read nearby places" ON public.nearby_places;
CREATE POLICY "Nearby places of published projects are viewable"
  ON public.nearby_places FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = nearby_places.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

DROP POLICY IF EXISTS "Public read project seo" ON public.project_seo;
CREATE POLICY "SEO of published projects is viewable"
  ON public.project_seo FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p
            WHERE p.id = project_seo.project_id
              AND p.is_active = true AND p.public_status = 'published')
  );

-- ----------------------------------------------------------------------------
-- 3. Idempotent media replays need a natural key  [F5]
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS project_media_natural_key
  ON public.project_media(project_id, media_type, url);

-- ----------------------------------------------------------------------------
-- 4. Currency truthfulness  [F4]
-- ----------------------------------------------------------------------------
ALTER TABLE public.unit_price_history
  ALTER COLUMN currency DROP DEFAULT,
  ALTER COLUMN currency DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. listings: minimal resale entity (draft by default, currency truthful)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'resale' CHECK (kind IN ('resale')),
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  project_name_raw TEXT,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  location_name_raw TEXT,
  property_type TEXT,
  bedrooms INTEGER CHECK (bedrooms IS NULL OR bedrooms >= 0),
  bathrooms INTEGER CHECK (bathrooms IS NULL OR bathrooms >= 0),
  area_sqm NUMERIC(10,2) CHECK (area_sqm IS NULL OR area_sqm > 0),
  price NUMERIC(14,2) CHECK (price IS NULL OR price >= 0),
  -- NULLABLE, NO DEFAULT: THB only when owner-supplied, source-explicit, or
  -- deliberately inferred with provenance status 'inferred'.
  currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  availability_status TEXT NOT NULL DEFAULT 'available',
  description TEXT,
  photos TEXT[] NOT NULL DEFAULT '{}',
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  field_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  publication_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.listings TO anon, authenticated;
GRANT ALL ON public.listings TO service_role;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published listings are viewable by everyone"
  ON public.listings FOR SELECT
  USING (publication_status = 'published');

CREATE TRIGGER trg_listings_updated_at
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_listings_project_id ON public.listings(project_id);
CREATE INDEX IF NOT EXISTS idx_listings_location_id ON public.listings(location_id);
CREATE INDEX IF NOT EXISTS idx_listings_publication_status ON public.listings(publication_status);
CREATE INDEX IF NOT EXISTS idx_listings_price ON public.listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_project_unresolved
  ON public.listings(project_name_raw)
  WHERE project_id IS NULL AND project_name_raw IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. ingestion_warnings: persisted review queue (internal-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingestion_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES public.listings(id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN (
    'project', 'listing', 'developer', 'location',
    'building', 'unit', 'price', 'media', 'document'
  )),
  field TEXT,
  code TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning')),
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  -- exactly one scope, never both, never neither
  CONSTRAINT ingestion_warnings_scope CHECK (
    ((project_id IS NOT NULL)::int + (listing_id IS NOT NULL)::int) = 1
  )
);

GRANT ALL ON public.ingestion_warnings TO service_role;
ALTER TABLE public.ingestion_warnings ENABLE ROW LEVEL SECURITY;
-- RLS on, no policies: internal-only (audit_log pattern).

CREATE INDEX IF NOT EXISTS idx_ingestion_warnings_project_status
  ON public.ingestion_warnings(project_id, status);
CREATE INDEX IF NOT EXISTS idx_ingestion_warnings_listing_status
  ON public.ingestion_warnings(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_ingestion_warnings_code
  ON public.ingestion_warnings(code);

-- ----------------------------------------------------------------------------
-- 7. ingestion_batches: idempotency + audit (internal-only)
--
-- batch_fingerprint = the CLIENT-supplied idempotency key (sha256 hex).
-- payload_hash      = the SERVER-computed content hash. Canonical input:
--                     PostgreSQL's deterministic jsonb text serialization of
--                     (batch - 'batch_fingerprint'), UTF-8 encoded, hashed
--                     with the built-in sha256() — the same digest convention
--                     the RC5.5D boundary already uses. The client hash is
--                     never trusted for content identity.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingestion_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  batch_fingerprint TEXT NOT NULL CHECK (batch_fingerprint ~ '^[0-9a-f]{64}$'),
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  mode TEXT NOT NULL CHECK (mode IN ('create', 'enrich')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, batch_fingerprint)
);

GRANT ALL ON public.ingestion_batches TO service_role;
ALTER TABLE public.ingestion_batches ENABLE ROW LEVEL SECURITY;
-- RLS on, no policies: internal-only.

CREATE INDEX IF NOT EXISTS idx_ingestion_batches_project
  ON public.ingestion_batches(project_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 8. The progressive transactional batch boundary
--
-- One ordinary Postgres function = one atomic transaction. Called only by
-- the owner's server-side tooling with the service role. NOT SECURITY
-- DEFINER, no approval, no lock, no receipt, no expiry, no package pinning:
-- this is the normal lane for routine imports of any size, including a
-- Coralina-scale ~405-row batch.
--
-- Guarantees:
--   * atomicity/rollback: any raised exception aborts every write;
--   * duplicate protection: mode 'create' refuses an existing slug unless
--     the call is an exact replay of the batch that created it;
--   * idempotency: same (project, batch_fingerprint) with the same
--     server-computed payload_hash returns the stored summary (replayed);
--     the same fingerprint with different content is a hard
--     fingerprint_payload_mismatch failure;
--   * cross-project protection: every child statement is keyed by the one
--     project id resolved from the batch slug; prices resolve units only
--     within that project; buildings resolve only within that project;
--   * presence-aware enrichment: an omitted or null property NEVER
--     overwrites existing data — field-level precedence (owner_verified
--     protection) is enforced by the TypeScript builder, which strips
--     rejected values and records field_conflict warnings; the SQL boundary
--     guarantees omission can never bypass that filter;
--   * partial-data acceptance: business gaps are warnings, not rejections.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forever_progressive_ingest(batch JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_mode TEXT;
  v_project JSONB;
  v_set JSONB;
  v_slug TEXT;
  v_fingerprint TEXT;
  v_payload_hash TEXT;
  v_stored_hash TEXT;
  v_stored_summary JSONB;
  v_project_id UUID;
  v_item JSONB;
  v_code TEXT;
  v_building_ids JSONB := '{}'::jsonb;
  v_unit_ids JSONB := '{}'::jsonb;
  v_building_id UUID;
  v_unit_id UUID;
  v_row_id UUID;
  v_buildings INT := 0;
  v_units INT := 0;
  v_prices INT := 0;
  v_media INT := 0;
  v_warnings INT := 0;
  v_summary JSONB;
BEGIN
  -- -------- technical envelope checks (hard blockers only) --------
  IF batch IS NULL OR jsonb_typeof(batch) <> 'object' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: batch_malformed';
  END IF;
  IF batch->>'schema_version' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: schema_version_unsupported';
  END IF;
  IF batch ? 'buildings' AND jsonb_typeof(batch->'buildings') <> 'array' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: buildings_malformed';
  END IF;
  IF batch ? 'units' AND jsonb_typeof(batch->'units') <> 'array' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: units_malformed';
  END IF;
  IF batch ? 'prices' AND jsonb_typeof(batch->'prices') <> 'array' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: prices_malformed';
  END IF;
  IF batch ? 'media' AND jsonb_typeof(batch->'media') <> 'array' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: media_malformed';
  END IF;
  IF batch ? 'warnings' AND jsonb_typeof(batch->'warnings') <> 'array' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: warnings_malformed';
  END IF;
  v_mode := batch->>'mode';
  IF v_mode IS NULL OR (v_mode <> 'create' AND v_mode <> 'enrich') THEN
    RAISE EXCEPTION 'forever_progressive_ingest: mode_invalid';
  END IF;
  v_project := batch->'project';
  IF v_project IS NULL OR jsonb_typeof(v_project) <> 'object' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: project_missing';
  END IF;
  v_slug := NULLIF(trim(v_project->>'slug'), '');
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'forever_progressive_ingest: project_slug_required';
  END IF;
  v_fingerprint := batch->>'batch_fingerprint';
  IF v_fingerprint IS NULL OR v_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: batch_fingerprint_invalid';
  END IF;

  -- Server-computed content hash. The client fingerprint is only the
  -- idempotency KEY; content identity is decided by this hash alone.
  v_payload_hash := encode(sha256(convert_to((batch - 'batch_fingerprint')::text, 'UTF8')), 'hex');

  SELECT id INTO v_project_id FROM public.projects WHERE slug = v_slug;

  -- -------- idempotency, duplicate and target-identity protection --------
  IF v_project_id IS NOT NULL THEN
    SELECT payload_hash, summary INTO v_stored_hash, v_stored_summary
      FROM public.ingestion_batches
      WHERE project_id = v_project_id AND batch_fingerprint = v_fingerprint;
    IF v_stored_hash IS NOT NULL THEN
      IF v_stored_hash = v_payload_hash THEN
        -- exact replay of an already-completed batch (create OR enrich)
        RETURN v_stored_summary || jsonb_build_object('replayed', true);
      END IF;
      -- an old idempotency key must never smuggle changed content
      RAISE EXCEPTION 'forever_progressive_ingest: fingerprint_payload_mismatch';
    END IF;
    IF v_mode = 'create' THEN
      -- the slug exists and this batch is NOT the one that created it
      RAISE EXCEPTION 'forever_progressive_ingest: project_slug_exists';
    END IF;
  ELSIF v_mode = 'enrich' THEN
    RAISE EXCEPTION 'forever_progressive_ingest: project_not_found';
  END IF;

  -- -------- project row --------
  IF v_mode = 'create' THEN
    IF NULLIF(trim(v_project->>'name'), '') IS NULL THEN
      RAISE EXCEPTION 'forever_progressive_ingest: project_name_required';
    END IF;
    INSERT INTO public.projects (
      name, slug,
      developer_id, location_id,
      developer_name_raw, location_name_raw, location_area,
      project_type, address, short_description, full_description,
      construction_status, ownership_type, completion_date,
      latitude, longitude, main_image_url, brochure_url,
      starting_price_thb, price_range,
      public_status, is_active, forever_verified,
      field_provenance
    ) VALUES (
      trim(v_project->>'name'), v_slug,
      (v_project->>'developer_id')::uuid, (v_project->>'location_id')::uuid,
      v_project->>'developer_name_raw', v_project->>'location_name_raw',
      v_project->>'location_area',
      v_project->>'project_type', v_project->>'address',
      v_project->>'short_description', v_project->>'full_description',
      v_project->>'construction_status', v_project->>'ownership_type',
      (v_project->>'completion_date')::date,
      (v_project->>'latitude')::numeric, (v_project->>'longitude')::numeric,
      v_project->>'main_image_url', v_project->>'brochure_url',
      (v_project->>'starting_price_thb')::bigint, v_project->>'price_range',
      'draft',                       -- saved, NEVER auto-published
      true,
      false,                         -- never born Forever-verified
      COALESCE(v_project->'field_provenance', '{}'::jsonb)
    ) RETURNING id INTO v_project_id;
  ELSE
    -- Presence-aware patch: only keys explicitly present in `set` with a
    -- non-null value are applied. Precedence filtering happened in the
    -- TypeScript builder; an omitted key can never overwrite anything.
    v_set := COALESCE(v_project->'set', '{}'::jsonb);
    UPDATE public.projects SET
      name = CASE WHEN v_set ? 'name' AND NULLIF(trim(v_set->>'name'), '') IS NOT NULL
                  THEN trim(v_set->>'name') ELSE name END,
      developer_id = CASE WHEN v_set ? 'developer_id' AND v_set->>'developer_id' IS NOT NULL
                          THEN (v_set->>'developer_id')::uuid ELSE developer_id END,
      location_id = CASE WHEN v_set ? 'location_id' AND v_set->>'location_id' IS NOT NULL
                         THEN (v_set->>'location_id')::uuid ELSE location_id END,
      developer_name_raw = CASE WHEN v_set ? 'developer_name_raw' AND v_set->>'developer_name_raw' IS NOT NULL
                                THEN v_set->>'developer_name_raw' ELSE developer_name_raw END,
      location_name_raw = CASE WHEN v_set ? 'location_name_raw' AND v_set->>'location_name_raw' IS NOT NULL
                               THEN v_set->>'location_name_raw' ELSE location_name_raw END,
      location_area = CASE WHEN v_set ? 'location_area' AND v_set->>'location_area' IS NOT NULL
                           THEN v_set->>'location_area' ELSE location_area END,
      project_type = CASE WHEN v_set ? 'project_type' AND v_set->>'project_type' IS NOT NULL
                          THEN v_set->>'project_type' ELSE project_type END,
      address = CASE WHEN v_set ? 'address' AND v_set->>'address' IS NOT NULL
                     THEN v_set->>'address' ELSE address END,
      short_description = CASE WHEN v_set ? 'short_description' AND v_set->>'short_description' IS NOT NULL
                               THEN v_set->>'short_description' ELSE short_description END,
      full_description = CASE WHEN v_set ? 'full_description' AND v_set->>'full_description' IS NOT NULL
                              THEN v_set->>'full_description' ELSE full_description END,
      construction_status = CASE WHEN v_set ? 'construction_status' AND v_set->>'construction_status' IS NOT NULL
                                 THEN v_set->>'construction_status' ELSE construction_status END,
      ownership_type = CASE WHEN v_set ? 'ownership_type' AND v_set->>'ownership_type' IS NOT NULL
                            THEN v_set->>'ownership_type' ELSE ownership_type END,
      completion_date = CASE WHEN v_set ? 'completion_date' AND v_set->>'completion_date' IS NOT NULL
                             THEN (v_set->>'completion_date')::date ELSE completion_date END,
      latitude = CASE WHEN v_set ? 'latitude' AND v_set->>'latitude' IS NOT NULL
                      THEN (v_set->>'latitude')::numeric ELSE latitude END,
      longitude = CASE WHEN v_set ? 'longitude' AND v_set->>'longitude' IS NOT NULL
                       THEN (v_set->>'longitude')::numeric ELSE longitude END,
      main_image_url = CASE WHEN v_set ? 'main_image_url' AND v_set->>'main_image_url' IS NOT NULL
                            THEN v_set->>'main_image_url' ELSE main_image_url END,
      brochure_url = CASE WHEN v_set ? 'brochure_url' AND v_set->>'brochure_url' IS NOT NULL
                          THEN v_set->>'brochure_url' ELSE brochure_url END,
      starting_price_thb = CASE WHEN v_set ? 'starting_price_thb' AND v_set->>'starting_price_thb' IS NOT NULL
                                THEN (v_set->>'starting_price_thb')::bigint ELSE starting_price_thb END,
      price_range = CASE WHEN v_set ? 'price_range' AND v_set->>'price_range' IS NOT NULL
                         THEN v_set->>'price_range' ELSE price_range END,
      public_status = CASE WHEN (v_project->>'publish') = 'true' THEN 'published'
                           WHEN (v_project->>'publish') = 'false' THEN 'draft'
                           ELSE public_status END,
      field_provenance = field_provenance || COALESCE(v_project->'field_provenance', '{}'::jsonb),
      last_data_review_at = now(),
      updated_at = now()
    WHERE id = v_project_id;
  END IF;

  -- -------- buildings (natural key: project_id + building_code) --------
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(batch->'buildings', '[]'::jsonb))
  LOOP
    v_code := NULLIF(trim(v_item->>'building_code'), '');
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'forever_progressive_ingest: building_code_required';
    END IF;
    SELECT id INTO v_building_id FROM public.buildings
      WHERE project_id = v_project_id AND building_code = v_code;
    IF v_building_id IS NULL THEN
      -- "Building <code>" is a fallback for NEW rows only.
      INSERT INTO public.buildings (project_id, building_code, name, floors_count, units_count, metadata)
      VALUES (
        v_project_id, v_code,
        COALESCE(NULLIF(trim(v_item->>'name'), ''), 'Building ' || v_code),
        (v_item->>'floors_count')::int,
        (v_item->>'units_count')::int,
        COALESCE(v_item->'metadata', '{}'::jsonb)
      ) RETURNING id INTO v_building_id;
    ELSE
      -- Presence-aware: a curated name is never overwritten by a fallback
      -- or by an omitted property.
      UPDATE public.buildings SET
        name = CASE WHEN v_item ? 'name' AND NULLIF(trim(v_item->>'name'), '') IS NOT NULL
                    THEN trim(v_item->>'name') ELSE name END,
        floors_count = CASE WHEN v_item ? 'floors_count' AND v_item->>'floors_count' IS NOT NULL
                            THEN (v_item->>'floors_count')::int ELSE floors_count END,
        units_count = CASE WHEN v_item ? 'units_count' AND v_item->>'units_count' IS NOT NULL
                           THEN (v_item->>'units_count')::int ELSE units_count END,
        metadata = metadata
          || (COALESCE(v_item->'metadata', '{}'::jsonb) - 'field_provenance')
          || jsonb_build_object('field_provenance',
               COALESCE(metadata->'field_provenance', '{}'::jsonb)
               || COALESCE(v_item->'metadata'->'field_provenance', '{}'::jsonb)),
        updated_at = now()
      WHERE id = v_building_id;
    END IF;
    v_building_ids := v_building_ids || jsonb_build_object(v_code, v_building_id::text);
    v_buildings := v_buildings + 1;
  END LOOP;

  -- -------- units (natural key: project_id + unit_code) --------
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(batch->'units', '[]'::jsonb))
  LOOP
    v_code := NULLIF(trim(v_item->>'unit_code'), '');
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'forever_progressive_ingest: unit_code_required';
    END IF;

    -- Building resolution: batch first, then this project's existing
    -- buildings, never another project's. Unresolved => NULL + warning
    -- (units.building_id is nullable by schema).
    v_building_id := NULL;
    IF v_item->>'building_code' IS NOT NULL THEN
      v_building_id := (v_building_ids->>(v_item->>'building_code'))::uuid;
      IF v_building_id IS NULL THEN
        SELECT id INTO v_building_id FROM public.buildings
          WHERE project_id = v_project_id
            AND building_code = trim(v_item->>'building_code');
      END IF;
      IF v_building_id IS NULL THEN
        INSERT INTO public.ingestion_warnings (project_id, entity, field, code, severity, message, payload)
        VALUES (
          v_project_id, 'unit', 'building_id', 'building_unresolved', 'warning',
          'Unit references a building that exists neither in this batch nor in this project.',
          jsonb_build_object('unit_code', v_code, 'building_code', v_item->>'building_code')
        );
        v_warnings := v_warnings + 1;
      END IF;
    END IF;

    SELECT id INTO v_unit_id FROM public.units
      WHERE project_id = v_project_id AND unit_code = v_code;
    IF v_unit_id IS NULL THEN
      INSERT INTO public.units (
        project_id, building_id, unit_code, unit_type, bedrooms, bathrooms,
        size_sqm, floor, availability_status, metadata
      ) VALUES (
        v_project_id, v_building_id, v_code,
        v_item->>'unit_type',
        (v_item->>'bedrooms')::int,
        (v_item->>'bathrooms')::int,
        (v_item->>'size_sqm')::numeric,
        (v_item->>'floor')::int,
        COALESCE(NULLIF(v_item->>'availability_status', ''), 'available'),
        COALESCE(v_item->'metadata', '{}'::jsonb)
      ) RETURNING id INTO v_unit_id;
    ELSE
      UPDATE public.units SET
        building_id = CASE WHEN v_building_id IS NOT NULL THEN v_building_id ELSE building_id END,
        unit_type = CASE WHEN v_item ? 'unit_type' AND v_item->>'unit_type' IS NOT NULL
                         THEN v_item->>'unit_type' ELSE unit_type END,
        bedrooms = CASE WHEN v_item ? 'bedrooms' AND v_item->>'bedrooms' IS NOT NULL
                        THEN (v_item->>'bedrooms')::int ELSE bedrooms END,
        bathrooms = CASE WHEN v_item ? 'bathrooms' AND v_item->>'bathrooms' IS NOT NULL
                         THEN (v_item->>'bathrooms')::int ELSE bathrooms END,
        size_sqm = CASE WHEN v_item ? 'size_sqm' AND v_item->>'size_sqm' IS NOT NULL
                        THEN (v_item->>'size_sqm')::numeric ELSE size_sqm END,
        floor = CASE WHEN v_item ? 'floor' AND v_item->>'floor' IS NOT NULL
                     THEN (v_item->>'floor')::int ELSE floor END,
        availability_status = CASE WHEN v_item ? 'availability_status' AND NULLIF(v_item->>'availability_status', '') IS NOT NULL
                                   THEN v_item->>'availability_status' ELSE availability_status END,
        metadata = metadata
          || (COALESCE(v_item->'metadata', '{}'::jsonb) - 'field_provenance')
          || jsonb_build_object('field_provenance',
               COALESCE(metadata->'field_provenance', '{}'::jsonb)
               || COALESCE(v_item->'metadata'->'field_provenance', '{}'::jsonb)),
        updated_at = now()
      WHERE id = v_unit_id;
    END IF;
    v_unit_ids := v_unit_ids || jsonb_build_object(v_code, v_unit_id::text);
    v_units := v_units + 1;
  END LOOP;

  -- -------- prices (scoped to this project's units; currency may be NULL) --
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(batch->'prices', '[]'::jsonb))
  LOOP
    v_code := NULLIF(trim(v_item->>'unit_code'), '');
    v_unit_id := (v_unit_ids->>COALESCE(v_code, ''))::uuid;
    IF v_unit_id IS NULL AND v_code IS NOT NULL THEN
      SELECT id INTO v_unit_id FROM public.units
        WHERE project_id = v_project_id AND unit_code = v_code;
    END IF;
    IF v_unit_id IS NULL THEN
      -- unit_price_history.unit_id is NOT NULL: safe persistence without a
      -- unit is impossible, so this is a technical failure, not a warning.
      RAISE EXCEPTION 'forever_progressive_ingest: price_unit_unknown (%)', COALESCE(v_code, '?');
    END IF;
    IF v_item->>'price' IS NULL THEN
      RAISE EXCEPTION 'forever_progressive_ingest: price_value_required (%)', v_code;
    END IF;
    SELECT id INTO v_row_id FROM public.unit_price_history
      WHERE unit_id = v_unit_id
        AND price_source IS NOT DISTINCT FROM v_item->>'price_source'
        AND source_file IS NOT DISTINCT FROM v_item->>'source_file'
        AND source_page IS NOT DISTINCT FROM (v_item->>'source_page')::int
        AND price_list_date IS NOT DISTINCT FROM (v_item->>'price_list_date')::date;
    IF v_row_id IS NULL THEN
      INSERT INTO public.unit_price_history (
        unit_id, price, currency, price_source, source_file, source_page,
        price_list_date, metadata
      ) VALUES (
        v_unit_id,
        (v_item->>'price')::numeric,
        NULLIF(trim(COALESCE(v_item->>'currency', '')), ''),  -- NULL when unknown
        v_item->>'price_source',
        v_item->>'source_file',
        (v_item->>'source_page')::int,
        (v_item->>'price_list_date')::date,
        COALESCE(v_item->'metadata', '{}'::jsonb)
      );
    ELSE
      UPDATE public.unit_price_history SET
        price = (v_item->>'price')::numeric,
        currency = CASE WHEN v_item ? 'currency' AND NULLIF(trim(v_item->>'currency'), '') IS NOT NULL
                        THEN trim(v_item->>'currency') ELSE currency END,
        metadata = metadata
          || (COALESCE(v_item->'metadata', '{}'::jsonb) - 'field_provenance')
          || jsonb_build_object('field_provenance',
               COALESCE(metadata->'field_provenance', '{}'::jsonb)
               || COALESCE(v_item->'metadata'->'field_provenance', '{}'::jsonb)),
        updated_at = now()
      WHERE id = v_row_id;
    END IF;
    v_prices := v_prices + 1;
  END LOOP;

  -- -------- media + documents (project_media; natural key [F5]) --------
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(batch->'media', '[]'::jsonb))
  LOOP
    IF NULLIF(trim(v_item->>'url'), '') IS NULL
       OR NULLIF(trim(v_item->>'media_type'), '') IS NULL THEN
      RAISE EXCEPTION 'forever_progressive_ingest: media_item_invalid';
    END IF;
    SELECT id INTO v_row_id FROM public.project_media
      WHERE project_id = v_project_id
        AND media_type = trim(v_item->>'media_type')
        AND url = trim(v_item->>'url');
    IF v_row_id IS NULL THEN
      INSERT INTO public.project_media (project_id, media_type, title, url, sort_order, metadata)
      VALUES (
        v_project_id,
        trim(v_item->>'media_type'),
        v_item->>'title',
        trim(v_item->>'url'),
        COALESCE((v_item->>'sort_order')::int, 0),
        COALESCE(v_item->'metadata', '{}'::jsonb)
      );
    ELSE
      -- Presence-aware: a missing sort_order or title never overwrites a
      -- curated value with zero/NULL.
      UPDATE public.project_media SET
        title = CASE WHEN v_item ? 'title' AND v_item->>'title' IS NOT NULL
                     THEN v_item->>'title' ELSE title END,
        sort_order = CASE WHEN v_item ? 'sort_order' AND v_item->>'sort_order' IS NOT NULL
                          THEN (v_item->>'sort_order')::int ELSE sort_order END,
        metadata = metadata
          || (COALESCE(v_item->'metadata', '{}'::jsonb) - 'field_provenance')
          || jsonb_build_object('field_provenance',
               COALESCE(metadata->'field_provenance', '{}'::jsonb)
               || COALESCE(v_item->'metadata'->'field_provenance', '{}'::jsonb))
      WHERE id = v_row_id;
    END IF;
    v_media := v_media + 1;
  END LOOP;

  -- -------- warnings (pre-computed by the TS builder; same transaction) ----
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(batch->'warnings', '[]'::jsonb))
  LOOP
    INSERT INTO public.ingestion_warnings (project_id, entity, field, code, severity, message, payload)
    VALUES (
      v_project_id,
      v_item->>'entity',
      v_item->>'field',
      v_item->>'code',
      COALESCE(v_item->>'severity', 'warning'),
      v_item->>'message',
      COALESCE(v_item->'payload', '{}'::jsonb)
    );
    v_warnings := v_warnings + 1;
  END LOOP;

  -- -------- batch record (idempotency + audit) --------
  v_summary := jsonb_build_object(
    'schema_version', '1',
    'mode', v_mode,
    'project_id', v_project_id::text,
    'project_slug', v_slug,
    'public_status', (SELECT public_status FROM public.projects WHERE id = v_project_id),
    'counts', jsonb_build_object(
      'buildings', v_buildings, 'units', v_units, 'prices', v_prices,
      'media', v_media, 'warnings', v_warnings
    ),
    'replayed', false
  );
  INSERT INTO public.ingestion_batches (project_id, batch_fingerprint, payload_hash, mode, summary)
  VALUES (v_project_id, v_fingerprint, v_payload_hash, v_mode, v_summary);

  RETURN v_summary;
END;
$$;

-- Server-side owner tooling only. Never the browser, never anon.
REVOKE ALL ON FUNCTION public.forever_progressive_ingest(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forever_progressive_ingest(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.forever_progressive_ingest(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.forever_progressive_ingest(JSONB) TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- DOWN (reversal reference only — never bundle with the UP migration)
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.forever_progressive_ingest(JSONB);
-- DROP TABLE IF EXISTS public.ingestion_batches;
-- DROP TABLE IF EXISTS public.ingestion_warnings;
-- DROP TABLE IF EXISTS public.listings;
-- DROP INDEX IF EXISTS project_media_natural_key;
-- ALTER TABLE public.unit_price_history ALTER COLUMN currency SET DEFAULT 'THB';
--   -- restoring NOT NULL requires backfilling NULL rows first
-- (recreate each replaced SELECT policy with its previous is_active-only
--  predicate; the published backfill is intentionally not auto-reversible)
-- ALTER TABLE public.projects ALTER COLUMN forever_verified SET DEFAULT true;
-- DROP INDEX IF EXISTS idx_projects_developer_unresolved;
-- DROP INDEX IF EXISTS idx_projects_location_unresolved;
-- ALTER TABLE public.projects
--   DROP COLUMN IF EXISTS field_provenance,
--   DROP COLUMN IF EXISTS location_name_raw,
--   DROP COLUMN IF EXISTS developer_name_raw;
