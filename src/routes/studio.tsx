import { createFileRoute } from "@tanstack/react-router";

import { StudioDashboard } from "@/features/forever-studio/components/StudioDashboard";
import { StudioLogin } from "@/features/forever-studio/components/StudioLogin";
import { StudioShell } from "@/features/forever-studio/components/StudioShell";
import { useStudioSession } from "@/features/forever-studio/components/useStudioSession";

/**
 * Forever Studio (FOREVER-STUDIO-001): the authenticated publisher tool.
 * Internal working surface — never indexed, never linked from public
 * navigation or the sitemap. The browser session only unlocks the shell;
 * every operation is re-authorized at the server boundary.
 */
export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [{ title: "Forever Studio" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: StudioRoute,
});

function StudioRoute() {
  const session = useStudioSession();
  if (session.status === "loading") {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (session.status === "signed_out") return <StudioLogin />;
  return (
    <StudioShell email={session.email}>
      <StudioDashboard />
    </StudioShell>
  );
}
