-- FDB-001: Canonical project assets and deterministic intelligence records.

CREATE TABLE IF NOT EXISTS public.project_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL CHECK (
    asset_type IN ('document', 'image', 'video', 'link', 'plan', 'other')
  ),
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  storage_bucket TEXT,
  storage_path TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  checksum TEXT,
  language_code TEXT NOT NULL DEFAULT 'en',
  is_public BOOLEAN NOT NULL DEFAULT true,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.project_assets TO anon, authenticated;
GRANT ALL ON public.project_assets TO service_role;
ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_assets'
      AND policyname = 'Public assets of active projects are viewable'
  ) THEN
    CREATE POLICY "Public assets of active projects are viewable"
      ON public.project_assets
      FOR SELECT
      USING (
        is_public = true
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = project_assets.project_id
            AND p.is_active = true
        )
      );
  END IF;
END $$;

CREATE TRIGGER trg_project_assets_updated_at
  BEFORE UPDATE ON public.project_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_project_assets_project_type_sort
  ON public.project_assets(project_id, asset_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_assets_source_id
  ON public.project_assets(source_id);
CREATE INDEX IF NOT EXISTS idx_project_assets_public_featured
  ON public.project_assets(is_public, is_featured);

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.project_assets(id) ON DELETE SET NULL,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL DEFAULT 'document',
  title TEXT NOT NULL,
  description TEXT,
  document_date DATE,
  valid_until DATE,
  url TEXT NOT NULL,
  storage_bucket TEXT,
  storage_path TEXT,
  language_code TEXT NOT NULL DEFAULT 'en',
  is_public BOOLEAN NOT NULL DEFAULT true,
  requires_request BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.documents TO anon, authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'documents'
      AND policyname = 'Public documents of active projects are viewable'
  ) THEN
    CREATE POLICY "Public documents of active projects are viewable"
      ON public.documents
      FOR SELECT
      USING (
        is_public = true
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = documents.project_id
            AND p.is_active = true
        )
      );
  END IF;
END $$;

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_documents_project_type_sort
  ON public.documents(project_id, document_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_documents_asset_id
  ON public.documents(asset_id);
CREATE INDEX IF NOT EXISTS idx_documents_source_id
  ON public.documents(source_id);

CREATE TABLE IF NOT EXISTS public.images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.project_assets(id) ON DELETE SET NULL,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  image_type TEXT NOT NULL DEFAULT 'gallery',
  title TEXT,
  alt_text TEXT,
  url TEXT NOT NULL,
  storage_bucket TEXT,
  storage_path TEXT,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  focal_point_x NUMERIC(5,4) CHECK (focal_point_x IS NULL OR focal_point_x BETWEEN 0 AND 1),
  focal_point_y NUMERIC(5,4) CHECK (focal_point_y IS NULL OR focal_point_y BETWEEN 0 AND 1),
  is_public BOOLEAN NOT NULL DEFAULT true,
  is_hero BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.images TO anon, authenticated;
GRANT ALL ON public.images TO service_role;
ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'images'
      AND policyname = 'Public images of active projects are viewable'
  ) THEN
    CREATE POLICY "Public images of active projects are viewable"
      ON public.images
      FOR SELECT
      USING (
        is_public = true
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = images.project_id
            AND p.is_active = true
        )
      );
  END IF;
END $$;

CREATE TRIGGER trg_images_updated_at
  BEFORE UPDATE ON public.images
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_images_project_type_sort
  ON public.images(project_id, image_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_images_project_hero
  ON public.images(project_id, is_hero);
CREATE INDEX IF NOT EXISTS idx_images_asset_id
  ON public.images(asset_id);

CREATE TABLE IF NOT EXISTS public.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.project_assets(id) ON DELETE SET NULL,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  video_type TEXT NOT NULL DEFAULT 'overview',
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  provider TEXT,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  is_public BOOLEAN NOT NULL DEFAULT true,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.videos TO anon, authenticated;
GRANT ALL ON public.videos TO service_role;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'videos'
      AND policyname = 'Public videos of active projects are viewable'
  ) THEN
    CREATE POLICY "Public videos of active projects are viewable"
      ON public.videos
      FOR SELECT
      USING (
        is_public = true
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = videos.project_id
            AND p.is_active = true
        )
      );
  END IF;
END $$;

CREATE TRIGGER trg_videos_updated_at
  BEFORE UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_videos_project_type_sort
  ON public.videos(project_id, video_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_videos_asset_id
  ON public.videos(asset_id);

CREATE TABLE IF NOT EXISTS public.project_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  intelligence_version TEXT NOT NULL DEFAULT '1.0',
  forever_score NUMERIC(5,2) CHECK (forever_score IS NULL OR forever_score BETWEEN 0 AND 100),
  verdict TEXT,
  confidence_score NUMERIC(5,2) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  best_buyer_profile TEXT,
  investment_horizon TEXT,
  rental_strategy TEXT,
  exit_strategy TEXT,
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  scoring_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by TEXT NOT NULL DEFAULT 'deterministic_engine',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  is_current BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.project_intelligence TO anon, authenticated;
GRANT ALL ON public.project_intelligence TO service_role;
ALTER TABLE public.project_intelligence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_intelligence'
      AND policyname = 'Current published intelligence is viewable'
  ) THEN
    CREATE POLICY "Current published intelligence is viewable"
      ON public.project_intelligence
      FOR SELECT
      USING (
        is_current = true
        AND published_at IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = project_intelligence.project_id
            AND p.is_active = true
        )
      );
  END IF;
END $$;

CREATE TRIGGER trg_project_intelligence_updated_at
  BEFORE UPDATE ON public.project_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_intelligence_one_current
  ON public.project_intelligence(project_id)
  WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_project_intelligence_project_id
  ON public.project_intelligence(project_id);
CREATE INDEX IF NOT EXISTS idx_project_intelligence_published_at
  ON public.project_intelligence(published_at DESC);
