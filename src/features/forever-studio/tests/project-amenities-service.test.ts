/**
 * FOREVER-STUDIO-AMENITIES-CORE-001 — the amenity reconcile at the server
 * boundary.
 *
 * Exercised against the in-memory model of `studio_save_project_amenities`
 * (FakeData), which mirrors the migration statement-for-statement including its
 * bare sentinel messages and its all-or-nothing rollback. The real SQL is
 * additionally covered by the disposable PostgreSQL suite.
 *
 * The properties under test are the ones a wrong implementation would silently
 * break: Owner-only, exact-set reconcile, ONE project's links, a refusal that
 * changes nothing, and an idempotent replay.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getProjectAmenities, saveProjectAmenities } from "../server/service";
import { isStudioAmenityCategory, STUDIO_AMENITY_CATEGORIES } from "../studio-types";
import { makeWorld, OWNER, PUBLISHER, STUDIO_TEST_AMENITIES } from "./fakes";

type World = ReturnType<typeof makeWorld>;

/** Seed one project owned by the Owner, as the ingestion lane would leave it. */
function seedProject(world: World, slug: string): string {
  const id = `project-${slug}`;
  world.executor.store.projects.push({
    id,
    slug,
    name: slug,
    developer_id: null,
    location_id: null,
    developer_name_raw: null,
    location_name_raw: null,
    location_area: null,
    public_status: "published",
    is_active: true,
    forever_verified: false,
    field_provenance: {},
  });
  world.data.objectOwners.set(`project:${id}`, OWNER.userId);
  return id;
}

/** One requested entry, in the shape the endpoint hands the service. */
function entry(
  slug: string,
  overrides: { note?: string; isFeatured?: boolean; sortOrder?: number } = {},
) {
  return {
    slug,
    note: overrides.note ?? "",
    isFeatured: overrides.isFeatured ?? false,
    sortOrder: overrides.sortOrder ?? 0,
  };
}

async function save(
  world: World,
  slug: string,
  amenities: ReturnType<typeof entry>[],
  createdAmenities: Array<{ name: string; slug: string; category: string; icon: string }> = [],
  actor = OWNER,
) {
  return saveProjectAmenities(world.deps, actor, { slug, amenities, createdAmenities });
}

/**
 * A refusal caught at the server boundary carries the stable code on `.code`
 * (the house convention — see authorization.test.ts) and a user-facing sentence
 * as its message. A refusal raised by the transaction itself arrives as the bare
 * snake_case sentinel in the message, with no `.code`; those are asserted with
 * `toThrow` below. The two paths deliberately use the SAME vocabulary, so a
 * failure reads identically whichever layer caught it.
 */
const refuses = (code: string) => ({ code });

describe("Studio project amenities — reading", () => {
  it("returns the catalogue in (category, name, slug) order plus the current selection", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    await save(world, "modeva", [entry("spa", { note: "Two treatment rooms" })]);

    const result = await getProjectAmenities(world.deps, OWNER, { slug: "modeva" });
    expect(result.slug).toBe("modeva");
    expect(result.catalogue).toHaveLength(STUDIO_TEST_AMENITIES.length);
    expect(result.catalogue.map((row) => row.category)).toEqual([
      "",
      "Leisure",
      "Leisure",
      "Services",
      "Wellness",
      "Wellness",
    ]);
    // A null category or icon reads as "" at this boundary, never as null.
    const coworking = result.catalogue.find((row) => row.slug === "co-working-space");
    expect(coworking).toMatchObject({ category: "", icon: "" });
    expect(result.selected).toEqual([
      {
        amenityId: "amenity-spa",
        slug: "spa",
        name: "Spa",
        category: "Wellness",
        icon: "flower",
        note: "Two treatment rooms",
        isFeatured: false,
        sortOrder: 0,
      },
    ]);
  });

  it("refuses a project that does not exist", async () => {
    const world = makeWorld();
    await expect(
      getProjectAmenities(world.deps, OWNER, { slug: "no-such-project" }),
    ).rejects.toMatchObject(refuses("project_not_found"));
  });
});

