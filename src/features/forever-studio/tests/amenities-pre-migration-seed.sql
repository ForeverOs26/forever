-- FOREVER-STUDIO-AMENITIES-CORE-001: pre-migration state for the amenities editor.
--
-- The runner applies this IMMEDIATELY BEFORE
-- `20260728160000_studio_project_amenities_editor.sql`, so at the moment it runs
-- `public.project_amenities` still has its original four columns
-- `(project_id, amenity_id, note, created_at)`.
--
-- That timing is the whole point. "Adding the two columns preserves existing
-- rows" is only provable against rows that predate the columns; a row inserted
-- after the migration proves nothing about it. The behavioral suite reads these
-- rows back afterwards and asserts the tuple survived byte-for-byte, that the
-- two new columns arrived at their declared defaults, and that `created_at` was
-- not re-dated.
--
-- Nothing here touches the legacy `facilities` / `project_facilities` tables.

\set ON_ERROR_STOP on

INSERT INTO public.developers(id, name)
VALUES ('a0000000-0000-0000-0000-0000000000d1', 'Amenities Developer');

INSERT INTO public.projects(id, developer_id, name, slug, is_active, public_status)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1',
   'Amenities Legacy', 'amenities-legacy', true, 'published'),
  -- The isolation control: a second project whose links must never move when
  -- the first one is saved.
  ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000d1',
   'Amenities Neighbour', 'amenities-neighbour', true, 'published');

INSERT INTO public.amenities(id, slug, name, category, icon)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'swimming-pool', 'Swimming Pool', 'Pools & Water', 'waves'),
  ('a1000000-0000-0000-0000-000000000002', 'fitness-centre', 'Fitness Centre', 'Fitness & Wellness', 'dumbbell'),
  ('a1000000-0000-0000-0000-000000000003', 'kids-pool', 'Children''s Pool', 'Pools & Water', 'baby'),
  ('a1000000-0000-0000-0000-000000000004', 'co-working-space', 'Co-working Space', 'Work & Social', 'laptop'),
  ('a1000000-0000-0000-0000-000000000005', 'onsen', 'Onsen', 'Fitness & Wellness', 'bath'),
  ('a1000000-0000-0000-0000-000000000006', 'sauna', 'Sauna', 'Fitness & Wellness', 'bath'),
  ('a1000000-0000-0000-0000-000000000007', 'golf-simulator', 'Golf Simulator', 'Fitness & Wellness', 'flag'),
  ('a1000000-0000-0000-0000-000000000008', 'rooftop-bar', 'Rooftop Bar', 'Hospitality & Retail', 'martini'),
  ('a1000000-0000-0000-0000-000000000009', 'kids-club', 'Kids Club', 'Family & Children', 'blocks'),
  ('a1000000-0000-0000-0000-00000000000a', 'ev-charging', 'EV Charging', 'Parking & Transport', 'plug-zap'),
  ('a1000000-0000-0000-0000-00000000000b', '24h-security', '24-Hour Security', 'Security & Services', 'shield'),
  ('a1000000-0000-0000-0000-00000000000c', 'landscaped-garden', 'Landscaped Garden', 'Outdoor & Leisure', 'trees');

-- Two links on the project under test, one of them carrying a note, and one on
-- the neighbour. Written with the pre-migration column list ONLY: naming
-- is_featured or sort_order here would fail, which is itself the proof that this
-- file really does run before the migration.
INSERT INTO public.project_amenities(project_id, amenity_id, note)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'Two lap pools and a lagoon pool'),
  ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', NULL),
  ('a0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003',
   'Neighbour kids pool — must not move');

-- The exact pre-migration tuples, kept in an ordinary table so the behavioral
-- suite can compare against them after the migration has applied. A temporary
-- table would not survive the psql session boundary between the two files.
CREATE TABLE public.amenities_pre_migration_baseline AS
SELECT project_id, amenity_id, note, created_at
FROM public.project_amenities;

-- And a positive control on the timing itself: at this point the columns must
-- NOT exist. If they do, the runner applied the migration too early and every
-- survival assertion downstream would be vacuous.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_amenities'
      AND column_name IN ('is_featured', 'sort_order')
  ) THEN
    RAISE EXCEPTION 'amenities_pre_seed_ran_after_migration';
  END IF;
END $$;
