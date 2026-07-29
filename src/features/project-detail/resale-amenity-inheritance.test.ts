/**
 * The resale amenities boundary (FOREVER-STUDIO-AMENITIES-CORE-001).
 *
 * THE CONTRACT
 * ------------
 * A resale listing does not own amenities. It inherits them:
 *
 *     resale listing → linked project → project_amenities → amenities
 *
 * There is exactly one place a project's amenity set is stored, and a resale
 * listing in that project is a view onto it. That matters because the
 * alternative — a `resale_amenities` table, or an amenity array on
 * `listings` — creates a second copy that drifts the first time an Owner edits
 * the project and not the listing, and a buyer comparing a resale unit against
 * the new-build page then sees two different pools.
 *
 * WHAT IS UNIT-SPECIFIC AND THEREFORE NOT AN AMENITY
 * --------------------------------------------------
 * Sea view, pool access, private garden, corner unit, high floor, furnished,
 * renovated, private pool, foreign freehold quota. These describe one unit, not
 * the project, so they belong to whatever models a unit — never to
 * `project_amenities`, which is keyed `(project_id, amenity_id)` and cannot
 * express "this unit only".
 *
 * WHAT THIS TASK DOES AND DOES NOT DO
 * -----------------------------------
 * It documents and pins the inheritance rule. It does NOT build the resale
 * read, because the public resale path cannot reach the project yet:
 * `public.listings.project_id` exists in the database and the Studio resale
 * publish RPC populates it, but it is absent from `LISTING_SELECT` and from
 * `PublicListing`, and there is no project-id-keyed amenity reader. Widening a
 * public projection and adding a reader is a change with its own privacy
 * review; inventing a second storage model to avoid it is not the alternative.
 * The follow-up is recorded in this task's RESALE_BOUNDARY report.
 *
 * So this file asserts the negative — that no second storage model exists — and
 * pins the one column the future read will hang off.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const SRC = resolve(root, "src");
const MIGRATIONS = resolve(root, "supabase/migrations");

function repoPath(file: string): string {
  return relative(root, file).split("\\").join("/");
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if ([".ts", ".tsx"].includes(extname(entry))) found.push(full);
  }
  return found;
}

/** This file names the forbidden shapes, so it is the one place they appear. */
const SELF = "src/features/project-detail/resale-amenity-inheritance.test.ts";

describe("a resale listing inherits project amenities rather than storing its own", () => {
  it("declares no second amenity table in any migration", () => {
    const forbidden = [
      /\bresale_amenities\b/i,
      /\blisting_amenities\b/i,
      /\bunit_amenities\b/i,
      /\bCREATE\s+TABLE[^;]*\.\s*resale_[a-z_]*amenit/i,
    ];

    for (const entry of readdirSync(MIGRATIONS)) {
      if (!entry.endsWith(".sql")) continue;
      const sql = readFileSync(join(MIGRATIONS, entry), "utf8");
      for (const pattern of forbidden) {
        expect(sql, `${entry} ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("declares no second amenity model in any source file", () => {
    const forbidden = [
      /\bresale_amenities\b/i,
      /\bresaleAmenities\b/,
      /\blisting_amenities\b/i,
      /\blistingAmenities\b/,
      /\bunit_amenities\b/i,
    ];
    const offences: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const path = repoPath(file);
      if (path === SELF) continue;
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(source)) offences.push(`${path}: ${pattern}`);
      }
    }

    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("keeps the project link that the inheritance chain depends on", () => {
    // `listings.project_id` is the single hop from a resale listing to the
    // project whose amenities it inherits. If it ever disappears, the
    // inheritance contract has no mechanism and this file should fail loudly
    // rather than the contract quietly becoming aspirational.
    const progressive = readFileSync(
      join(MIGRATIONS, "20260718113000_progressive_ingestion_v1.sql"),
      "utf8",
    );
    expect(progressive).toMatch(
      /project_id UUID REFERENCES public\.projects\(id\) ON DELETE SET NULL/,
    );
  });

  it("stores the project's amenity set in exactly one place", () => {
    // One writer, one relation. The Owner's save reconciles
    // `project_amenities` and nothing else, so there is no second set for a
    // resale view to disagree with.
    const editor = readdirSync(MIGRATIONS).filter((entry) =>
      entry.includes("studio_project_amenities_editor"),
    );
    expect(editor).toHaveLength(1);
    const sql = readFileSync(join(MIGRATIONS, editor[0]), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    const written = [...sql.matchAll(/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+(public\.\w+)/gi)]
      .map((match) => match[1])
      .filter((table, index, all) => all.indexOf(table) === index)
      .sort();

    // The save writes the link table and the catalogue the Owner may add to.
    // Anything else appearing here is a scope leak.
    expect(written).toEqual(["public.amenities", "public.project_amenities"]);
  });

  it("does not yet expose the project link publicly, and says so rather than faking it", () => {
    // An honest negative. The public resale projection has no `project_id`, so
    // a resale page cannot read project amenities today. This assertion exists
    // so that when someone does widen the projection, they are led straight to
    // the inheritance contract above instead of reaching for a new table.
    const listingService = readFileSync(resolve(SRC, "lib/listing-service.ts"), "utf8");
    const select = listingService.slice(
      listingService.indexOf("const LISTING_SELECT"),
      listingService.indexOf("const UUID_PATTERN"),
    );
    expect(select).not.toMatch(/\bproject_id\b/);
    expect(listingService).not.toMatch(/\bamenit/i);
  });
});
