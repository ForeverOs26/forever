import { createFileRoute } from "@tanstack/react-router";

import { StudioLogin } from "@/features/forever-studio/components/StudioLogin";
import { StudioMembers } from "@/features/forever-studio/components/StudioMembers";
import { StudioShell } from "@/features/forever-studio/components/StudioShell";
import { useStudioSession } from "@/features/forever-studio/components/useStudioSession";

export const Route = createFileRoute("/studio/members")({
  head: () => ({
    meta: [
      { title: "Publishers — Forever Studio" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StudioMembersRoute,
});

function StudioMembersRoute() {
  const session = useStudioSession();
  if (session.status === "loading") {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (session.status === "signed_out") return <StudioLogin />;
  return (
    <StudioShell email={session.email}>
      <StudioMembers />
    </StudioShell>
  );
}
