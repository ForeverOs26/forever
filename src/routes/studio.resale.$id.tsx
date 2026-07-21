import { createFileRoute } from "@tanstack/react-router";

import { StudioLogin } from "@/features/forever-studio/components/StudioLogin";
import { StudioResaleEditor } from "@/features/forever-studio/components/StudioResaleEditor";
import { StudioShell } from "@/features/forever-studio/components/StudioShell";
import { useStudioSession } from "@/features/forever-studio/components/useStudioSession";

export const Route = createFileRoute("/studio/resale/$id")({
  head: () => ({
    meta: [
      { title: "Edit resale listing — Forever Studio" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StudioResaleRoute,
});

function StudioResaleRoute() {
  const session = useStudioSession();
  const { id } = Route.useParams();
  if (session.status === "loading") {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (session.status === "signed_out") return <StudioLogin />;
  return (
    <StudioShell email={session.email}>
      <StudioResaleEditor listingId={id} />
    </StudioShell>
  );
}
