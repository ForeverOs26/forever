import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import * as data from "./data";
import {
  KNOWN_FICTITIOUS_PROJECT_SLUGS,
  excludeKnownFictitiousProjects,
  isKnownFictitiousProjectSlug,
} from "./public-truth";

/**
 * FOREVER-TRUTH-001A regression guards.
 *
 * The fictitious entities below were seeded by migration `20260704060123`
 * and rendered by earlier static UI content. They must never reappear in
 * application source: not as data, not as copy, not as fixtures. The slugs
 * themselves are allowed only inside the quarantine policy module (and this
 * test), where they exist to keep the rows unreachable.
 */

const SRC_ROOT = join(process.cwd(), "src");

// Display names, reviewer names, and developer names may appear nowhere in src/.
const FORBIDDEN_EVERYWHERE = [
  "Surin Ridge Villas",
  "Kamala Beach Residences",
  "Layan Forest Villas",
  "Bang Tao Garden Villas",
  "Kata Cliff Residences",
  "Rawai Courtyard Villas",
  "Priya & Marcus Chen",
  "Alina Fischer",
  "Okafor",
  "Julien Marceau",
  "Sofia Delacroix",
  "Andaman Ridge Developments",
  "Andara Signature Group",
  "Layan Estate Co",
  "Laguna Property Partners",
  "Cape Kata Estates",
  "South Cape Homes",
];

// Quarantine keys may appear only in the policy module and in tests that
// exercise the policy.
const SLUG_ALLOWED_FILES = new Set([
  "src/lib/public-truth.ts",
  "src/lib/public-truth.test.ts",
  "src/lib/project-service.test.ts",
]);

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("public truth policy", () => {
  it("quarantines exactly the six seeded fictitious projects", () => {
    expect(KNOWN_FICTITIOUS_PROJECT_SLUGS).toHaveLength(6);
    for (const slug of KNOWN_FICTITIOUS_PROJECT_SLUGS) {
      expect(isKnownFictitiousProjectSlug(slug)).toBe(true);
    }
    expect(isKnownFictitiousProjectSlug("modeva")).toBe(false);
    expect(isKnownFictitiousProjectSlug("coralina")).toBe(false);
  });

  it("excludeKnownFictitiousProjects removes only quarantined rows", () => {
    const rows = [
      { slug: "modeva" },
      { slug: "surin-ridge-villas" },
      { slug: "kata-cliff-residences" },
    ];
    expect(excludeKnownFictitiousProjects(rows)).toEqual([{ slug: "modeva" }]);
  });

  it("the shared data module no longer exports fabricated offers or reviews", () => {
    const exported = data as Record<string, unknown>;
    expect(exported.offers).toBeUndefined();
    expect(exported.reviews).toBeUndefined();
  });

  it("editorial areas carry no listing counts", () => {
    for (const area of data.areas) {
      expect(area).not.toHaveProperty("listings");
    }
  });
});

describe("fictitious entities stay out of application source", () => {
  const files = listSourceFiles(SRC_ROOT);

  it("scans a realistic number of source files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no fictitious project, reviewer, or developer name appears anywhere in src/", () => {
    const offending: string[] = [];
    for (const file of files) {
      const relativePath = relative(process.cwd(), file);
      if (relativePath === "src/lib/public-truth.test.ts") continue;
      const source = readFileSync(file, "utf-8");
      for (const name of FORBIDDEN_EVERYWHERE) {
        if (source.includes(name)) {
          offending.push(`${relativePath}: ${name}`);
        }
      }
    }
    expect(offending).toEqual([]);
  });

  it("fictitious slugs appear only in the quarantine policy and its tests", () => {
    const offending: string[] = [];
    for (const file of files) {
      const relativePath = relative(process.cwd(), file).replaceAll("\\", "/");
      if (SLUG_ALLOWED_FILES.has(relativePath)) continue;
      const source = readFileSync(file, "utf-8");
      for (const slug of KNOWN_FICTITIOUS_PROJECT_SLUGS) {
        if (source.includes(slug)) {
          offending.push(`${relativePath}: ${slug}`);
        }
      }
    }
    expect(offending).toEqual([]);
  });

  it("the bundled stock villa photos are gone", () => {
    const assets = readdirSync(join(SRC_ROOT, "assets"));
    expect(assets.filter((name) => /^villa-/.test(name))).toEqual([]);
  });
});
