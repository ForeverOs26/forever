-- CORALINA-PUBLICATION-READINESS-001: public data minimisation.
--
-- This migration is intentionally UNAPPLIED. RLS decides which rows a public
-- role may see, but not which columns it receives. Progressive Coralina rows
-- retain source references and field provenance in JSON metadata; those must
-- never be queryable by anon/authenticated clients after publication.
--
-- Matching explicit public projections:
--   src/lib/project-service.ts
--   src/features/project-detail/project-detail-service.ts
--
-- Run only through the normal, separately authorised migration process.

BEGIN;

-- Remove broad table grants inherited from the original schema, then restore
-- only the columns rendered by the public catalogue and Project Detail page.
-- Existing RLS publication predicates remain the row-level enforcement layer.
REVOKE SELECT ON TABLE public.projects FROM anon, authenticated;
GRANT SELECT (
  id, developer_id, name, slug, project_type, location_area, address,
  short_description, full_description, construction_status,
  ownership_type, distance_to_beach, distance_to_airport, latitude, longitude,
  main_image_url, brochure_url, is_featured, is_active, public_status, created_at,
  sales_status, starting_price_thb, price_range, price_per_sqm_display,
  last_price_update, tagline, highlights, beds_display, area_range,
  nearby_schools, nearby_hospitals, lifestyle, developer_name_raw,
  location_name_raw, start_date_display, completion_date_display
) ON public.projects TO anon, authenticated;

-- The detail relation uses only public developer identity/branding fields.
-- Contact columns are intentionally excluded: the general developer table has
-- no per-value public-contact provenance contract.
REVOKE SELECT ON TABLE public.developers FROM anon, authenticated;
GRANT SELECT (
  id, name, description, website, logo_url
) ON public.developers TO anon, authenticated;

REVOKE SELECT ON TABLE public.units FROM anon, authenticated;
GRANT SELECT (
  id, project_id, unit_code, unit_type, bedrooms, bathrooms,
  size_sqm, floor, view_type, ownership_type, base_price_thb,
  discounted_price_thb, price_per_sqm, availability_status, payment_plan,
  furniture_package, rental_guarantee, roi_estimate, notes
) ON public.units TO anon, authenticated;

REVOKE SELECT ON TABLE public.project_media FROM anon, authenticated;
GRANT SELECT (
  id, project_id, media_type, title, url, sort_order
) ON public.project_media TO anon, authenticated;

REVOKE SELECT ON TABLE public.investment_data FROM anon, authenticated;
GRANT SELECT (
  id, project_id, unit_id, expected_daily_rate, expected_monthly_rent,
  expected_yearly_rent, occupancy_rate, annual_roi_percent,
  guaranteed_rental_percent, guarantee_years, management_company, notes,
  created_at
) ON public.investment_data TO anon, authenticated;

-- No public UI reads raw price history. It holds source_file and metadata,
-- including Coralina's repository paths and currency-decision provenance.
REVOKE SELECT ON TABLE public.unit_price_history FROM anon, authenticated;

COMMIT;
