import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { buildRobotsTxt } from "@/lib/sitemap";

/**
 * robots.txt is served from the app rather than `public/` so its Sitemap line
 * follows the configured public origin, exactly as canonical URLs and
 * sitemap.xml already do. The static file it replaced still named the
 * superseded Lovable project host the site was first built on (F-019).
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildRobotsTxt(), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