describe("Studio project amenities — authorization", () => {
  it("is Owner-only: a trusted publisher is refused even on its own project", async () => {
    const world = makeWorld();
    const id = seedProject(world, "publisher-project");
    world.data.objectOwners.set(`project:${id}`, PUBLISHER.userId);

    // Object access passes — the publisher created this project — and the
    // refusal is the ROLE, at the server boundary, before any write.
    await expect(
      save(world, "publisher-project", [entry("spa")], [], PUBLISHER),
    ).rejects.toMatchObject(refuses("studio_owner_required"));
    expect(world.data.projectAmenities).toEqual([]);
  });

  it("lets a trusted publisher READ the amenities of a project it owns", async () => {
    const world = makeWorld();
    const id = seedProject(world, "publisher-project");
    world.data.objectOwners.set(`project:${id}`, PUBLISHER.userId);
    const result = await getProjectAmenities(world.deps, PUBLISHER, { slug: "publisher-project" });
    expect(result.selected).toEqual([]);
  });

  it("refuses a save against a project that does not exist", async () => {
    const world = makeWorld();
    await expect(save(world, "no-such-project", [entry("spa")])).rejects.toMatchObject(
      refuses("project_not_found"),
    );
  });

  it("refuses every amenity operation while Partner Demo mode is active", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    world.flags.partnerDemo = true;
    await expect(getProjectAmenities(world.deps, OWNER, { slug: "modeva" })).rejects.toMatchObject(
      refuses("studio_disabled_in_partner_demo"),
    );
    await expect(save(world, "modeva", [entry("spa")])).rejects.toMatchObject(
      refuses("studio_disabled_in_partner_demo"),
    );
  });
});

describe("Studio project amenities — exact-set reconcile", () => {
  it("saves the requested set and returns it in public display order", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    const result = await save(world, "modeva", [
      entry("spa", { sortOrder: 20 }),
      entry("swimming-pool", { isFeatured: true, sortOrder: 10, note: "Two lap pools" }),
      entry("fitness-centre", { sortOrder: 10 }),
    ]);

    expect(result.selectedCount).toBe(3);
    expect(result.featuredCount).toBe(1);
    expect(result.createdAmenitySlugs).toEqual([]);
    // Featured first, then sort_order, then category/name/slug.
    expect(result.selected.map((row) => row.slug)).toEqual([
      "swimming-pool",
      "fitness-centre",
      "spa",
    ]);
    expect(result.selected[0]).toMatchObject({ isFeatured: true, note: "Two lap pools" });
  });

  it("deselection removes ONLY the deselected links", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    await save(world, "modeva", [entry("spa"), entry("swimming-pool"), entry("fitness-centre")]);

    const result = await save(world, "modeva", [entry("spa"), entry("fitness-centre")]);
    expect(result.selected.map((row) => row.slug)).toEqual(["fitness-centre", "spa"]);
    expect(world.data.projectAmenities.map((link) => link.amenity_id).sort()).toEqual([
      "amenity-gym",
      "amenity-spa",
    ]);
  });

  it("an empty selection is a valid save that clears the project", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    await save(world, "modeva", [entry("spa"), entry("swimming-pool")]);

    const cleared = await save(world, "modeva", []);
    expect(cleared.selected).toEqual([]);
    expect(cleared.selectedCount).toBe(0);
    expect(cleared.featuredCount).toBe(0);
    expect(world.data.projectAmenities).toEqual([]);
  });

  it("touches ONE project: a second project's links are unchanged", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    seedProject(world, "other-project");
    await save(world, "other-project", [
      entry("spa", { note: "Other project spa", isFeatured: true, sortOrder: 10 }),
      entry("kids-pool", { sortOrder: 10 }),
    ]);
    const before = structuredClone(
      world.data.projectAmenities.filter((link) => link.project_id === "project-other-project"),
    );

    // A full clear of modeva, and a reconcile that deselects spa there.
    await save(world, "modeva", [entry("swimming-pool")]);
    await save(world, "modeva", []);

    expect(
      world.data.projectAmenities.filter((link) => link.project_id === "project-other-project"),
    ).toEqual(before);
    const other = await getProjectAmenities(world.deps, OWNER, { slug: "other-project" });
    expect(other.selected.map((row) => row.slug)).toEqual(["spa", "kids-pool"]);
  });

  it("note, featured flag and order survive a round trip through the reader", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    await save(world, "modeva", [
      entry("kids-pool", { note: "Shaded, 40cm deep", isFeatured: true, sortOrder: 20 }),
      entry("swimming-pool", { note: "Two lap pools", isFeatured: true, sortOrder: 10 }),
      entry("spa", { note: "By appointment", sortOrder: 10 }),
    ]);

    const read = await getProjectAmenities(world.deps, OWNER, { slug: "modeva" });
    expect(read.selected.map((row) => [row.slug, row.note, row.isFeatured, row.sortOrder])).toEqual(
      [
        ["swimming-pool", "Two lap pools", true, 10],
        ["kids-pool", "Shaded, 40cm deep", true, 20],
        ["spa", "By appointment", false, 10],
      ],
    );
  });

  it("is idempotent: an exact replay saves the same set and re-dates nothing", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    const requested = [
      entry("swimming-pool", { note: "Two lap pools", isFeatured: true, sortOrder: 10 }),
      entry("spa", { sortOrder: 10 }),
    ];
    const first = await save(world, "modeva", requested);
    const createdAt = world.data.projectAmenities.map((link) => link.created_at);

    world.advanceMinutes(30);
    const replay = await save(world, "modeva", requested);

    expect(replay.selected).toEqual(first.selected);
    expect(replay.selectedCount).toBe(2);
    expect(world.data.projectAmenities).toHaveLength(2);
    expect(world.data.projectAmenities.map((link) => link.created_at)).toEqual(createdAt);
  });
});

