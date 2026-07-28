/**
 * FOREVER-STUDIO-AMENITIES-CORE-001 — the amenity editor's pure rules.
 *
 * Every assertion here is about a rule the database also enforces or the public
 * page also applies: kebab-case slugs, per-group `sort_order` renumbering, the
 * exact save payload, and the total order of the picker. Asserting them without
 * a DOM keeps them rules rather than rendering details.
 */

import { describe, expect, it } from "vitest";

import {
  AMENITY_CATEGORY_ALL,
  catalogueCategories,
  closeMatches,
  displayOrder,
  featuredCount,
  featuredLimitReached,
  filterCatalogue,
  normalizeSortOrders,
  reorder,
  suggestAmenitySlug,
  toSavePayload,
} from "../amenity-editor-state";
import type { StudioAmenityCatalogueEntry, StudioProjectAmenity } from "../studio-types";

const CATALOGUE: StudioAmenityCatalogueEntry[] = [
  { id: "1", slug: "swimming-pool", name: "Swimming Pool", category: "Leisure", icon: "waves" },
  { id: "2", slug: "kids-pool", name: "Kids Pool", category: "Leisure", icon: "baby" },
  {
    id: "3",
    slug: "fitness-centre",
    name: "Fitness Centre",
    category: "Wellness",
    icon: "dumbbell",
  },
  { id: "4", slug: "spa", name: "Spa", category: "Wellness", icon: "flower" },
  { id: "5", slug: "24h-security", name: "24h Security", category: "Services", icon: "shield" },
  { id: "6", slug: "co-working-space", name: "Co-working Space", category: "", icon: "" },
];

function amenity(
  slug: string,
  overrides: Partial<StudioProjectAmenity> = {},
): StudioProjectAmenity {
  return {
    slug,
    name: slug,
    category: "",
    icon: "",
    note: "",
    isFeatured: false,
    sortOrder: 0,
    ...overrides,
  };
}

