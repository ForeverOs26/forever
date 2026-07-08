-- FDB-001: Buildings and normalized facilities.

CREATE TABLE IF NOT EXISTS public.buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  building_code TEXT,
  description TEXT,
  building_type TEXT,
  floors_count INTEGER CHECK (floors_count IS NULL OR floors_count >= 0),
  units_count INTEGER CHECK (units_count IS NULL OR units_count >= 0),
  construction_status TEXT,
  completion_date DATE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, building_code)
);

GRANT SELECT ON public.buildings TO anon, authenticated;
GRANT ALL ON public.buildings TO service_role;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'buildings'
      AND policyname = 'Buildings of active projects are viewable'
  ) THEN
    CREATE POLICY "Buildings of active projects are viewable"
      ON public.buildings
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = buildings.project_id
            AND p.is_active = true
        )
      );
  END IF;
END $$;

CREATE TRIGGER trg_buildings_updated_at
  BEFORE UPDATE ON public.buildings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_buildings_project_id
  ON public.buildings(project_id);
CREATE INDEX IF NOT EXISTS idx_buildings_project_sort
  ON public.buildings(project_id, sort_order);

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS building_id UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_status TEXT,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_units_building_id
  ON public.units(building_id);

CREATE TABLE IF NOT EXISTS public.facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  icon TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.facilities TO anon, authenticated;
GRANT ALL ON public.facilities TO service_role;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'facilities'
      AND policyname = 'Active facilities are viewable'
  ) THEN
    CREATE POLICY "Active facilities are viewable"
      ON public.facilities
      FOR SELECT
      USING (is_active = true);
  END IF;
END $$;

CREATE TRIGGER trg_facilities_updated_at
  BEFORE UPDATE ON public.facilities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_facilities_category
  ON public.facilities(category);
CREATE INDEX IF NOT EXISTS idx_facilities_is_active
  ON public.facilities(is_active);

CREATE TABLE IF NOT EXISTS public.project_facilities (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, facility_id)
);

GRANT SELECT ON public.project_facilities TO anon, authenticated;
GRANT ALL ON public.project_facilities TO service_role;
ALTER TABLE public.project_facilities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_facilities'
      AND policyname = 'Facilities of active projects are viewable'
  ) THEN
    CREATE POLICY "Facilities of active projects are viewable"
      ON public.project_facilities
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = project_facilities.project_id
            AND p.is_active = true
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_facilities_facility_id
  ON public.project_facilities(facility_id);
CREATE INDEX IF NOT EXISTS idx_project_facilities_project_sort
  ON public.project_facilities(project_id, sort_order);
