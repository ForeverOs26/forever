import { describe, expect, it } from "vitest";

import {
  PROJECT_SECTION_KEYS,
  compareProjectSections,
  isKnownProjectSectionKey,
  listProjectSections,
  projectSectionFor,
  projectSectionForPath,
  projectSectionRank,
} from "..";

describe("canonical sections", () => {
  it("declares all seventeen canonical sections, Unknown last", () => {
    expect(PROJECT_SECTION_KEYS).toEqual([
      "general",
      "developer",
      "location",
      "construction",
      "units",
      "pricing",
      "payment",
      "investment",
      "rental",
      "amenities",
      "legal",
      "facilities",
      "timeline",
      "documents",
      "media",
      "notes",
      "unknown",
    ]);
  });

  it("guards the vocabulary", () => {
    for (const key of PROJECT_SECTION_KEYS) expect(isKnownProjectSectionKey(key)).toBe(true);
    expect(isKnownProjectSectionKey("marketing")).toBe(false);
    expect(isKnownProjectSectionKey(undefined)).toBe(false);
    expect(isKnownProjectSectionKey(3)).toBe(false);
  });

  it("ranks and compares by the canonical declared order", () => {
    expect(projectSectionRank("general")).toBe(0);
    expect(projectSectionRank("unknown")).toBe(PROJECT_SECTION_KEYS.length - 1);
    expect(compareProjectSections("general", "pricing")).toBeLessThan(0);
    expect(compareProjectSections("unknown", "notes")).toBeGreaterThan(0);
    expect(compareProjectSections("legal", "legal")).toBe(0);
  });

  it("describes sections deterministically without aliasing module state", () => {
    const pricing = projectSectionFor("pricing");
    expect(pricing).toEqual({ key: "pricing", name: "Pricing", order: 5 });
    pricing.name = "mutated";
    expect(projectSectionFor("pricing").name).toBe("Pricing");
    expect(listProjectSections()).toHaveLength(PROJECT_SECTION_KEYS.length);
    expect(listProjectSections().map((section) => section.key)).toEqual([...PROJECT_SECTION_KEYS]);
  });

  it("classifies paths by their declared head segment, never guessing", () => {
    expect(projectSectionForPath("pricing.basePrice")).toBe("pricing");
    expect(projectSectionForPath("Legal.ownership")).toBe("legal");
    expect(projectSectionForPath("units")).toBe("units");
    expect(projectSectionForPath("floorplan.tower-a")).toBe("unknown");
    expect(projectSectionForPath("")).toBe("unknown");
    expect(projectSectionForPath(null as never)).toBe("unknown");
  });
});
