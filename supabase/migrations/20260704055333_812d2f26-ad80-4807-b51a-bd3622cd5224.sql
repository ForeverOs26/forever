
-- Timestamp trigger helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- DEVELOPERS
CREATE TABLE public.developers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  website TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.developers TO anon, authenticated;
GRANT ALL ON public.developers TO service_role;
ALTER TABLE public.developers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Developers are viewable by everyone"
  ON public.developers FOR SELECT USING (true);
CREATE TRIGGER trg_developers_updated_at
  BEFORE UPDATE ON public.developers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PROJECTS
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID REFERENCES public.developers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  project_type TEXT,
  location_area TEXT,
  address TEXT,
  short_description TEXT,
  full_description TEXT,
  construction_status TEXT,
  completion_date DATE,
  ownership_type TEXT,
  distance_to_beach TEXT,
  distance_to_airport TEXT,
  distance_to_school TEXT,
  facilities TEXT[] DEFAULT '{}',
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  main_image_url TEXT,
  brochure_url TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.projects TO anon, authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active projects are viewable by everyone"
  ON public.projects FOR SELECT USING (is_active = true);
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_projects_slug ON public.projects(slug);
CREATE INDEX idx_projects_location_area ON public.projects(location_area);
CREATE INDEX idx_projects_is_featured ON public.projects(is_featured);
CREATE INDEX idx_projects_is_active ON public.projects(is_active);

-- UNITS
CREATE TABLE public.units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  unit_code TEXT,
  unit_type TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  size_sqm NUMERIC(10,2),
  floor INTEGER,
  view_type TEXT,
  ownership_type TEXT,
  base_price_thb NUMERIC(14,2),
  discounted_price_thb NUMERIC(14,2),
  price_per_sqm NUMERIC(14,2),
  availability_status TEXT NOT NULL DEFAULT 'available',
  payment_plan TEXT,
  furniture_package TEXT,
  rental_guarantee TEXT,
  roi_estimate TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.units TO anon, authenticated;
GRANT ALL ON public.units TO service_role;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Units of active projects are viewable by everyone"
  ON public.units FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = units.project_id AND p.is_active = true)
  );
CREATE TRIGGER trg_units_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_units_project_id ON public.units(project_id);
CREATE INDEX idx_units_availability_status ON public.units(availability_status);
CREATE INDEX idx_units_bedrooms ON public.units(bedrooms);
CREATE INDEX idx_units_base_price_thb ON public.units(base_price_thb);

-- PROJECT MEDIA
CREATE TABLE public.project_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL,
  title TEXT,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.project_media TO anon, authenticated;
GRANT ALL ON public.project_media TO service_role;
ALTER TABLE public.project_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Media of active projects is viewable by everyone"
  ON public.project_media FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_media.project_id AND p.is_active = true)
  );
CREATE INDEX idx_project_media_project_id ON public.project_media(project_id);

-- INVESTMENT DATA
CREATE TABLE public.investment_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE CASCADE,
  expected_daily_rate NUMERIC(14,2),
  expected_monthly_rent NUMERIC(14,2),
  expected_yearly_rent NUMERIC(14,2),
  occupancy_rate NUMERIC(5,2),
  annual_roi_percent NUMERIC(5,2),
  guaranteed_rental_percent NUMERIC(5,2),
  guarantee_years INTEGER,
  management_company TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT investment_data_project_or_unit CHECK (project_id IS NOT NULL OR unit_id IS NOT NULL)
);
GRANT SELECT ON public.investment_data TO anon, authenticated;
GRANT ALL ON public.investment_data TO service_role;
ALTER TABLE public.investment_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Investment data of active projects is viewable by everyone"
  ON public.investment_data FOR SELECT USING (
    (project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = investment_data.project_id AND p.is_active = true))
    AND (unit_id IS NULL OR EXISTS (
      SELECT 1 FROM public.units u JOIN public.projects p ON p.id = u.project_id
      WHERE u.id = investment_data.unit_id AND p.is_active = true
    ))
  );
CREATE TRIGGER trg_investment_data_updated_at
  BEFORE UPDATE ON public.investment_data
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_investment_data_project_id ON public.investment_data(project_id);
CREATE INDEX idx_investment_data_unit_id ON public.investment_data(unit_id);

-- PRICE UPDATES
CREATE TABLE public.price_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.units(id) ON DELETE CASCADE,
  old_price_thb NUMERIC(14,2),
  new_price_thb NUMERIC(14,2),
  update_reason TEXT,
  source_file_url TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.price_updates TO authenticated;
GRANT ALL ON public.price_updates TO service_role;
ALTER TABLE public.price_updates ENABLE ROW LEVEL SECURITY;
-- No public policy: price update history is internal/admin only.
CREATE INDEX idx_price_updates_project_id ON public.price_updates(project_id);
CREATE INDEX idx_price_updates_unit_id ON public.price_updates(unit_id);

-- LOCATIONS
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_name TEXT NOT NULL UNIQUE,
  description TEXT,
  beach_name TEXT,
  lifestyle_type TEXT,
  investment_strength INTEGER,
  family_score INTEGER,
  rental_demand_score INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.locations TO anon, authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Locations are viewable by everyone"
  ON public.locations FOR SELECT USING (true);
CREATE TRIGGER trg_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
