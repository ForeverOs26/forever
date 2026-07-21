import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SITEMAP_STATIC_ENTRIES, buildSitemapXml } from "./sitemap";

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
    expect(xml).toContain("<loc>https://forever-home-core.lovable.app/projects/modeva</loc>");
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
});