describe("suggestAmenitySlug", () => {
  it("kebab-cases a display name, collapsing punctuation into single hyphens", () => {
    expect(suggestAmenitySlug("Kids' Club & Pool")).toBe("kids-club-pool");
    expect(suggestAmenitySlug("Swimming Pool")).toBe("swimming-pool");
    expect(suggestAmenitySlug("24h   Security")).toBe("24h-security");
    expect(suggestAmenitySlug("Co-working Space")).toBe("co-working-space");
  });

  it("strips diacritics rather than transliterating or dropping the word", () => {
    expect(suggestAmenitySlug("Café Lounge")).toBe("cafe-lounge");
    expect(suggestAmenitySlug("Piscine à Débordement")).toBe("piscine-a-debordement");
  });

  it("trims leading and trailing separators and yields a saveable slug", () => {
    expect(suggestAmenitySlug("  ***Rooftop Bar!!!  ")).toBe("rooftop-bar");
    expect(suggestAmenitySlug("!!!")).toBe("");
    expect(suggestAmenitySlug("")).toBe("");
    // Whatever it produces must satisfy the pattern the migration enforces.
    for (const name of ["Kids' Club & Pool", "Café Lounge", "24h   Security"]) {
      expect(suggestAmenitySlug(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("filterCatalogue", () => {
  it("matches a case-insensitive substring of the NAME", () => {
    expect(filterCatalogue(CATALOGUE, { search: "pool" }).map((row) => row.slug)).toEqual([
      "kids-pool",
      "swimming-pool",
    ]);
    // Case-insensitive, and matched as a plain substring: "spa" is also inside
    // "Co-working Space", and a substring filter must say so rather than
    // pretending to understand word boundaries.
    expect(filterCatalogue(CATALOGUE, { search: "SPA" }).map((row) => row.slug)).toEqual([
      "co-working-space",
      "spa",
    ]);
    expect(filterCatalogue(CATALOGUE, { search: "FITNESS CENTRE" }).map((row) => row.slug)).toEqual(
      ["fitness-centre"],
    );
  });

  it("matches a case-insensitive substring of the SLUG as well as the name", () => {
    // "centre" appears in both; "fitness-" only in the slug.
    expect(filterCatalogue(CATALOGUE, { search: "fitness-" }).map((row) => row.slug)).toEqual([
      "fitness-centre",
    ]);
    expect(
      filterCatalogue(CATALOGUE, { search: "co-working-space" }).map((row) => row.slug),
    ).toEqual(["co-working-space"]);
  });

  it("treats a blank or whitespace-only search as no filter at all", () => {
    expect(filterCatalogue(CATALOGUE, {})).toHaveLength(CATALOGUE.length);
    expect(filterCatalogue(CATALOGUE, { search: "" })).toHaveLength(CATALOGUE.length);
    expect(filterCatalogue(CATALOGUE, { search: "   " })).toHaveLength(CATALOGUE.length);
  });

  it("filters by exact category, with blank and the all sentinel matching everything", () => {
    expect(filterCatalogue(CATALOGUE, { category: "Wellness" }).map((row) => row.slug)).toEqual([
      "fitness-centre",
      "spa",
    ]);
    expect(filterCatalogue(CATALOGUE, { category: AMENITY_CATEGORY_ALL })).toHaveLength(
      CATALOGUE.length,
    );
    expect(filterCatalogue(CATALOGUE, { category: "" })).toHaveLength(CATALOGUE.length);
    expect(filterCatalogue(CATALOGUE, { category: "wellness" })).toEqual([]);
  });

  it("combines search and category, and sorts by category then name then slug", () => {
    expect(
      filterCatalogue(CATALOGUE, { search: "pool", category: "Leisure" }).map((row) => row.slug),
    ).toEqual(["kids-pool", "swimming-pool"]);
    expect(filterCatalogue(CATALOGUE, { search: "pool", category: "Wellness" })).toEqual([]);
    expect(filterCatalogue(CATALOGUE, {}).map((row) => row.category)).toEqual([
      "",
      "Leisure",
      "Leisure",
      "Services",
      "Wellness",
      "Wellness",
    ]);
  });

  it("never mutates the array it was given", () => {
    const input = [...CATALOGUE];
    filterCatalogue(input, { search: "pool" });
    expect(input).toEqual(CATALOGUE);
  });
});

describe("catalogueCategories", () => {
  it("returns the distinct non-blank categories, sorted", () => {
    expect(catalogueCategories(CATALOGUE)).toEqual(["Leisure", "Services", "Wellness"]);
  });

  it("drops blank and whitespace-only categories rather than offering an empty option", () => {
    expect(
      catalogueCategories([
        ...CATALOGUE,
        { id: "7", slug: "blank", name: "Blank", category: "   ", icon: "" },
      ]),
    ).toEqual(["Leisure", "Services", "Wellness"]);
  });
});

describe("closeMatches", () => {
  it("puts an already-taken slug first — that collision is fatal, not advisory", () => {
    const matches = closeMatches(CATALOGUE, { name: "Something Else", slug: "spa" });
    expect(matches[0].slug).toBe("spa");
  });

  it("finds an existing row whose folded name equals the candidate's", () => {
    // Different slug, same facility: exactly the duplicate this warning exists
    // to stop.
    expect(
      closeMatches(CATALOGUE, { name: "Kids' Pool", slug: "childrens-pool" }).map(
        (row) => row.slug,
      ),
    ).toContain("kids-pool");
  });

  it("finds containment in either direction", () => {
    expect(closeMatches(CATALOGUE, { name: "Pool", slug: "pool" }).map((row) => row.slug)).toEqual(
      expect.arrayContaining(["kids-pool", "swimming-pool"]),
    );
    expect(
      closeMatches(CATALOGUE, {
        name: "Rooftop Swimming Pool Deck",
        slug: "rooftop-pool-deck",
      }).map((row) => row.slug),
    ).toContain("swimming-pool");
  });

  it("returns nothing for an unrelated candidate and nothing for a blank one", () => {
    expect(closeMatches(CATALOGUE, { name: "Helipad", slug: "helipad" })).toEqual([]);
    // A blank key is a substring of everything; it must not match everything.
    expect(closeMatches(CATALOGUE, { name: "", slug: "" })).toEqual([]);
    expect(closeMatches(CATALOGUE, { name: "   ", slug: "   " })).toEqual([]);
  });

  it("caps the warning at five entries", () => {
    const many: StudioAmenityCatalogueEntry[] = Array.from({ length: 12 }, (_unused, index) => ({
      id: String(index),
      slug: `pool-${index}`,
      name: `Pool ${index}`,
      category: "Leisure",
      icon: "",
    }));
    expect(closeMatches(many, { name: "Pool", slug: "pool" })).toHaveLength(5);
  });
});

describe("featuredCount", () => {
  it("counts only the featured entries", () => {
    expect(featuredCount([])).toBe(0);
    expect(
      featuredCount([
        amenity("a", { isFeatured: true }),
        amenity("b"),
        amenity("c", { isFeatured: true }),
      ]),
    ).toBe(2);
  });

  it("reports the limit only once eight are featured", () => {
    const seven = Array.from({ length: 7 }, (_unused, index) =>
      amenity(`f${index}`, { isFeatured: true }),
    );
    expect(featuredLimitReached(seven)).toBe(false);
    expect(featuredLimitReached([...seven, amenity("f7", { isFeatured: true })])).toBe(true);
  });
});

describe("normalizeSortOrders", () => {
  it("renumbers each group 10, 20, 30 while preserving the array order", () => {
    const result = normalizeSortOrders([
      amenity("f1", { isFeatured: true, sortOrder: 999 }),
      amenity("r1", { sortOrder: 3 }),
      amenity("f2", { isFeatured: true, sortOrder: 0 }),
      amenity("r2", { sortOrder: 7 }),
      amenity("r3", { sortOrder: 7 }),
    ]);
    expect(result.map((row) => [row.slug, row.sortOrder])).toEqual([
      ["f1", 10],
      ["r1", 10],
      ["f2", 20],
      ["r2", 20],
      ["r3", 30],
    ]);
  });

  it("returns a fresh array and never mutates its input", () => {
    const input = [amenity("a", { sortOrder: 5 })];
    const result = normalizeSortOrders(input);
    expect(result).not.toBe(input);
    expect(result[0]).not.toBe(input[0]);
    expect(input[0].sortOrder).toBe(5);
  });
});

describe("displayOrder", () => {
  it("mirrors the public order: featured, then sortOrder, then category, name, slug", () => {
    const result = displayOrder([
      amenity("z", { category: "Leisure", name: "Zebra", sortOrder: 10 }),
      amenity("late-featured", { isFeatured: true, sortOrder: 20 }),
      amenity("a", { category: "Leisure", name: "Alpha", sortOrder: 10 }),
      amenity("early-featured", { isFeatured: true, sortOrder: 10 }),
    ]);
    expect(result.map((row) => row.slug)).toEqual(["early-featured", "late-featured", "a", "z"]);
  });

  it("is total, so an unordered project still reads back in one stable order", () => {
    const rows = [
      amenity("c", { category: "B", name: "C" }),
      amenity("a", { category: "A", name: "A" }),
      amenity("b", { category: "A", name: "B" }),
    ];
    expect(displayOrder(rows).map((row) => row.slug)).toEqual(["a", "b", "c"]);
    expect(displayOrder([...rows].reverse()).map((row) => row.slug)).toEqual(["a", "b", "c"]);
  });
});

describe("reorder", () => {
  const mixed = () => [
    amenity("f1", { isFeatured: true, sortOrder: 10 }),
    amenity("f2", { isFeatured: true, sortOrder: 20 }),
    amenity("r1", { sortOrder: 10 }),
    amenity("r2", { sortOrder: 20 }),
    amenity("r3", { sortOrder: 30 }),
  ];

  it("moves an entry one place within its own group and renumbers that group", () => {
    const result = reorder(mixed(), "r3", "up");
    expect(result.map((row) => row.slug)).toEqual(["f1", "f2", "r1", "r3", "r2"]);
    expect(result.map((row) => row.sortOrder)).toEqual([10, 20, 10, 20, 30]);
  });

  it("moves down as well as up", () => {
    expect(reorder(mixed(), "f1", "down").map((row) => row.slug)).toEqual([
      "f2",
      "f1",
      "r1",
      "r2",
      "r3",
    ]);
  });

  it("never moves an entry past the group boundary", () => {
    // The first featured row cannot rise, and the last non-featured row cannot
    // fall; a non-featured row can never outrank a featured one.
    expect(reorder(mixed(), "f1", "up").map((row) => row.slug)).toEqual([
      "f1",
      "f2",
      "r1",
      "r2",
      "r3",
    ]);
    expect(reorder(mixed(), "r3", "down").map((row) => row.slug)).toEqual([
      "f1",
      "f2",
      "r1",
      "r2",
      "r3",
    ]);
    // The first non-featured row asked to rise sits below featured rows: still
    // a boundary, so nothing moves.
    expect(reorder(mixed(), "r1", "up").map((row) => row.slug)).toEqual([
      "f1",
      "f2",
      "r1",
      "r2",
      "r3",
    ]);
  });

  it("swaps the nearest same-group entry even when it is not adjacent", () => {
    const interleaved = [
      amenity("r1", { sortOrder: 10 }),
      amenity("f1", { isFeatured: true, sortOrder: 10 }),
      amenity("r2", { sortOrder: 20 }),
    ];
    // r2 rises past the featured row that sits between the two regular rows.
    expect(reorder(interleaved, "r2", "up").map((row) => row.slug)).toEqual(["r2", "f1", "r1"]);
  });

  it("is a no-op for an unknown slug, and always returns a fresh array", () => {
    const input = mixed();
    const result = reorder(input, "not-selected", "up");
    expect(result).not.toBe(input);
    expect(result.map((row) => row.slug)).toEqual(["f1", "f2", "r1", "r2", "r3"]);
    expect(input.map((row) => row.sortOrder)).toEqual([10, 20, 10, 20, 30]);
  });
});

describe("toSavePayload", () => {
  it("projects the exact final set onto the transaction function's shape", () => {
    expect(
      toSavePayload([
        amenity("swimming-pool", { note: "Two lap pools", isFeatured: true, sortOrder: 10 }),
        amenity("spa", { note: "", sortOrder: 10 }),
      ]),
    ).toEqual([
      { amenity_slug: "swimming-pool", note: "Two lap pools", is_featured: true, sort_order: 10 },
      { amenity_slug: "spa", note: "", is_featured: false, sort_order: 10 },
    ]);
  });

  it("maps an empty selection to an empty set — a valid save that clears the project", () => {
    expect(toSavePayload([])).toEqual([]);
  });
});
