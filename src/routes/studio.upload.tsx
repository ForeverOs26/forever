import { createFileRoute } from "@tanstack/react-router";

import { StudioUploader } from "@/features/forever-studio/components/StudioUploader";
import { STUDIO_WORKFLOWS, type StudioWorkflow } from "@/features/forever-studio/studio-types";

export const Route = createFileRoute("/studio/upload")({
  validateSearch: (search: Record<string, unknown>) => ({
    workflow: STUDIO_WORKFLOWS.includes(search.workflow as StudioWorkflow)
      ? (search.workflow as StudioWorkflow)
      : undefined,
    slug: typeof search.slug === "string" ? search.slug : undefined,
  }),
  head: () => ({
    meta: [{ title: "Upload — Forever Studio" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: StudioUploadRoute,
});

function StudioUploadRoute() {
  const { workflow, slug } = Route.useSearch();
  return <StudioUploader workflow={workflow} slug={slug} />;
}
