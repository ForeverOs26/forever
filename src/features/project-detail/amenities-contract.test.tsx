/**
 * The amenities contract (FOREVER-PR118-AMENITIES-CONTRACT-CORRECTION-001).
 *
 * The public "Facilities & Amenities" section is backed by exactly one thing:
 * the `project_amenities` → `amenities` relation. Two rules follow, and this
 * file pins both.
 *
 * First, the names. An earlier revision of this work modelled the section on
 * `facilities` / `project_facilities` with a `sort_order`. Those tables do
 * exist — `20260707101000_fdb001_inventory_facilities.sql` creates them — but
 * they are absent from the generated Supabase types, so the typed client
 * cannot embed them, and maintaining two parallel amenity models is how the
 * two drift apart. `amenities` is the canonical one: it is in the generated
 * types, and it is the relation the public query reads. Database terminology
 * is `amenity` throughout; only the visible heading says "Facilities &
 * Amenities", because that is what a buyer calls it.
 *
 * Second, the provenance. Nothing but the relation may become an amenity — not
 * a highlight, not a description, not a photograph, not a project type.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeAmenity, makeProjectDetail } from "@/features/forever-database/tests/fixtures";

import { ProjectAmenities } from "./components/ProjectAmenities";
import { mapProjectAmenities } from "./project-detail-mappers";
import { PROJECT_DETAIL_SELECT } from "./project-detail-service";
import type { ProjectAmenityRow } from "./project-detail-types";
import { hasAmenitiesSection, projectAmenities, projectSections } from "./project-sections";

const root = process.cwd();
const FEATURE_ROOT = resolve(root, "src/features/project-detail");

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

/** This file states the rule, so it is the one place the false names appear. */
const SELF = resolve(FEATURE_ROOT, "amenities-contract.test.tsx");

describe("the amenities model has one name", () => {
  it("names no facilities table anywhere in the project-detail feature", () => {
    for (const file of sourceFiles(FEATURE_ROOT)) {
      if (file === SELF) continue;
      const source = readFileSync(file, "utf8");

      // The relation, the join column, and the old public model.
      expect(source, file).not.toContain("project_facilities");
      expect(source, file).not.toContain("facility_id");
      expect(source, file).not.toContain("ProjectFacilityRow");
      expect(source, file).not.toContain("mapProjectFacilities");
      // A `facilities` embed or table read, in either PostgREST or client form.
      expect(source, file).not.toMatch(/\bfrom\(\s*["']facilities["']\s*\)/);
      expect(source, file).not.toMatch(/\bfacilities\s*:\s*(?!\[\])/);
    }
  });

  it("invents no sort_order or is_featured on a relation that has neither", () => {
    const types = readFileSync(resolve(FEATURE_ROOT, "project-detail-types.ts"), "utf8");
    const mappers = readFileSync(resolve(FEATURE_ROOT, "project-detail-mappers.ts"), "utf8");
    const amenityRowType = types.slice(
      types.indexOf("export type ProjectAmenityRow"),
      types.indexOf("export type ProjectDetailRecord"),
    );

    expect(amenityRowType).toContain("amenity:");
    expect(amenityRowType).not.toContain("sort_order");
    expect(amenityRowType).not.toContain("is_featured");
    // The mapper must not read a column the relation does not have.
    expect(mappers.slice(mappers.indexOf("export function mapProjectAmenities"))).not.toContain(
      "sort_order",
    );
  });

  it("keeps no second structured field competing with amenities", () => {
    const types = readFileSync(resolve(FEATURE_ROOT, "project-detail-types.ts"), "utf8");
    const detail = types.slice(types.indexOf("export type ProjectDetail = {"));

    expect(detail).toContain("amenities: ProjectAmenity[];");
    expect(detail).not.toMatch(/^\s*facilities\s*[?:]/m);
  });
});

describe("the public query reads only relations the database actually has", () => {
  it("embeds project_amenities with its amenities parent, by their real columns", () => {
    expect(PROJECT_DETAIL_SELECT).toContain(
      "amenities:project_amenities(note, amenity:amenities(id, name, slug, category, icon))",
    );
    // Never a wildcard: the embed is a projection, like every other one here.
    expect(PROJECT_DETAIL_SELECT).not.toContain("project_amenities(*)");
    expect(PROJECT_DETAIL_SELECT).not.toContain("amenities(*)");
    // And never the model that is not in the generated types.
    expect(PROJECT_DETAIL_SELECT).not.toContain("project_facilities");
  });

  it("selects only columns the amenities tables declare", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260704060838_6f40ee73-8665-4524-bb76-a9ecf737afd9.sql"),
      "utf8",
    );
    const amenities = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS public.amenities"),
      migration.indexOf("CREATE TRIGGER trg_amenities_updated_at"),
    );
    const link = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS public.project_amenities"),
      migration.indexOf("idx_project_amenities_amenity"),
    );

    for (const column of ["id", "name", "slug", "category", "icon"]) {
      expect(amenities, `amenities.${column}`).toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(link).toMatch(/\bnote\b/);
    // The columns the earlier model assumed are on neither table.
    expect(amenities).not.toMatch(/\bsort_order\b/);
    expect(link).not.toMatch(/\bsort_order\b/);
    expect(link).not.toMatch(/\bis_featured\b/);
  });

  it("keeps the anonymous read grant and the published-project policy in place", () => {
    const base = readFileSync(
      resolve(root, "supabase/migrations/20260704060838_6f40ee73-8665-4524-bb76-a9ecf737afd9.sql"),
      "utf8",
    );
    const progressive = readFileSync(
      resolve(root, "supabase/migrations/20260718113000_progressive_ingestion_v1.sql"),
      "utf8",
    );

    expect(base).toContain("GRANT SELECT ON public.amenities TO anon, authenticated;");
    expect(base).toContain("GRANT SELECT ON public.project_amenities TO anon, authenticated;");
    // Amenity links are visible only for published, active projects.
    expect(progressive).toContain('CREATE POLICY "Amenities of published projects are viewable"');
    expect(progressive).toMatch(/project_amenities[\s\S]{0,200}public_status = 'published'/);

    // No later migration may quietly revoke the grant the embed depends on.
    const migrations = resolve(root, "supabase/migrations");
    for (const entry of readdirSync(migrations)) {
      if (!entry.endsWith(".sql") || entry < "20260718113000") continue;
      const sql = readFileSync(join(migrations, entry), "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(sql, entry).not.toMatch(
        /REVOKE\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.(project_)?amenities\b/i,
      );
    }
  });
});

