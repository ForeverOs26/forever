import { createFileRoute } from "@tanstack/react-router";

import { StudioDashboard } from "@/features/forever-studio/components/StudioDashboard";

export const Route = createFileRoute("/studio/")({
  component: StudioIndexRoute,
});

function StudioIndexRoute() {
  return <StudioDashboard />;
}
