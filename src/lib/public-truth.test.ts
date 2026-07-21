import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import * as data from "./data";
import {
  EVIDENCE_UNPROVEN_ADVISORY_COLUMNS,
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

// Display names, reviewer names, developer names, and unconfirmed contact
// claims may appear nowhere in src/.
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
  // Contact/office claims not confirmable from the repository
  // (FOREVER-TRUTH-001A finding: no unconfirmed contact details in public UI).
  "advisors@forever.property",
  "Cherng Talay",
  "Forever Private Office",
  "@ForeverProperty",
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

/**
 * Repository-relative path with forward slashes on every platform. Windows
 * `path.relative` produces backslash separators; without this normalization
 * the allow-list comparisons below would never match on Windows and the scan
 * would flag its own forbidden-name list.
 */
function toRepoRelativePath(file: string): string {
  return relative(process.cwd(), file).replaceAll("\\", "/");
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

  it("the shared data module no longer exports fabricated offers, reviews, or areas", () => {
    const exported = data as Record<string, unknown>;
    expect(exported.offers).toBeUndefined();
    expect(exported.reviews).toBeUndefined();
    expect(exported.areas).toBeUndefined();
  });

  it("declares the legacy advisory scalars as evidence-unproven", () => {
    expect(EVIDENCE_UNPROVEN_ADVISORY_COLUMNS).toEqual(
      expect.arrayContaining([
        "forever_verified",
        "verified_price",
        "trust_score",
        "investment_value",
        "verdict",
        "market_position",
        "rental_demand",
        "rental_yield",
        "capital_growth_estimate",
        "last_inspection",
        "promotion",
      ]),
    );
  });
});

describe("fictitious entities stay out of application source", () => {
  const files = listSourceFiles(SRC_ROOT);

  it("scans a realistic number of source files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("normalizes Windows-style separators to repository-relative POSIX paths", () => {
    const windowsStyle = join(process.cwd(), "src", "lib", "public-truth.test.ts").replaceAll(
      "/",
      "\\",
    );
    // `relative` accepts either separator style on Windows; on POSIX we prove
    // the backslash replacement directly on its output shape instead.
    expect("src\\lib\\public-truth.test.ts".replaceAll("\\", "/")).toBe(
      "src/lib/public-truth.test.ts",
    );
    expect(toRepoRelativePath(join(process.cwd(), "src/lib/public-truth.test.ts"))).toBe(
      "src/lib/public-truth.test.ts",
    );
    expect(windowsStyle.replaceAll("\\", "/")).toContain("src/lib/public-truth.test.ts");
  });

  it("no fictitious project, reviewer, or developer name appears anywhere in src/", () => {
    const offending: string[] = [];
    for (const file of files) {
      const relativePath = toRepoRelativePath(file);
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
      const relativePath = toRepoRelativePath(file);
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
