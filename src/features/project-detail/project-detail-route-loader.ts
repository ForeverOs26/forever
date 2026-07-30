import type { QueryClient } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";

import { projectRelatedPublishedQuery, type RelatedPublishedProject } from "@/lib/project-service";

import { projectDetailQuery } from "./project-detail-query";

export async function loadProjectDetailRouteData(queryClient: QueryClient, slug: string) {
  const project = await queryClient.ensureQueryData(projectDetailQuery(slug));
  if (!project) throw notFound();

  // Deterministic local previews have no public database dependency. Related
  // projects are optional even for public records: their reader must never
  // replace a successfully loaded core project with an error page.
  let relatedProjects: RelatedPublishedProject[] = [];
  if (!project.core.isDemoPreview && !project.core.usesLocalPreviewData) {
    try {
      relatedProjects = await queryClient.ensureQueryData(projectRelatedPublishedQuery(slug));
    } catch {
      relatedProjects = [];
    }
  }

  return { project, relatedProjects };
}
