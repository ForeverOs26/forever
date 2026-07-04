-- Extend projects with advisory & display fields needed by the UI
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS highlights text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS trust_score numeric(3,1),
  ADD COLUMN IF NOT EXISTS trust_note text,
  ADD COLUMN IF NOT EXISTS investment_value numeric(3,1),
  ADD COLUMN IF NOT EXISTS market_position text,
  ADD COLUMN IF NOT EXISTS verdict text,
  ADD COLUMN IF NOT EXISTS sales_status text,
  ADD COLUMN IF NOT EXISTS starting_price_thb bigint,
  ADD COLUMN IF NOT EXISTS price_range text,
  ADD COLUMN IF NOT EXISTS price_per_sqm_display text,
  ADD COLUMN IF NOT EXISTS last_price_update text,
  ADD COLUMN IF NOT EXISTS beds_display text,
  ADD COLUMN IF NOT EXISTS area_range text,
  ADD COLUMN IF NOT EXISTS verified_price text,
  ADD COLUMN IF NOT EXISTS promotion text,
  ADD COLUMN IF NOT EXISTS rental_yield text,
  ADD COLUMN IF NOT EXISTS rental_demand text,
  ADD COLUMN IF NOT EXISTS capital_growth_estimate text,
  ADD COLUMN IF NOT EXISTS start_date_display text,
  ADD COLUMN IF NOT EXISTS completion_date_display text,
  ADD COLUMN IF NOT EXISTS last_inspection text,
  ADD COLUMN IF NOT EXISTS forever_verified boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS nearby_schools text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS nearby_hospitals text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS lifestyle text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS image_key text; -- resolves to bundled asset via slug map

-- Indexes for future filters
CREATE INDEX IF NOT EXISTS projects_slug_idx ON public.projects (slug);
CREATE INDEX IF NOT EXISTS projects_location_area_idx ON public.projects (location_area);
CREATE INDEX IF NOT EXISTS projects_is_featured_idx ON public.projects (is_featured);
CREATE INDEX IF NOT EXISTS projects_is_active_idx ON public.projects (is_active);
CREATE INDEX IF NOT EXISTS units_project_id_idx ON public.units (project_id);
CREATE INDEX IF NOT EXISTS units_availability_status_idx ON public.units (availability_status);
CREATE INDEX IF NOT EXISTS units_bedrooms_idx ON public.units (bedrooms);
CREATE INDEX IF NOT EXISTS units_price_idx ON public.units (base_price_thb);

-- Seed developers
INSERT INTO public.developers (name, description) VALUES
  ('Andaman Ridge Developments', 'Boutique west-coast villa developer.'),
  ('Andara Signature Group', 'Branded beachfront residence operator.'),
  ('Layan Estate Co.', 'Rainforest-integrated villa specialist.'),
  ('Laguna Property Partners', 'Established Laguna corridor developer.'),
  ('Cape Kata Estates', 'Cliffside residence developer.'),
  ('South Cape Homes', 'Boutique southern-cape villa builder.')
ON CONFLICT DO NOTHING;

