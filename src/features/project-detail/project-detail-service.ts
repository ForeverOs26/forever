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

export const ProjectDetailService = {
  async getBySlug(slug: string): Promise<ProjectDetail | null> {
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
