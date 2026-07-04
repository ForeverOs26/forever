
-- ============ MEDIA ORDERING ============
ALTER TABLE public.project_media
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_project_media_project_sort
  ON public.project_media(project_id, sort_order);

-- ============ PROJECT BROCHURE DEFAULT ============
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS brochure_url TEXT;

-- ============ TRANSLATIONS: PROJECTS ============
CREATE TABLE IF NOT EXISTS public.project_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en','ru','zh','th')),
  name TEXT,
  tagline TEXT,
  description TEXT,
  verdict TEXT,
  market_position TEXT,
  investment_value TEXT,
  trust_note TEXT,
  highlights TEXT[],
  meta_title TEXT,
  meta_description TEXT,
  meta_keywords TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, locale)
);
GRANT SELECT ON public.project_translations TO anon, authenticated;
GRANT ALL ON public.project_translations TO service_role;
ALTER TABLE public.project_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read project translations"
  ON public.project_translations FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_project_translations_project_locale
  ON public.project_translations(project_id, locale);
CREATE TRIGGER trg_project_translations_updated_at
  BEFORE UPDATE ON public.project_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ TRANSLATIONS: DEVELOPERS ============
CREATE TABLE IF NOT EXISTS public.developer_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES public.developers(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en','ru','zh','th')),
  name TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (developer_id, locale)
);
GRANT SELECT ON public.developer_translations TO anon, authenticated;
GRANT ALL ON public.developer_translations TO service_role;
ALTER TABLE public.developer_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read developer translations"
  ON public.developer_translations FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_developer_translations_dev_locale
  ON public.developer_translations(developer_id, locale);
CREATE TRIGGER trg_developer_translations_updated_at
  BEFORE UPDATE ON public.developer_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ PROJECT STATUS HISTORY ============
CREATE TABLE IF NOT EXISTS public.project_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.project_status_history TO anon, authenticated;
GRANT ALL ON public.project_status_history TO service_role;
ALTER TABLE public.project_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read status history"
  ON public.project_status_history FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_status_history_project_date
  ON public.project_status_history(project_id, effective_date DESC);
CREATE TRIGGER trg_status_history_updated_at
  BEFORE UPDATE ON public.project_status_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ TAGS ============
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tags TO anon, authenticated;
GRANT ALL ON public.tags TO service_role;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read tags" ON public.tags FOR SELECT USING (true);
CREATE TRIGGER trg_tags_updated_at
  BEFORE UPDATE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.project_tags (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, tag_id)
);
GRANT SELECT ON public.project_tags TO anon, authenticated;
GRANT ALL ON public.project_tags TO service_role;
ALTER TABLE public.project_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read project tags" ON public.project_tags FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_project_tags_tag ON public.project_tags(tag_id);

-- ============ AMENITIES ============
CREATE TABLE IF NOT EXISTS public.amenities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.amenities TO anon, authenticated;
GRANT ALL ON public.amenities TO service_role;
ALTER TABLE public.amenities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read amenities" ON public.amenities FOR SELECT USING (true);
CREATE TRIGGER trg_amenities_updated_at
  BEFORE UPDATE ON public.amenities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.project_amenities (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  amenity_id UUID NOT NULL REFERENCES public.amenities(id) ON DELETE CASCADE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, amenity_id)
);
GRANT SELECT ON public.project_amenities TO anon, authenticated;
GRANT ALL ON public.project_amenities TO service_role;
ALTER TABLE public.project_amenities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read project amenities" ON public.project_amenities FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_project_amenities_amenity ON public.project_amenities(amenity_id);

-- ============ NEARBY PLACES ============
DO $$ BEGIN
  CREATE TYPE public.place_category AS ENUM ('school','beach','hospital','mall','airport','restaurant','park','transport','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.nearby_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category public.place_category NOT NULL,
  name TEXT NOT NULL,
  distance_km NUMERIC(6,2),
  drive_time_minutes INTEGER,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.nearby_places TO anon, authenticated;
GRANT ALL ON public.nearby_places TO service_role;
ALTER TABLE public.nearby_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read nearby places" ON public.nearby_places FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS idx_nearby_places_project_category
  ON public.nearby_places(project_id, category, sort_order);
CREATE TRIGGER trg_nearby_places_updated_at
  BEFORE UPDATE ON public.nearby_places
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ PROJECT SEO (default/non-translated) ============
CREATE TABLE IF NOT EXISTS public.project_seo (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  keywords TEXT[],
  canonical_url TEXT,
  og_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.project_seo TO anon, authenticated;
GRANT ALL ON public.project_seo TO service_role;
ALTER TABLE public.project_seo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read project seo" ON public.project_seo FOR SELECT USING (true);
CREATE TRIGGER trg_project_seo_updated_at
  BEFORE UPDATE ON public.project_seo
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ ADDITIONAL PROJECT INDEXES ============
CREATE INDEX IF NOT EXISTS idx_projects_active ON public.projects(is_active);
CREATE INDEX IF NOT EXISTS idx_projects_featured ON public.projects(is_featured);
CREATE INDEX IF NOT EXISTS idx_projects_location_area ON public.projects(location_area);
