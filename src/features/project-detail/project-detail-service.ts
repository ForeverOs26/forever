import { supabase } from "@/integrations/supabase/client";
import { isKnownFictitiousProjectSlug } from "@/lib/public-truth";
import { mapProjectDetail } from "./project-detail-mappers";
import type { ProjectDetail, ProjectDetailRecord } from "./project-detail-types";

export const PROJECT_DETAIL_SELECT = `
  id, name, slug, project_type, location_area, address,
  short_description, full_description, construction_status,
  ownership_type, distance_to_beach, distance_to_airport, latitude, longitude,
  main_image_url, brochure_url, is_featured, is_active, sales_status,
  starting_price_thb, price_range, price_per_sqm_display, last_price_update,
  tagline, highlights, beds_display, area_range, nearby_schools,
  nearby_hospitals, lifestyle, developer_name_raw, location_name_raw,
  developer:developers(id, name, description, website, logo_url),
  media:project_media(id, media_type, title, url, sort_order),
  units:units(id, unit_code, unit_type, bedrooms, bathrooms, size_sqm, floor, view_type, ownership_type, base_price_thb, discounted_price_thb, price_per_sqm, availability_status, payment_plan, furniture_package, rental_guarantee, roi_estimate, notes),
  investment:investment_data(id, project_id, unit_id, expected_daily_rate, expected_monthly_rent, expected_yearly_rent, occupancy_rate, annual_roi_percent, guaranteed_rental_percent, guarantee_years, management_company, notes, created_at)
` as const;

/**
 * Loads the local-development-only Coralina preview, guarded by a direct
 * `import.meta.env.DEV` check on the dynamic import call. See the matching
 * loader in `@/lib/project-service.ts` for why this eliminates the
 * demo-preview module from the production client bundle entirely.
 */
async function loadDemoPreviewProjectDetail(slug: string): Promise<ProjectDetail | null> {
  if (!import.meta.env.DEV) return null;
  const { getDemoPreviewProjectDetail } = await import("./demo-preview");
  return getDemoPreviewProjectDetail(slug);
}

async function loadPartnerDemoProjectDetail(
  slug: string,
): Promise<{ active: boolean; project: ProjectDetail | null }> {
  if (!import.meta.env.DEV) return { active: false, project: null };
  const { getPartnerDemoProjectDetail } = await import("./partner-demo-data");
  const project = await getPartnerDemoProjectDetail(slug);
  const active = import.meta.env.VITE_PARTNER_DEMO === "true";
  return { active, project };
}

export const ProjectDetailService = {
  async getBySlug(slug: string): Promise<ProjectDetail | null> {
    // Quarantined fictitious seed rows must not be reachable by direct URL.
    if (isKnownFictitiousProjectSlug(slug)) return null;

    const partnerDemo = await loadPartnerDemoProjectDetail(slug);
    if (partnerDemo.active) return partnerDemo.project;

    const demoPreview = await loadDemoPreviewProjectDetail(slug);
    if (demoPreview) return demoPreview;

    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_DETAIL_SELECT)
      .eq("is_active", true)
      .eq("slug", slug)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return mapProjectDetail(data as unknown as ProjectDetailRecord);
  },
};