-- Seed projects
WITH d AS (SELECT id, name FROM public.developers)
INSERT INTO public.projects (
  developer_id, name, slug, project_type, construction_status, ownership_type,
  location_area, short_description, full_description, main_image_url, image_key,
  is_featured, is_active, distance_to_beach, distance_to_airport,
  tagline, highlights, trust_score, trust_note, investment_value, market_position, verdict,
  sales_status, starting_price_thb, price_range, price_per_sqm_display, last_price_update,
  beds_display, area_range, verified_price, promotion, rental_yield, rental_demand,
  capital_growth_estimate, start_date_display, completion_date_display, last_inspection,
  nearby_schools, nearby_hospitals, lifestyle, forever_verified
) VALUES
(
  (SELECT id FROM d WHERE name='Andaman Ridge Developments'),
  'Surin Ridge Villas','surin-ridge-villas','Villa','Under Construction','Freehold',
  'Surin Beach',
  'Andaman-facing pool villas on Surin ridge',
  'A quiet enclave of nine ridge villas above Surin, each with a private infinity pool and unobstructed sunset views.',
  NULL,'villaSurin', true, true, '600 m to Surin Beach','25 km to HKT (35 min)',
  'Andaman-facing pool villas on Surin ridge',
  ARRAY['Private infinity pool','Full ocean view','Freehold structure available','On-site rental management'],
  9.4,'Verified after independent inspection.',9.1,'In line with market','Excellent Long-Term Investment',
  'Selling',48000000,'฿48M – ฿82M','฿114,000 / sqm','May 2026',
  '3–5 Beds','420–780 sqm','฿48M – ฿82M','Furniture package included','5.5 – 6.5% net p.a.','High',
  '6 – 8% p.a.','Q1 2025','Q4 2026','May 2026',
  ARRAY['UWC Thailand (12 km)','Headstart International (14 km)'],
  ARRAY['Bangkok Hospital Phuket (18 km)'],
  ARRAY['Catch Beach Club','Twinpalms Resort','Surin Plaza'], true
),
(
  (SELECT id FROM d WHERE name='Andara Signature Group'),
  'Kamala Beach Residences','kamala-beach-residences','Residence','Nearing Completion','Freehold',
  'Kamala',
  'Beachfront branded residences with guaranteed rental',
  'A branded beachfront condominium on Kamala''s quiet north end, with a 6% guaranteed rental program for five years.',
  NULL,'villaKamala', true, true,'Directly on Kamala Beach','30 km to HKT (40 min)',
  'Beachfront branded residences with guaranteed rental',
  ARRAY['Beachfront lot','Branded operator','6% guaranteed rental (5 yrs)','45 nights owner use'],
  9.1,'Personally inspected by Forever advisors.',8.9,'Slight premium','Strong Buy',
  'Available',12800000,'฿12.8M – ฿38M','฿220,000 / sqm','April 2026',
  '1–3 Beds','58–180 sqm','฿12.8M – ฿38M','Waived transfer fee','6.0% guaranteed net (5 yrs)','Very High',
  '5 – 7% p.a.','Q2 2024','Q3 2026','April 2026',
  ARRAY['Kajonkiet International (6 km)','HeadStart (10 km)'],
  ARRAY['Bangkok Hospital Phuket (20 km)'],
  ARRAY['HQ Beach Lounge','Café Del Mar','Kamala Village'], true
),
(
  (SELECT id FROM d WHERE name='Layan Estate Co.'),
  'Layan Forest Villas','layan-forest-villas','Villa','Pre-Launch','Freehold',
  'Layan',
  'Rainforest villas above Layan Bay',
  'Twelve villas set into protected rainforest above Layan, walking distance to one of Phuket''s quietest beaches.',
  NULL,'villaLayan', true, true,'900 m to Layan Beach','18 km to HKT (25 min)',
  'Rainforest villas above Layan Bay',
  ARRAY['Protected rainforest setting','Private plunge pool','Smart-home standard','Concierge & housekeeping'],
  9.2,'Construction progress reviewed on-site.',8.6,'Below market','Ideal Family Residence',
  'Selling',62000000,'฿62M – ฿74M','฿115,000 / sqm','March 2026',
  '4 Beds','540 sqm','฿62M – ฿74M','5% pre-launch discount','4.5 – 5.5% net p.a.','High',
  '7 – 9% p.a.','Q3 2025','Q2 2027','March 2026',
  ARRAY['UWC Thailand (5 km)','British International (8 km)'],
  ARRAY['Thalang Hospital (10 km)','Bangkok Hospital (22 km)'],
  ARRAY['Laguna Golf','Layan Beach Club','Boat Avenue'], true
),
(
  (SELECT id FROM d WHERE name='Laguna Property Partners'),
  'Bang Tao Garden Villas','bangtao-garden-pool-villas','Villa','Under Construction','Freehold',
  'Bang Tao',
  'Contemporary courtyard pool villas near Laguna',
  'A compact community of 24 courtyard villas, five minutes from Laguna and ten from Bang Tao''s beach clubs.',
  NULL,'villaBangtao', false, true,'1.8 km to Bang Tao Beach','20 km to HKT (30 min)',
  'Contemporary courtyard pool villas near Laguna',
  ARRAY['Private pool & garden','Freehold via Thai company','Managed rental optional','Estate security'],
  8.8,'Developer credentials independently confirmed.',8.4,'In line with market','Strong Buy',
  'Selling',22000000,'฿22M – ฿34M','฿85,000 / sqm','February 2026',
  '3–4 Beds','280–360 sqm','฿22M – ฿34M','Free 1-year rental management','5.0 – 6.0% net p.a.','High',
  '5 – 7% p.a.','Q4 2024','Q1 2027','February 2026',
  ARRAY['UWC Thailand (4 km)','Berda Claude International (6 km)'],
  ARRAY['Bangkok Hospital Phuket (18 km)'],
  ARRAY['Boat Avenue','Porto de Phuket','Laguna Golf'], true
),
(
  (SELECT id FROM d WHERE name='Cape Kata Estates'),
  'Kata Cliff Residences','kata-cliff-residences','Residence','Ready','Freehold',
  'Kata Noi',
  'Cliffside residences above Kata Noi',
  'A limited release of 18 cliffside residences with panoramic bay views and direct access to Kata Noi beach.',
  NULL,'villaKata', false, true,'300 m to Kata Noi Beach','45 km to HKT (60 min)',
  'Cliffside residences above Kata Noi',
  ARRAY['Panoramic bay view','Cliffside infinity pool','Direct beach path','Rental license in place'],
  9.0,'Legal documentation checked by Forever.',8.8,'Slight premium','Lifestyle Purchase',
  'Available',36000000,'฿36M – ฿58M','฿165,000 / sqm','May 2026',
  '2–4 Beds','180–420 sqm','฿36M – ฿58M','Complimentary interior package','6.0 – 7.5% net p.a.','Very High',
  '4 – 6% p.a.','Q1 2023','Q4 2025','May 2026',
  ARRAY['Kajonkiet International (14 km)'],
  ARRAY['Bangkok Hospital Phuket (28 km)'],
  ARRAY['Ska Bar','Re Ka Ta Beach Club','Kata Center'], true
),
(
  (SELECT id FROM d WHERE name='South Cape Homes'),
  'Rawai Courtyard Villas','rawai-courtyard-villas','Villa','Sold Out','Freehold',
  'Rawai',
  'Boutique courtyard villas near the south cape',
  'Fourteen boutique villas around a lantern-lit reflecting pool, minutes from Rawai''s fishing pier and Nai Harn.',
  NULL,'villaRawai', false, true,'1.2 km to Rawai Beach','50 km to HKT (65 min)',
  'Boutique courtyard villas near the south cape',
  ARRAY['Lantern-lit courtyard','Private pool','Freehold company structure','On-site management'],
  8.6,'Verified after independent inspection.',8.0,'Below market','Wait for Better Pricing',
  'Sold Out',18000000,'฿18M – ฿24M','฿75,000 / sqm','January 2026',
  '3 Beds','260 sqm','฿18M – ฿24M','Waitlist only','4.0 – 5.0% net p.a.','Moderate',
  '3 – 5% p.a.','Q2 2022','Q3 2024','January 2026',
  ARRAY['HeadStart Rawai (3 km)'],
  ARRAY['Vachira Phuket (30 km)'],
  ARRAY['Rawai Seafood Market','Nai Harn Beach','Promthep Cape'], true
)
ON CONFLICT (slug) DO NOTHING;

-- Seed a cover media entry per project (gallery uses same key for now)
INSERT INTO public.project_media (project_id, media_type, url, sort_order, title)
SELECT p.id, 'gallery', p.image_key, 0, 'Cover'
FROM public.projects p
WHERE p.image_key IS NOT NULL
ON CONFLICT DO NOTHING;
