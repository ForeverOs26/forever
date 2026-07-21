import { createFileRoute } from "@tanstack/react-router";

import { StudioMembers } from "@/features/forever-studio/components/StudioMembers";

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
  return <StudioMembers />;
}
