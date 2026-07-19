import { supabase } from "@/integrations/supabase/client";
import { mapProjectDetail } from "./project-detail-mappers";
import type { ProjectDetail, ProjectDetailRecord } from "./project-detail-types";

export const PROJECT_DETAIL_SELECT = `
  *,
  developer:developers(*),
  media:project_media(*),
  units:units(*),
  investment:investment_data(*)
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
