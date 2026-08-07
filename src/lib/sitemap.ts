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

import { PUBLIC_SITE_ORIGIN } from "./site-origin";

/**
 * Absolute origin the public site is served from.
 *
 * Canonical URLs, Open Graph URLs, breadcrumb structured data and the sitemap
 * must all state the origin the build is actually deployed to, so this is
 * configuration rather than a constant: set `VITE_PUBLIC_SITE_ORIGIN` for the
 * production build. It is a public identifier, never a credential, so inlining
 * it into the client bundle is intended.
 *
 * It is declared ONCE, in `@/lib/site-origin`, and re-exported here so this
 * module's existing consumers are unchanged. The same value now also decides
 * whether a request may start a Studio upload, and two origin constants that
 * could drift apart would make that decision unreviewable.
 *
 * The fallback is the live public origin, so a build that forgets the variable
 * still advertises the host the site is actually served from. It previously
 * named the superseded Lovable project host the site was first built on, which
 * is how robots.txt came to point crawlers at a dead foreign domain (F-019).
 * That hostname must never return there — `sitemap.test.ts` fails the build if
 * any origin, sitemap or robots output mentions it again.
 */
export { PUBLIC_SITE_ORIGIN };

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
  // The Navigator is the homepage's primary call to action and a real public
  // surface, so it belongs in the sitemap. It was absent while being linked as
  // the main CTA (F-007).
  { path: "/navigator", changefreq: "monthly", priority: "0.7" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
  { path: "/contact", changefreq: "yearly", priority: "0.5" },
];

/**
 * robots.txt body, stating the sitemap on the configured origin.
 *
 * This used to be a static `public/robots.txt` with the origin typed into it
 * by hand, which is why it still advertised the superseded Lovable project
 * host long after the site moved (F-019). Deriving it from `PUBLIC_SITE_ORIGIN` —
 * the same value canonical URLs and the sitemap already use — means the three
 * can no longer disagree.
 */
export function buildRobotsTxt(origin: string = PUBLIC_SITE_ORIGIN): string {
  const base = origin.replace(/\/+$/, "");
  return ["User-agent: *", "Allow: /", "", `Sitemap: ${base}/sitemap.xml`, ""].join("\n");
}

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
