import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SITEMAP_STATIC_ENTRIES } from "./sitemap";

/**
 * FOREVER-TRUTH-001A: the public Advisory surface may not expose project
 * recommendations, rankings, top-recommendation or "verified evidence"
 * language, or the legacy hardcoded Advisory project — none of it is bound
 * to an evidence contract. `/advisory` and `/advisory/report` are neutral,
 * noindex, data-free placeholders until the later Advisor Workflow phase;
 * the canonical modules under `src/features/advisory/` are retained for that
 * phase but must not be reachable from ordinary public routes.
 */

const ADVISORY_ROUTE_FILES = ["src/routes/advisory.tsx", "src/routes/advisory_.report.tsx"];

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf-8");
}

describe("public Advisory boundary", () => {
  it.each(ADVISORY_ROUTE_FILES)("%s queries no project data", (file) => {
    const source = read(file);
    expect(source).not.toContain("ProjectService");
    expect(source).not.toContain("ProjectDetailService");
    expect(source).not.toContain("projectDetailQuery");
    expect(source).not.toContain("projectListQuery");
    expect(source).not.toContain("supabase");
    expect(source).not.toContain("loader:");
  });

  it.each(ADVISORY_ROUTE_FILES)(
    "%s derives no recommendation and imports no advisory engine",
    (file) => {
      const source = read(file);
      expect(source).not.toContain("deriveProjectRecommendations");
      expect(source).not.toContain("deriveForeverPassport");
      expect(source).not.toContain("AdvisoryWorkspace");
      expect(source).not.toContain("AdvisorReport,");
      expect(source).not.toContain("@/features/advisory");
    },
  );

  it.each(ADVISORY_ROUTE_FILES)(
    "%s contains no legacy slug, ranking, or verified-evidence language",
    (file) => {
      const source = read(file);
      expect(source).not.toContain("the-modeva-bang-tao");
      expect(source.toLowerCase()).not.toContain("ranked");
      expect(source.toLowerCase()).not.toContain("top recommendation");
      expect(source.toLowerCase()).not.toContain("verified evidence");
      expect(source).not.toContain("recommendation");
    },
  );

  it.each(ADVISORY_ROUTE_FILES)("%s is noindex", (file) => {
    const source = read(file);
    expect(source).toContain("noindex, nofollow");
  });

  it("no ordinary public route hardcodes the legacy Advisory slug", () => {
    const routeFiles = [
      "advisory.tsx",
      "advisory_.report.tsx",
      "index.tsx",
      "discovery.tsx",
      "projects.index.tsx",
      "projects.$slug.tsx",
      "about.tsx",
      "contact.tsx",
      "areas.tsx",
      "offers.tsx",
      "reviews.tsx",
      "navigator.tsx",
      "booth.tsx",
      "__root.tsx",
    ];
    for (const file of routeFiles) {
      expect(read(join("src", "routes", file))).not.toContain("the-modeva-bang-tao");
    }
  });

  it("public navigation does not promote Advisory", () => {
    const header = read("src/components/layout/Header.tsx");
    const publicNavBlock = header.slice(
      header.indexOf("const publicNav"),
      header.indexOf("const partnerDemoNav"),
    );
    expect(publicNavBlock).not.toContain('"/advisory"');

    const footer = read("src/components/layout/Footer.tsx");
    expect(footer).not.toContain('"/advisory"');
  });

  it("the sitemap does not advertise Advisory", () => {
    const paths = SITEMAP_STATIC_ENTRIES.map((entry) => entry.path);
    expect(paths).not.toContain("/advisory");
    expect(paths).not.toContain("/advisory/report");
  });
});
