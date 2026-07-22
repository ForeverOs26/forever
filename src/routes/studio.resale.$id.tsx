import { createFileRoute } from "@tanstack/react-router";

import { StudioResaleEditor } from "@/features/forever-studio/components/StudioResaleEditor";

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
  const { id } = Route.useParams();
  return <StudioResaleEditor listingId={id} />;
}
