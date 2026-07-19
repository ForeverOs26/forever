import { createFileRoute } from "@tanstack/react-router";

import { BoothNavigator } from "@/features/navigator/booth";

/**
 * Booth Mode — the Forever employee tablet workflow.
 *
 * Same shared Navigator Core as `/navigator`, a different presentation shell.
 * Intentionally NOT added to public navigation yet. `noindex` so it stays out of
 * search while it is staff-only.
 */
export const Route = createFileRoute("/booth")({
  head: () => ({
    meta: [
      { title: "Forever Navigator — Booth Mode" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Staff-guided Forever Navigator for in-person consultations on a tablet. One shared Navigator Core, booth presentation.",
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
  component: BoothRoute,
});

function BoothRoute() {
  return <BoothNavigator />;
}