describe("mapping the amenities relation", () => {
  const row = (
    overrides: Partial<ProjectAmenityRow["amenity"]> & { note?: string | null } = {},
  ) => {
    const { note, ...amenity } = overrides;
    return {
      note: note ?? null,
      amenity: {
        id: "a-1",
        name: "Communal pool",
        slug: "communal-pool",
        category: "Leisure",
        icon: "pool",
        ...amenity,
      },
    } as ProjectAmenityRow;
  };

  it("preserves note, category, icon and slug rather than flattening to names", () => {
    expect(mapProjectAmenities([row({ note: "Open 07:00–21:00" })])).toEqual([
      {
        id: "a-1",
        slug: "communal-pool",
        name: "Communal pool",
        category: "Leisure",
        icon: "pool",
        note: "Open 07:00–21:00",
      },
    ]);
  });

  it("maps an absent relation and an empty relation alike, to no amenities", () => {
    expect(mapProjectAmenities(undefined)).toEqual([]);
    expect(mapProjectAmenities(null)).toEqual([]);
    expect(mapProjectAmenities([])).toEqual([]);
  });

  it("deduplicates a doubled amenity link on identity, not on display name", () => {
    const mapped = mapProjectAmenities([
      row({ id: "a-1" }),
      row({ id: "a-1" }),
      row({ id: "a-2", name: "Communal pool", slug: "rooftop-pool" }),
    ]);

    // The repeated link collapses; two genuinely distinct amenities that happen
    // to share a name both survive.
    expect(mapped.map((amenity) => amenity.id)).toEqual(["a-1", "a-2"]);
  });

  it("ignores malformed rows instead of rendering blank entries", () => {
    const malformed = [
      null,
      undefined,
      {},
      { amenity: null },
      { amenity: {} },
      { amenity: { name: "   " } },
      { amenity: { name: null, slug: "ghost" } },
    ] as unknown as ProjectAmenityRow[];

    expect(mapProjectAmenities(malformed)).toEqual([]);
    expect(mapProjectAmenities([...malformed, row()])).toHaveLength(1);
  });

  it("orders deterministically by category, then name, then slug", () => {
    const shuffled = [
      row({ id: "c", name: "Sauna", slug: "sauna", category: "Wellness" }),
      row({ id: "a", name: "Gym", slug: "gym", category: "Leisure" }),
      row({ id: "b", name: "Gym", slug: "gym-2", category: "Leisure" }),
    ];

    const once = mapProjectAmenities(shuffled).map((amenity) => amenity.id);
    const again = mapProjectAmenities([...shuffled].reverse()).map((amenity) => amenity.id);

    expect(once).toEqual(["a", "b", "c"]);
    expect(again).toEqual(once);
  });

  it("trims whitespace the relation may carry", () => {
    const [amenity] = mapProjectAmenities([
      row({ name: "  Communal pool  ", category: "  Leisure  ", note: "  Shared  " }),
    ]);
    expect(amenity).toMatchObject({ name: "Communal pool", category: "Leisure", note: "Shared" });
  });
});