describe("Studio project amenities — refusals leave the set unchanged", () => {
  /** The state a refusal must not perturb. */
  async function seededWorld() {
    const world = makeWorld();
    seedProject(world, "modeva");
    await save(world, "modeva", [
      entry("swimming-pool", { note: "Two lap pools", isFeatured: true, sortOrder: 10 }),
      entry("spa", { note: "By appointment", sortOrder: 10 }),
    ]);
    return {
      world,
      links: structuredClone(world.data.projectAmenities),
      catalogue: structuredClone(world.data.amenities),
    };
  }

  it("rejects a ninth featured amenity", async () => {
    const world = makeWorld();
    seedProject(world, "big-project");
    // Eight is the ceiling, so nine distinct featured amenities need a catalogue
    // of nine: six seeded plus three created in the same call.
    const created = ["rooftop-bar", "kids-club", "shuttle-bus"].map((slug) => ({
      name: slug,
      slug,
      category: "Other",
      icon: "",
    }));
    const nine = [
      ...STUDIO_TEST_AMENITIES.map((row) => row.slug),
      ...created.map((row) => row.slug),
    ]
      .slice(0, 9)
      .map((slug, index) => entry(slug, { isFeatured: true, sortOrder: (index + 1) * 10 }));

    // A deterministic property of the submitted set, so it is never retryable:
    // the UI must offer a correction, not a retry.
    await expect(save(world, "big-project", nine, created)).rejects.toMatchObject({
      code: "studio_project_amenities_featured_limit",
      retryable: false,
    });
    // Nothing created, nothing linked.
    expect(world.data.amenities).toHaveLength(STUDIO_TEST_AMENITIES.length);
    expect(world.data.projectAmenities).toEqual([]);

    // Eight of the same set is accepted, which proves the limit is the ceiling
    // and not an off-by-one refusal of the eighth.
    const eight = nine.slice(0, 8);
    const ok = await save(world, "big-project", eight, created.slice(0, 2));
    expect(ok.featuredCount).toBe(8);
  });

  it("rejects a duplicate slug in the requested set", async () => {
    const { world, links } = await seededWorld();
    await expect(save(world, "modeva", [entry("spa"), entry("spa")])).rejects.toMatchObject(
      refuses("studio_project_amenities_duplicate_slug"),
    );
    expect(world.data.projectAmenities).toEqual(links);
  });

  it("rejects a blank slug and a fractional or negative sort order", async () => {
    const { world, links } = await seededWorld();
    await expect(save(world, "modeva", [entry("   ")])).rejects.toMatchObject(
      refuses("studio_project_amenities_slug_required"),
    );
    await expect(save(world, "modeva", [entry("spa", { sortOrder: 1.5 })])).rejects.toMatchObject(
      refuses("studio_project_amenities_invalid_sort_order"),
    );
    await expect(save(world, "modeva", [entry("spa", { sortOrder: -1 })])).rejects.toMatchObject(
      refuses("studio_project_amenities_invalid_sort_order"),
    );
    expect(world.data.projectAmenities).toEqual(links);
  });

  it("rejects a sort order too large for the column, by name rather than by cast", async () => {
    const { world, links } = await seededWorld();

    // Without an upper bound these reach the save function's `::integer` cast
    // and raise a raw `22003 value out of range`, which the error envelope
    // collapses to the generic RETRYABLE failure — a permanent refusal shown to
    // the Owner as "temporary problem, please try again". The named refusal is
    // the point, so assert the code, not merely that it threw.
    for (const sortOrder of [2147483648, 1000001, Number.MAX_SAFE_INTEGER]) {
      await expect(save(world, "modeva", [entry("spa", { sortOrder })])).rejects.toMatchObject(
        refuses("studio_project_amenities_invalid_sort_order"),
      );
    }
    // And the documented edge is inclusive, so the rejections above are really
    // about being beyond it.
    await expect(
      save(world, "modeva", [entry("spa", { sortOrder: 1_000_000 })]),
    ).resolves.toMatchObject({ selectedCount: 1 });

    expect(world.data.projectAmenities).not.toEqual(links);
  });

  it("refuses to create an amenity the project is not selecting", async () => {
    const { world, links, catalogue } = await seededWorld();
    const ghost = { name: "Ghost", slug: "ghost-amenity", category: "Other", icon: "" };

    // `amenities` is a SHARED catalogue with no delete path in this feature, so
    // a created row nothing references is permanent clutter for every project.
    // The Studio UI always co-selects what it creates, which is exactly why this
    // needs a server guard rather than trusting the caller.
    await expect(save(world, "modeva", [], [ghost])).rejects.toMatchObject(
      refuses("studio_amenity_created_unused"),
    );
    // Also when only SOME of the created rows are used.
    await expect(
      save(
        world,
        "modeva",
        [entry("ghost-amenity")],
        [ghost, { name: "Ghost Two", slug: "ghost-two", category: "Other", icon: "" }],
      ),
    ).rejects.toMatchObject(refuses("studio_amenity_created_unused"));

    expect(world.data.amenities).toEqual(catalogue);
    expect(world.data.projectAmenities).toEqual(links);
  });

  it("rejects an unresolvable slug rather than inventing an amenity", async () => {
    const { world, links, catalogue } = await seededWorld();
    await expect(save(world, "modeva", [entry("spa"), entry("helipad")])).rejects.toThrow(
      "studio_amenity_not_found: helipad",
    );
    expect(world.data.amenities).toEqual(catalogue);
    expect(world.data.projectAmenities).toEqual(links);
  });

  it("rejects an invalid, duplicated, or nameless created amenity", async () => {
    const { world, links, catalogue } = await seededWorld();
    const ok = {
      name: "Rooftop Bar",
      slug: "rooftop-bar",
      category: "Hospitality & Retail",
      icon: "",
    };

    await expect(save(world, "modeva", [], [{ ...ok, name: "  " }])).rejects.toMatchObject(
      refuses("studio_amenity_name_and_slug_required"),
    );
    await expect(save(world, "modeva", [], [{ ...ok, slug: "Rooftop Bar" }])).rejects.toMatchObject(
      refuses("studio_amenity_slug_invalid"),
    );
    await expect(save(world, "modeva", [], [ok, { ...ok, name: "Other" }])).rejects.toMatchObject(
      refuses("studio_amenity_slug_duplicate"),
    );
    expect(world.data.amenities).toEqual(catalogue);
    expect(world.data.projectAmenities).toEqual(links);
  });

  it("requires a category from the closed vocabulary when creating an amenity", async () => {
    const { world, links, catalogue } = await seededWorld();
    const base = { name: "Rooftop Bar", slug: "rooftop-bar", icon: "martini" };
    const select = [entry("rooftop-bar")];

    // Blank is refused — category is REQUIRED on creation, unlike icon.
    await expect(save(world, "modeva", select, [{ ...base, category: "" }])).rejects.toMatchObject(
      refuses("studio_amenity_category_invalid"),
    );
    await expect(
      save(world, "modeva", select, [{ ...base, category: "   " }]),
    ).rejects.toMatchObject(refuses("studio_amenity_category_invalid"));

    // So is anything outside the nine supported values — including a value that
    // merely differs in case or spacing from a real one. The public page groups
    // by this string, so "wellness" and "Fitness & Wellness" must not both exist.
    for (const category of ["Leisure", "wellness", "Fitness and Wellness", "Pools&Water"]) {
      await expect(save(world, "modeva", select, [{ ...base, category }])).rejects.toMatchObject(
        refuses("studio_amenity_category_invalid"),
      );
    }

    // Nothing landed from any of those attempts.
    expect(world.data.amenities).toEqual(catalogue);
    expect(world.data.projectAmenities).toEqual(links);

    // Every supported value is accepted.
    for (const category of STUDIO_AMENITY_CATEGORIES) {
      const fresh = makeWorld();
      seedProject(fresh, "modeva");
      const result = await save(
        fresh,
        "modeva",
        [entry("solo")],
        [{ name: "Solo", slug: "solo", category, icon: "" }],
      );
      expect(result.createdAmenitySlugs).toEqual(["solo"]);
      expect(fresh.data.amenities.find((row) => row.slug === "solo")?.category).toBe(category);
    }
  });

  it("uses the same category vocabulary in the database as in TypeScript", async () => {
    // The nine values are necessarily duplicated: the migration cannot import a
    // TypeScript constant. So the duplication has to be PINNED, or the two drift
    // apart the first time someone acts on the constant's own doc comment
    // ("growing the vocabulary is a product decision, made by editing this
    // list"). Drift means Studio offers a category the database then refuses.
    const migrations = resolve(process.cwd(), "supabase/migrations");
    const editor = readdirSync(migrations).filter((entry) =>
      entry.includes("studio_project_amenities_editor"),
    );
    expect(editor, "exactly one amenities-editor migration").toHaveLength(1);
    const sql = readFileSync(join(migrations, editor[0]), "utf8");

    // Bounded by the NOT IN parentheses themselves, not by a character count: a
    // fixed window sweeps up quoted strings from neighbouring statements and the
    // comparison stops meaning anything.
    const sentinel = sql.indexOf("studio_amenity_category_invalid");
    expect(sentinel, "the category refusal exists in the migration").toBeGreaterThan(-1);
    const open = sql.lastIndexOf("NOT IN (", sentinel);
    expect(open, "the category check uses a NOT IN list").toBeGreaterThan(-1);
    const close = sql.indexOf(")", open);
    expect(close, "that list is closed").toBeGreaterThan(open);
    const clause = sql.slice(open, close);

    // Every supported value appears, quoted, in the SQL check...
    for (const category of STUDIO_AMENITY_CATEGORIES) {
      expect(clause, category).toContain(`'${category}'`);
    }
    // ...and the SQL admits no value the constant does not.
    const inSql = [...clause.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(inSql, "the SQL list is non-empty").not.toHaveLength(0);
    expect([...inSql].sort()).toEqual([...STUDIO_AMENITY_CATEGORIES].sort());
  });

  it("keeps the icon optional — a blank one creates and saves normally", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    const result = await save(
      world,
      "modeva",
      [entry("rooftop-bar")],
      [{ name: "Rooftop Bar", slug: "rooftop-bar", category: "Hospitality & Retail", icon: "" }],
    );

    // No refusal, and the row exists with no icon. The public renderer falls back
    // to a neutral marker; an absent icon blocks neither a save nor a publication.
    expect(result.createdAmenitySlugs).toEqual(["rooftop-bar"]);
    expect(result.selected.find((row) => row.slug === "rooftop-bar")).toMatchObject({ icon: "" });
  });

  it("still reads catalogue rows whose category predates the vocabulary", async () => {
    // The rule constrains CREATION only. The seeded catalogue deliberately holds
    // legacy values ("Leisure", "Wellness") and one blank, exactly as a real
    // catalogue does — and every one of them must stay listable, selectable and
    // assignable, or the rule would have quietly orphaned existing data.
    const world = makeWorld();
    seedProject(world, "modeva");

    const before = await getProjectAmenities(world.deps, OWNER, { slug: "modeva" });
    const legacy = before.catalogue.filter((row) => !isStudioAmenityCategory(row.category));
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.some((row) => row.category === "")).toBe(true);

    const result = await save(
      world,
      "modeva",
      legacy.map((row) => entry(row.slug)),
    );
    expect(result.selectedCount).toBe(legacy.length);
    // And they are unchanged: assigning a legacy row does not rewrite its category.
    for (const row of legacy) {
      expect(world.data.amenities.find((a) => a.slug === row.slug)?.category ?? "").toBe(
        row.category,
      );
    }
  });

  it("rejects a created amenity whose slug already exists — never merges the two", async () => {
    const { world, links, catalogue } = await seededWorld();
    await expect(
      save(
        world,
        "modeva",
        [entry("spa")],
        [{ name: "Spa & Wellness", slug: "spa", category: "Fitness & Wellness", icon: "flower" }],
      ),
    ).rejects.toThrow("studio_amenity_slug_exists");
    expect(world.data.amenities).toEqual(catalogue);
    expect(world.data.projectAmenities).toEqual(links);
  });

  it("rolls the whole reconcile back when the transaction fails after writing", async () => {
    const { world, links, catalogue } = await seededWorld();
    world.data.failAfterAmenitiesSave = true;
    await expect(
      save(
        world,
        "modeva",
        // The created amenity is selected, as the guard now requires and as the
        // editor always does — so the failure under test is the injected one and
        // not a validation refusal arriving first.
        [entry("kids-pool"), entry("rooftop-bar")],
        [{ name: "Rooftop Bar", slug: "rooftop-bar", category: "Hospitality & Retail", icon: "" }],
      ),
    ).rejects.toThrow("studio_project_amenities_injected_failure");
    // Neither the created catalogue row nor the reconciled links survive.
    expect(world.data.amenities).toEqual(catalogue);
    expect(world.data.projectAmenities).toEqual(links);
  });
});

