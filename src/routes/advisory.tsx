import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { SiteShell } from "@/components/SiteShell";
import { AdvisoryWorkspace, DEMO_SESSION, type AdvisoryActionId } from "@/features/advisory";

export const Route = createFileRoute("/advisory")({
  head: () => ({
    meta: [
      { title: "Forever Advisory Workspace" },
      {
        name: "description",
        content:
          "Demo-only advisory workspace for preparing a Phuket property consultation with deterministic session data.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,300;6..72,400&display=swap",
      },
    ],
  }),
  component: AdvisoryRoute,
});

function AdvisoryRoute() {
  const handleAction = useCallback((actionId: AdvisoryActionId) => {
    console.info("[advisory-demo] action emitted", { actionId });
  }, []);

  return (
    <SiteShell>
      <div className="bg-[#F3EFE7] py-6 sm:py-8">
        <AdvisoryWorkspace session={DEMO_SESSION} onAction={handleAction} />
      </div>
    </SiteShell>
  );
}