describe("the section reads the relation and nothing else", () => {
  it("stays hidden, with no navigation entry, when the relation is empty", () => {
    const project = makeProjectDetail({ amenities: [] });

    expect(hasAmenitiesSection(project)).toBe(false);
    expect(projectSections(project).map((section) => section.id)).not.toContain("amenities");
    const { container } = render(<ProjectAmenities project={project} />);
    expect(container.innerHTML).toBe("");
  });

  it("never derives an amenity from highlights, descriptions, photographs or type", () => {
    const project = makeProjectDetail({
      core: {
        type: "Condominium",
        description: "A residence with a large communal pool and a fitness centre.",
        highlights: ["Forever Verified project record", "Structured project foundation"],
      },
      amenities: [],
    });

    expect(projectAmenities(project)).toEqual([]);
    const { container } = render(<ProjectAmenities project={project} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the buyer-facing heading, the note and the grouped categories", () => {
    const project = makeProjectDetail({
      amenities: [
        makeAmenity({ name: "Communal pool", category: "Leisure", note: "Open 07:00–21:00" }),
        makeAmenity({ name: "Sauna", category: "Wellness" }),
      ],
    });

    const { getByText, getByTestId } = render(<ProjectAmenities project={project} />);

    expect(getByText("Facilities & Amenities")).not.toBeNull();
    expect(getByText("Communal pool")).not.toBeNull();
    expect(getByText("Open 07:00–21:00")).not.toBeNull();
    // Two categories are worth separating; one would not be.
    expect(getByText("Leisure")).not.toBeNull();
    expect(getByText("Wellness")).not.toBeNull();
    expect(getByTestId("project-amenities").getAttribute("id")).toBe("amenities");
  });

  it("does not group under a lone category heading", () => {
    const project = makeProjectDetail({
      amenities: [
        makeAmenity({ name: "Communal pool", category: "Leisure" }),
        makeAmenity({ name: "Gym", category: "Leisure" }),
      ],
    });

    const { queryByText } = render(<ProjectAmenities project={project} />);
    expect(queryByText("Leisure")).toBeNull();
  });

  it("gives the navigation entry the heading the section actually renders", () => {
    const project = makeProjectDetail({ amenities: [makeAmenity()] });
    const section = projectSections(project).find((entry) => entry.id === "amenities");

    expect(section?.label).toBe("Facilities & Amenities");
    const { getByTestId } = render(<ProjectAmenities project={project} />);
    expect(getByTestId("project-amenities").getAttribute("id")).toBe(section?.id);
  });

  it("falls back to a neutral icon when the recorded one is not one we ship", () => {
    const project = makeProjectDetail({
      amenities: [makeAmenity({ name: "Helipad", icon: "definitely-not-an-icon" })],
    });

    // The point is that an unknown icon renders the row rather than crashing it.
    const { getByText, container } = render(<ProjectAmenities project={project} />);
    expect(getByText("Helipad")).not.toBeNull();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });
});
