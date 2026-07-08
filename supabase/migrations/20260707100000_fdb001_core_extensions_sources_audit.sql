-- FDB-001: Forever Core Database foundation
-- Core compatibility extensions, source registry, and audit foundation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Keep existing tables intact and add production metadata needed by the
-- normalized Forever database model.
ALTER TABLE public.developers
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS headquarters_location TEXT,
  ADD COLUMN IF NOT EXISTS established_year INTEGER,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS developers_slug_key
  ON public.developers(slug);
CREATE INDEX IF NOT EXISTS idx_developers_verification_status
  ON public.developers(verification_status);

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'Thailand',
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS market_summary TEXT,
  ADD COLUMN IF NOT EXISTS lifestyle_summary TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS locations_slug_key
  ON public.locations(slug);
CREATE INDEX IF NOT EXISTS idx_locations_country_province
  ON public.locations(country, province);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_code TEXT,
  ADD COLUMN IF NOT EXISTS public_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS internal_status TEXT,
  ADD COLUMN IF NOT EXISTS official_website_url TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_data_review_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_projects_location_id
  ON public.projects(location_id);
CREATE INDEX IF NOT EXISTS idx_projects_developer_id
  ON public.projects(developer_id);
CREATE INDEX IF NOT EXISTS idx_projects_public_status
  ON public.projects(public_status);
CREATE INDEX IF NOT EXISTS idx_projects_sales_status
  ON public.projects(sales_status);
CREATE INDEX IF NOT EXISTS idx_projects_construction_status
  ON public.projects(construction_status);

CREATE TABLE IF NOT EXISTS public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  url TEXT,
  citation TEXT,
  publisher TEXT,
  source_date DATE,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reliability_score INTEGER CHECK (reliability_score IS NULL OR reliability_score BETWEEN 0 AND 100),
  is_public BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sources TO anon, authenticated;
GRANT ALL ON public.sources TO service_role;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sources'
      AND policyname = 'Public sources for active projects are viewable'
  ) THEN
    CREATE POLICY "Public sources for active projects are viewable"
      ON public.sources
      FOR SELECT
      USING (
        is_public = true
        AND (
          project_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = sources.project_id
              AND p.is_active = true
          )
        )
      );
  END IF;
END $$;

CREATE TRIGGER trg_sources_updated_at
  BEFORE UPDATE ON public.sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_sources_project_id
  ON public.sources(project_id);
CREATE INDEX IF NOT EXISTS idx_sources_source_type
  ON public.sources(source_type);
CREATE INDEX IF NOT EXISTS idx_sources_is_public
  ON public.sources(is_public);
CREATE INDEX IF NOT EXISTS idx_sources_retrieved_at
  ON public.sources(retrieved_at DESC);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record
  ON public.audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id
  ON public.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON public.audit_log(created_at DESC);
