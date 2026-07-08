import { queryOptions } from "@tanstack/react-query";
import { ProjectDetailService } from "./project-detail-service";

export const projectDetailKeys = {
  all: ["project-detail"] as const,
  detail: (slug: string) => [...projectDetailKeys.all, slug] as const,
};

export const projectDetailQuery = (slug: string) =>
  queryOptions({
    queryKey: projectDetailKeys.detail(slug),
    queryFn: () => ProjectDetailService.getBySlug(slug),
  });
