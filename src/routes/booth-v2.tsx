import { createFileRoute } from "@tanstack/react-router";

import { BoothV2Navigator } from "@/features/navigator/booth-v2";

/**
 * Booth Mode 2.0 — the Forever Assisted Decision Concierge (pilot).
 *
 * Parallel pilot route: `/booth` keeps the legacy booth untouched while this
 * shell is reviewed. Staff-only, deliberately NOT in public navigation or the
 * sitemap; `noindex` keeps it out of search. Replacing `/booth` with this
 * flow is a separate, explicit Owner action documented in
 * docs/FOREVER_BOOTH_ASSISTED_DECISION_001.md.
 */
export const Route = createFileRoute("/booth-v2")({
  head: () => ({
    meta: [
      { title: "Forever — Booth Mode 2.0 (Pilot)" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content:
          "Staff-guided Forever Assisted Decision Concierge pilot. Quick or Full Decision Profile, truthful initial directions, verified WhatsApp handoff to a named Guide.",
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
  component: BoothV2Route,
});

function BoothV2Route() {
  return <BoothV2Navigator />;
}
