import { createFileRoute } from "@tanstack/react-router";

import { StudioProjectEditor } from "@/features/forever-studio/components/StudioProjectEditor";

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
  const { slug } = Route.useParams();
  return <StudioProjectEditor slug={slug} />;
}
