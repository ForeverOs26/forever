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

/**
 * The files that state the rule, and are therefore the only ones allowed to
 * name the thing it forbids.
 *
 * `legacy-facilities-guard.test.ts` joined this list with
 * FOREVER-STUDIO-AMENITIES-CORE-001. It widens the same prohibition from this
 * one feature directory to all of `src`, and it has to name the legacy tables to
 * do so. An entry here needs that justification — a file that asserts something
 * true about the legacy tables — not merely a failing scan.
 */
const RULE_STATING_FILES = new Set(
  ["amenities-contract.test.tsx", "legacy-facilities-guard.test.ts"].map((name) =>
    resolve(FEATURE_ROOT, name),
  ),
);

describe("the amenities model has one name", () => {
  it("names no facilities table anywhere in the project-detail feature", () => {
    for (const file of sourceFiles(FEATURE_ROOT)) {
      if (RULE_STATING_FILES.has(file)) continue;
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

  it("reads sort_order and is_featured only because a migration adds them", () => {
    const types = readFileSync(resolve(FEATURE_ROOT, "project-detail-types.ts"), "utf8");
    const mappers = readFileSync(resolve(FEATURE_ROOT, "project-detail-mappers.ts"), "utf8");
    const amenityRowType = types.slice(
      types.indexOf("export type ProjectAmenityRow"),
      types.indexOf("export type ProjectDetailRecord"),
    );

    expect(amenityRowType).toContain("amenity:");
    // The original rule stands unchanged: the row type may name a column only
    // when the relation has it. These two are read because
    // FOREVER-STUDIO-AMENITIES-CORE-001 adds them to `project_amenities`, which
    // the migration assertion below pins. Nothing else was invented alongside
    // them — there is still no `sort_index`, `rank`, `priority` or `weight`.
    expect(amenityRowType).toContain("is_featured");
    expect(amenityRowType).toContain("sort_order");
    for (const invented of ["sort_index", "priority", "rank", "weight"]) {
      expect(amenityRowType, invented).not.toContain(invented);
    }
    expect(mappers.slice(mappers.indexOf("export function mapProjectAmenities"))).toContain(
      "sort_order",
    );
  });

  it("adds the two columns additively, in a migration later than every parent one", () => {
    const migrations = resolve(root, "supabase/migrations");
    const files = readdirSync(migrations)
      .filter((entry) => entry.endsWith(".sql"))
      .sort();
    const editor = files.filter((entry) => entry.includes("studio_project_amenities_editor"));
    expect(editor, "exactly one amenities-editor migration").toHaveLength(1);
    // It must sort AFTER the migration that creates the table, so the columns
    // cannot land before the table they extend. Deliberately not "is the last
    // migration in the chain": that would be true today and would then fail for
    // the next person who adds an unrelated migration, which is a trap rather
    // than a contract.
    expect(editor[0] > "20260704060838").toBe(true);
    expect(files.indexOf(editor[0])).toBeGreaterThan(
      files.findIndex((entry) => entry.startsWith("20260704060838")),
    );

    const sql = readFileSync(join(migrations, editor[0]), "utf8");
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    // Additive: ADD COLUMN, never a rewrite of the existing shape.
    expect(statements).toMatch(
      /ALTER TABLE public\.project_amenities\s+ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false/,
    );
    expect(statements).toMatch(
      /ALTER TABLE public\.project_amenities\s+ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0/,
    );
    expect(statements).toMatch(/CHECK \(sort_order >= 0\)/);

    // Nothing existing is dropped, retyped or renamed, anywhere in the file.
    //
    // TRUNCATE needs care, and is the ONLY one that does. It is both a
    // destructive statement and a privilege name, and this migration revokes the
    // privilege — so a bare `/TRUNCATE/i` would forbid taking the privilege
    // away, which is the opposite of the intent.
    //
    // The discriminator is what FOLLOWS the word, not what precedes it. In a
    // GRANT/REVOKE list it is followed by a comma or by ` ON `; as a statement it
    // is followed by whitespace and then the target, optionally via `TABLE`
    // and/or `ONLY`. Both qualifiers can appear together (`TRUNCATE TABLE ONLY
    // x`), and the target may be unqualified — the DDL prelude runs under the
    // default search_path, so an unqualified `TRUNCATE project_amenities` would
    // execute. All four forms must be caught.
    const TRUNCATE_STATEMENT = /\bTRUNCATE\s+(?!ON\b)(?:TABLE\s+)?(?:ONLY\s+)?[\w"]/i;
    for (const forbidden of [
      /DROP COLUMN/i,
      /ALTER COLUMN/i,
      /RENAME/i,
      /DROP TABLE/i,
      TRUNCATE_STATEMENT,
    ]) {
      expect(statements, String(forbidden)).not.toMatch(forbidden);
    }

    // Guard the guard: the pattern above must still catch every destructive form
    // while ignoring the privilege-list form. A weakened regex that silently
    // stops matching is exactly the failure this whole block exists to prevent.
    for (const destructive of [
      "TRUNCATE public.project_amenities;",
      "TRUNCATE TABLE public.project_amenities;",
      "TRUNCATE ONLY public.project_amenities;",
      "TRUNCATE TABLE ONLY public.project_amenities;",
      "TRUNCATE project_amenities;",
      "TRUNCATE TABLE project_amenities;",
    ]) {
      expect(destructive, destructive).toMatch(TRUNCATE_STATEMENT);
    }
    for (const benign of [
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.amenities FROM anon;",
      "REVOKE TRUNCATE ON TABLE public.amenities FROM anon;",
    ]) {
      expect(benign, benign).not.toMatch(TRUNCATE_STATEMENT);
    }

    // And applying the migration writes no project data. The DELETE and INSERT
    // this feature needs live inside the function body, which runs only when an
    // Owner saves — so the DDL that executes at apply time must contain no DML
    // at all. Splitting on the function keyword is what separates the two.
    //
    // These three need no special handling. In the REVOKE list each is followed
    // by a comma, so none of them matches — which was checked rather than
    // assumed, and is why they are NOT loosened the way TRUNCATE had to be.
    const ddl = statements.slice(0, statements.indexOf("CREATE OR REPLACE FUNCTION"));
    expect(ddl, "the migration reaches its function").not.toBe(statements);
    for (const dml of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w/i, /\bDELETE\s+FROM\b/i]) {
      expect(ddl, String(dml)).not.toMatch(dml);
    }

    // It revokes every WRITE privilege from both browser roles on both amenity
    // tables — the privilege barrier that sits alongside row-level security.
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(statements, `REVOKE ${privilege}`).toMatch(
        new RegExp(`REVOKE[^;]*\\b${privilege}\\b[^;]*FROM anon, authenticated`, "i"),
      );
    }
    expect(statements).toMatch(/public\.amenities,\s*public\.project_amenities/);

    // And it does NOT revoke SELECT. The public embed depends on it, and the
    // grant assertion further down scans every migration for exactly that.
    expect(statements).not.toMatch(/REVOKE[^;]*\bSELECT\b/i);

    // And it leaves the legacy inventory tables entirely alone.
    expect(statements).not.toMatch(/\bpublic\.project_facilities\b/);
    expect(statements).not.toMatch(/\bpublic\.facilities\b/);
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
      "amenities:project_amenities(note, is_featured, sort_order, amenity:amenities(id, name, slug, category, icon))",
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
    // `amenities` still declares no ordering of its own — an amenity is a
    // catalogue entry, and where it sits is a property of the project link.
    expect(amenities).not.toMatch(/\bsort_order\b/);
    expect(amenities).not.toMatch(/\bis_featured\b/);
    // The base migration does not declare the two link columns either; they
    // arrive additively, which the migration assertion above pins. Reading this
    // one file alone is therefore no longer proof, so the check that the embed
    // selects nothing undeclared lives in that assertion, not here.
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
    overrides: Partial<ProjectAmenityRow["amenity"]> & {
      note?: string | null;
      is_featured?: boolean | null;
      sort_order?: number | null;
    } = {},
  ) => {
    const { note, is_featured, sort_order, ...amenity } = overrides;
    return {
      note: note ?? null,
      // The database defaults, so a row that says nothing about ordering is the
      // row a project has before the Owner ever opens the editor.
      is_featured: is_featured ?? false,
      sort_order: sort_order ?? 0,
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
        isFeatured: false,
        sortOrder: 0,
      },
    ]);
  });

  it("carries the Owner's featured flag and order through unchanged", () => {
    expect(mapProjectAmenities([row({ is_featured: true, sort_order: 20 })])[0]).toMatchObject({
      isFeatured: true,
      sortOrder: 20,
    });
  });

  it("treats a null or absent flag as unfeatured and unordered, never dropping the row", () => {
    const legacy = [
      { note: null, amenity: { id: "a-1", name: "Pool", slug: "pool", category: "", icon: "" } },
      {
        note: null,
        is_featured: null,
        sort_order: null,
        amenity: { id: "a-2", name: "Gym", slug: "gym", category: "", icon: "" },
      },
    ] as unknown as ProjectAmenityRow[];

    const mapped = mapProjectAmenities(legacy);
    expect(mapped).toHaveLength(2);
    for (const amenity of mapped) {
      expect(amenity).toMatchObject({ isFeatured: false, sortOrder: 0 });
    }
  });

  it("clamps a negative sort_order the database would have rejected", () => {
    // The CHECK constraint makes this unreachable through the editor, but a
    // renderer must not be the thing that discovers a bad row.
    expect(mapProjectAmenities([row({ sort_order: -5 })])[0].sortOrder).toBe(0);
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

  it("falls back to category, then name, then slug when nothing is ordered", () => {
    const shuffled = [
      row({ id: "c", name: "Sauna", slug: "sauna", category: "Wellness" }),
      row({ id: "a", name: "Gym", slug: "gym", category: "Leisure" }),
      row({ id: "b", name: "Gym", slug: "gym-2", category: "Leisure" }),
    ];

    const once = mapProjectAmenities(shuffled).map((amenity) => amenity.id);
    const again = mapProjectAmenities([...shuffled].reverse()).map((amenity) => amenity.id);

    // Every row is unfeatured at sort_order 0, so the whole order is the
    // fallback — which is exactly why the fallback has to be total.
    expect(once).toEqual(["a", "b", "c"]);
    expect(again).toEqual(once);
  });

  it("leads with featured amenities, then orders each group by sort_order", () => {
    const shuffled = [
      row({ id: "n2", name: "Sauna", slug: "sauna", category: "Wellness", sort_order: 20 }),
      row({
        id: "f2",
        name: "Gym",
        slug: "gym",
        category: "Leisure",
        is_featured: true,
        sort_order: 20,
      }),
      row({ id: "n1", name: "Garden", slug: "garden", category: "Outdoor", sort_order: 10 }),
      row({
        id: "f1",
        name: "Pool",
        slug: "pool",
        category: "Water",
        is_featured: true,
        sort_order: 10,
      }),
    ];

    const once = mapProjectAmenities(shuffled).map((amenity) => amenity.id);
    const again = mapProjectAmenities([...shuffled].reverse()).map((amenity) => amenity.id);

    // Featured first regardless of category or name; sort_order within each
    // group. `f2` precedes `n1` even though "Gym" sorts after "Garden".
    expect(once).toEqual(["f1", "f2", "n1", "n2"]);
    expect(again).toEqual(once);
  });

  it("breaks a sort_order tie the same way every time", () => {
    const tied = [
      row({ id: "b", name: "Sauna", slug: "sauna", category: "Wellness", sort_order: 10 }),
      row({ id: "a", name: "Gym", slug: "gym", category: "Leisure", sort_order: 10 }),
    ];

    expect(mapProjectAmenities(tied).map((a) => a.id)).toEqual(["a", "b"]);
    expect(mapProjectAmenities([...tied].reverse()).map((a) => a.id)).toEqual(["a", "b"]);
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

  it("renders the featured amenities first, under their own heading", () => {
    const project = makeProjectDetail({
      amenities: [
        makeAmenity({ name: "Onsen", category: "Wellness", isFeatured: true, sortOrder: 10 }),
        makeAmenity({ name: "Communal pool", category: "Leisure", sortOrder: 10 }),
        makeAmenity({ name: "Sauna", category: "Wellness", sortOrder: 20 }),
      ],
    });

    const { getByText, container } = render(<ProjectAmenities project={project} />);
    expect(getByText("Featured")).not.toBeNull();

    // Reading order, not just presence: the featured one comes first on the page.
    const names = Array.from(container.querySelectorAll("li span")).map((node) => node.textContent);
    expect(names[0]).toBe("Onsen");
    // The remainder still groups by its own categories.
    expect(getByText("Leisure")).not.toBeNull();
    expect(getByText("Wellness")).not.toBeNull();
  });

  it("adds no Featured heading when the Owner has featured nothing", () => {
    const project = makeProjectDetail({
      amenities: [
        makeAmenity({ name: "Communal pool", category: "Leisure" }),
        makeAmenity({ name: "Sauna", category: "Wellness" }),
      ],
    });

    const { queryByText } = render(<ProjectAmenities project={project} />);
    expect(queryByText("Featured")).toBeNull();
  });
});

describe("amenities are optional public project data", () => {
  it("hides the section and its navigation entry without hiding the project", () => {
    const project = makeProjectDetail({ amenities: [] });

    // Zero amenities removes one section. It does not make the project
    // unpublishable, and it does not remove any other section: a project the
    // Owner has not curated amenities for is still a complete public page.
    expect(hasAmenitiesSection(project)).toBe(false);
    const sectionIds = projectSections(project).map((section) => section.id);
    expect(sectionIds).not.toContain("amenities");
    expect(sectionIds.length).toBeGreaterThan(0);

    const { container } = render(<ProjectAmenities project={project} />);
    expect(container.innerHTML).toBe("");
  });

  it("gates nothing else on the amenity count", () => {
    const withAmenities = projectSections(makeProjectDetail({ amenities: [makeAmenity()] }));
    const without = projectSections(makeProjectDetail({ amenities: [] }));

    // The only difference the amenity count makes to the page is the amenities
    // section itself.
    expect(withAmenities.map((s) => s.id).filter((id) => id !== "amenities")).toEqual(
      without.map((s) => s.id),
    );
  });
});
