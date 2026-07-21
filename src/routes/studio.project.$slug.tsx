import { createFileRoute } from "@tanstack/react-router";

import { StudioLogin } from "@/features/forever-studio/components/StudioLogin";
import { StudioProjectEditor } from "@/features/forever-studio/components/StudioProjectEditor";
import { StudioShell } from "@/features/forever-studio/components/StudioShell";
import { useStudioSession } from "@/features/forever-studio/components/useStudioSession";

export const Route = createFileRoute("/studio/project/$slug")({
  head: () => ({
    meta: [
      { title: "Edit project — Forever Studio" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StudioProjectRoute,
});

function StudioProjectRoute() {
  const session = useStudioSession();
  const { slug } = Route.useParams();
  if (session.status === "loading") {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (session.status === "signed_out") return <StudioLogin />;
  return (
    <StudioShell email={session.email}>
      <StudioProjectEditor slug={slug} />
    </StudioShell>
  );
}
