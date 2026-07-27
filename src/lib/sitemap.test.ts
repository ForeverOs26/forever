import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PUBLIC_SITE_ORIGIN,
  SITEMAP_BASE_URL,
  SITEMAP_STATIC_ENTRIES,
  buildRobotsTxt,
  buildSitemapXml,
} from "./sitemap";

/**
 * FOREVER-TRUTH-001A: the sitemap advertises only surfaces with real,
 * source-backed content. `/offers` and `/reviews` render honest empty states
 * and must not be promoted to crawlers until real content exists.
 */
describe("sitemap composition", () => {
  it("does not advertise the offers, reviews, or areas placeholders", () => {
    const paths = SITEMAP_STATIC_ENTRIES.map((entry) => entry.path);
    expect(paths).not.toContain("/offers");
    expect(paths).not.toContain("/reviews");
    expect(paths).not.toContain("/areas");
  });

  it("marks every evidence-dependent empty placeholder noindex, nofollow", () => {
    for (const route of ["offers.tsx", "reviews.tsx", "areas.tsx"]) {
      const source = readFileSync(join(process.cwd(), "src", "routes", route), "utf-8");
      expect(source).toContain('name: "robots", content: "noindex, nofollow"');
    }
  });

  it("keeps the core public surfaces", () => {
    const paths = SITEMAP_STATIC_ENTRIES.map((entry) => entry.path);
    expect(paths).toEqual(
      expect.arrayContaining(["/", "/projects", "/discovery", "/about", "/contact"]),
    );
  });

  it("emits exactly the provided project slugs as project URLs", () => {
    const xml = buildSitemapXml(["modeva"]);
    // Asserted against the configured origin, not a literal: a production build
    // sets VITE_PUBLIC_SITE_ORIGIN, and the sitemap must follow it.
    expect(xml).toContain(`<loc>${SITEMAP_BASE_URL}/projects/modeva</loc>`);
    expect(SITEMAP_BASE_URL).toMatch(/^https:\/\/[^/]+$/);
    expect(xml).not.toContain("/offers");
    expect(xml).not.toContain("/reviews");
    expect(xml).not.toContain("/areas");
    const projectUrls = xml.match(/\/projects\/[a-z0-9-]+<\/loc>/g) ?? [];
    expect(projectUrls).toEqual(["/projects/modeva</loc>"]);
  });

  it("produces a well-formed urlset for an empty catalogue", () => {
    const xml = buildSitemapXml([]);
    expect(xml).toContain(`<?xml version="1.0" encoding="UTF-8"?>`);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("/projects/undefined");
  });

  /**
   * F-007: the Navigator is the homepage's primary call to action and a real
   * public surface, but was absent from the sitemap entirely.
   */
  it("advertises the Navigator", () => {
    expect(SITEMAP_STATIC_ENTRIES.map((entry) => entry.path)).toContain("/navigator");
    expect(buildSitemapXml([])).toContain(`<loc>${SITEMAP_BASE_URL}/navigator</loc>`);
  });
});

/**
 * F-019: the live robots.txt was a static file with the origin typed into it,
 * and still pointed crawlers at the superseded Lovable project host — a dead
 * foreign domain — long after the site moved. It is now derived from the same
 * configured origin canonical URLs and the sitemap use.
 */
describe("robots.txt", () => {
  it("points at the sitemap on the configured origin", () => {
    expect(buildRobotsTxt("https://forever.phuketre22.workers.dev")).toContain(
      "Sitemap: https://forever.phuketre22.workers.dev/sitemap.xml",
    );
  });

  it("stays configurable for local and test origins", () => {
    expect(buildRobotsTxt("http://localhost:5199")).toContain(
      "Sitemap: http://localhost:5199/sitemap.xml",
    );
    expect(buildRobotsTxt("https://staging.example.com/")).toContain(
      "Sitemap: https://staging.example.com/sitemap.xml",
    );
  });

  it("falls back to the configured public origin and agrees with the sitemap", () => {
    expect(buildRobotsTxt()).toContain(`Sitemap: ${PUBLIC_SITE_ORIGIN}/sitemap.xml`);
    // robots.txt and sitemap.xml must never state two different origins.
    expect(PUBLIC_SITE_ORIGIN).toBe(SITEMAP_BASE_URL);
  });

  it("keeps crawling allowed", () => {
    const body = buildRobotsTxt();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
  });

  it("can never regress to the dead lovable.app host", () => {
    // Guards the fallback as well as the output: a build with no
    // VITE_PUBLIC_SITE_ORIGIN must not resurrect the superseded project host.
    for (const output of [buildRobotsTxt(), buildSitemapXml(["modeva"]), PUBLIC_SITE_ORIGIN]) {
      expect(output).not.toContain("lovable.app");
    }
  });

  it("is served from the app, not from a hand-edited static file", () => {
    // A `public/robots.txt` would shadow the route and silently reintroduce a
    // hardcoded origin.
    expect(existsSync(join(process.cwd(), "public", "robots.txt"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src", "routes", "robots[.]txt.ts"))).toBe(true);
  });
});