describe("Studio project amenities — creating a canonical amenity", () => {
  it("creates only what was explicitly asked for and links it in the same save", async () => {
    const world = makeWorld();
    seedProject(world, "modeva");
    const result = await save(
      world,
      "modeva",
      [
        entry("rooftop-bar", { note: "Sunset view", isFeatured: true, sortOrder: 10 }),
        entry("spa"),
      ],
      [
        {
          name: "Rooftop Bar",
          slug: "rooftop-bar",
          category: "Hospitality & Retail",
          icon: "martini",
        },
      ],
    );

    expect(result.createdAmenitySlugs).toEqual(["rooftop-bar"]);
    expect(world.data.amenities).toHaveLength(STUDIO_TEST_AMENITIES.length + 1);
    const rooftop = result.selected.find((row) => row.slug === "rooftop-bar");
    expect(rooftop).toMatchObject({
      name: "Rooftop Bar",
      category: "Hospitality & Retail",
      icon: "martini",
      note: "Sunset view",
      isFeatured: true,
    });
    expect(rooftop?.amenityId).toBeTruthy();
    // It is now a catalogue row every project can draw on.
    const catalogue = await world.data.listAmenityCatalogue();
    expect(catalogue.map((row) => row.slug)).toContain("rooftop-bar");
  });
});

describe("Studio project amenities — audit", () => {
  it("records counts and created slugs, and never a note's text", async () => {
    const world = makeWorld();
    const id = seedProject(world, "modeva");
    await save(
      world,
      "modeva",
      [
        entry("swimming-pool", { note: "SECRET EDITORIAL COPY", isFeatured: true, sortOrder: 10 }),
        entry("rooftop-bar", { sortOrder: 10 }),
      ],
      [
        {
          name: "Rooftop Bar",
          slug: "rooftop-bar",
          category: "Hospitality & Retail",
          icon: "martini",
        },
      ],
    );

    const audit = world.data.audits.at(-1);
    expect(audit).toMatchObject({
      actor_id: OWNER.userId,
      action: "studio_project_amenities_saved",
      table_name: "project_amenities",
      record_id: id,
      metadata: { slug: "modeva", selected: 2, featured: 1, created: ["rooftop-bar"] },
    });
    expect(JSON.stringify(world.data.audits)).not.toContain("SECRET EDITORIAL COPY");
  });
});
