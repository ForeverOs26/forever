/**
 * Sitemap composition (FOREVER-TRUTH-001A).
 *
 * Only surfaces with real published content are advertised. `/offers`,
 * `/reviews`, and `/areas` are intentionally absent: no confirmed offer,
 * consented client review, or source-backed area guide is published yet, so
 * those routes render honest empty states and are not promoted to crawlers.
 * Project URLs come from `ProjectService.listActiveSlugs()`, which excludes
 * known-fictitious seed slugs (see `@/lib/public-truth`).
 */

/**
 * Absolute origin the public site is served from.
 *
 * Canonical URLs, Open Graph URLs, breadcrumb structured data and the sitemap
 * must all state the origin the build is actually deployed to, so this is
 * configuration rather than a constant: set `VITE_PUBLIC_SITE_ORIGIN` for the
 * production build. It is a public identifier, never a credential, so inlining
 * it into the client bundle is intended.
 *
 * The fallback is the historical origin, kept so a developer build without the
 * variable still produces well-formed absolute URLs.
 */
export const PUBLIC_SITE_ORIGIN = (
  import.meta.env.VITE_PUBLIC_SITE_ORIGIN ?? "https://forever-home-core.lovable.app"
).replace(/\/+$/, "");

export const SITEMAP_BASE_URL = PUBLIC_SITE_ORIGIN;

export interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const SITEMAP_STATIC_ENTRIES: readonly SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/projects", changefreq: "weekly", priority: "0.9" },
  { path: "/discovery", changefreq: "weekly", priority: "0.9" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
  { path: "/contact", changefreq: "yearly", priority: "0.5" },
];

export function buildSitemapXml(projectSlugs: string[]): string {
  const entries: SitemapEntry[] = [
    ...SITEMAP_STATIC_ENTRIES,
    ...projectSlugs.map((slug) => ({
      path: `/projects/${slug}`,
      changefreq: "weekly" as const,
      priority: "0.8",
    })),
  ];

  const urls = entries.map((e) =>
    [
      `  <url>`,
      `    <loc>${SITEMAP_BASE_URL}${e.path}</loc>`,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      `  </url>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}
