import { createFileRoute } from "@tanstack/react-router";

import { StudioLogin } from "@/features/forever-studio/components/StudioLogin";
import { StudioShell } from "@/features/forever-studio/components/StudioShell";
import { StudioUploader } from "@/features/forever-studio/components/StudioUploader";
import { useStudioSession } from "@/features/forever-studio/components/useStudioSession";
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
  const session = useStudioSession();
  const { workflow, slug } = Route.useSearch();
  if (session.status === "loading") {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (session.status === "signed_out") return <StudioLogin />;
  return (
    <StudioShell email={session.email}>
      <StudioUploader workflow={workflow} slug={slug} />
    </StudioShell>
  );
}
