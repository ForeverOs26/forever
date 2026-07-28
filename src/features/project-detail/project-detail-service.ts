import { supabase } from "@/integrations/supabase/client";
import { isKnownFictitiousProjectSlug } from "@/lib/public-truth";
import { mapProjectDetail } from "./project-detail-mappers";
import type { ProjectDetail, ProjectDetailRecord } from "./project-detail-types";

/**
 * DEPLOY ORDER IS PART OF THIS CONTRACT.
 *
 * This projection requests `project_media.semantic_role`
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001). PostgREST fails an ENTIRE
 * embedded select with 42703 when a requested column does not exist — so
 * deploying this client before
 * `supabase/migrations/20260728120000_project_media_semantic_role.sql` has been
 * applied would blank every project page, not merely one section.
 *
 * The migration must be applied, and the grant verified, BEFORE any build
 * containing this line reaches production. The release sequence records this as
 * a hard gate.
 *
 * The column carries presentation data only. No provenance column is added
 * here: `metadata` holds source paths, package directories and sanitizer
 * records and remains unreadable by the anonymous role.
 *
 * The projection also embeds `project_amenities` with its `amenities` parent —
 * the canonical relation, and the only relation of its kind in the generated
 * types. Both tables grant `SELECT` to `anon`, and their row-level policies
 * expose amenities of published projects. The embed was exercised against the
 * live database on the original PR and returned the projects unchanged, with an
 * empty `amenities` array where the relation held no rows.
 *
 * Both fields are hard query contracts: a missing column or failing embed does
 * not hide one section. PostgREST rejects the whole select and blanks the page.
 *
 * SECOND DEPLOY GATE. `is_featured` and `sort_order` join that embed as of
 * `supabase/migrations/20260728160000_studio_project_amenities_editor.sql`, and
 * carry the same all-or-nothing failure mode as `semantic_role`: that migration
 * must be applied BEFORE any build containing this line reaches production.
 *
 * The grant they rely on is the table-level `GRANT SELECT ON
 * public.project_amenities TO anon, authenticated` from the base migration,
 * which covers columns added later, so they need no grant of their own. Both
 * are `NOT NULL` with a default, so the embed returns them for every visible
 * row including rows written before the columns existed.
 */
export const PROJECT_DETAIL_SELECT = `
  id, name, slug, project_type, location_area, address,
  short_description, full_description, construction_status,
  ownership_type, distance_to_beach, distance_to_airport, latitude, longitude,
  main_image_url, brochure_url, is_featured, is_active, sales_status,
  starting_price_thb, price_range, price_per_sqm_display, last_price_update,
  tagline, highlights, beds_display, area_range, nearby_schools,
  nearby_hospitals, lifestyle, developer_name_raw, location_name_raw,
  developer:developers(id, name, description, website, logo_url),
  media:project_media(id, media_type, title, url, sort_order, semantic_role),
  units:units(id, unit_code, unit_type, bedrooms, bathrooms, size_sqm, floor, view_type, ownership_type, base_price_thb, discounted_price_thb, price_per_sqm, availability_status, payment_plan, furniture_package, rental_guarantee, roi_estimate, notes, building:buildings(building_code)),
  investment:investment_data(id, project_id, unit_id, expected_daily_rate, expected_monthly_rent, expected_yearly_rent, occupancy_rate, annual_roi_percent, guaranteed_rental_percent, guarantee_years, management_company, notes, created_at),
  amenities:project_amenities(note, is_featured, sort_order, amenity:amenities(id, name, slug, category, icon))
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
