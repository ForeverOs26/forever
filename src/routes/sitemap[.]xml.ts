import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { ProjectService } from "@/lib/project-service";
import { buildSitemapXml } from "@/lib/sitemap";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        let slugs: string[] = [];
        try {
          slugs = await ProjectService.listActiveSlugs();
        } catch (err) {
          console.error("[sitemap] failed to load project slugs", err);
        }

        return new Response(buildSitemapXml(slugs), {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
