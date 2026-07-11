import { describe, expect, it } from "vitest";

import {
  DEFAULT_CURRENCY,
  foreverDatabaseEntities,
  foreverTableNames,
  normalizeAvailabilityStatus,
  normalizeConstructionStatus,
  normalizeOwnershipType,
  normalizePublicStatus,
  normalizeSalesStatus,
  optionalMoney,
  optionalNumber,
  optionalPositiveNumber,
  optionalString,
  slugify,
  type ForeverDeveloper,
  type ForeverProject,
  type ForeverUnit,
} from "../domain";

describe("canonical model creation", () => {
  it("builds a strongly-typed developer record", () => {
    const developer: ForeverDeveloper = {
      id: "dev-1",
      slug: "acme-developments",
      name: "Acme Developments",
      verificationStatus: "verified",
    };
    expect(developer.slug).toBe("acme-developments");
    expect(developer.verificationStatus).toBe("verified");
  });

  it("builds a project record that preserves raw status strings", () => {
    const project: ForeverProject = {
      id: "project-1",
      slug: "modeva",
      name: "Modeva",
      projectType: "Condominium",
      publicStatus: "active",
      salesStatus: "available",
      constructionStatus: "planning",
      ownershipType: "freehold",
      raw: {
        publicStatus: "Available",
        salesStatus: "Available",
        constructionStatus: "Planning",
        ownershipType: "Freehold",
      },
      highlights: [],
      pricing: {},
      trust: { foreverVerified: true },
      isFeatured: false,
      isActive: true,
    };
    expect(project.raw.constructionStatus).toBe("Planning");
    expect(project.constructionStatus).toBe("planning");
  });

  it("keeps normalized and raw unit statuses side by side", () => {
    const unit: ForeverUnit = {
      id: "unit-1",
      projectId: "project-1",
      code: "A-101",
      unitType: "Condominium",
      availabilityStatus: "available",
      availabilityStatusRaw: "Available",
      ownershipType: "freehold",
      ownershipTypeRaw: "Freehold",
    };
    expect(unit.availabilityStatus).toBe("available");
    expect(unit.availabilityStatusRaw).toBe("Available");
  });
});

describe("entity registry", () => {
  it("declares one descriptor per canonical entity with unique table names", () => {
    const names = Object.values(foreverDatabaseEntities).map((entity) => entity.tableName);
    expect(new Set(names).size).toBe(names.length);
    expect(foreverTableNames).toEqual(names);
  });

  it("keys every descriptor by id", () => {
    for (const entity of Object.values(foreverDatabaseEntities)) {
      expect(entity.primaryKey).toBe("id");
    }
  });

  it("derives deterministic natural keys", () => {
    expect(
      foreverDatabaseEntities.unit.naturalKey({
        id: "unit-1",
        projectId: "project-1",
        code: "A-101",
      } as ForeverUnit),
    ).toBe("project-1::A-101");
  });
});

describe("normalizers", () => {
  it("slugifies deterministically and strips diacritics", () => {
    expect(slugify("The Modeva  Bang Tao")).toBe("the-modeva-bang-tao");
    expect(slugify("Phuket")).toBe("phuket");
    expect(slugify("  Café Résidence!! ")).toBe("cafe-residence");
  });

  it("treats empty and sentinel values as absent facts", () => {
    expect(optionalString("  ")).toBeUndefined();
    expect(optionalString("value")).toBe("value");
    expect(optionalNumber(null)).toBeUndefined();
    expect(optionalNumber(Number.NaN)).toBeUndefined();
    expect(optionalNumber(0)).toBe(0);
    expect(optionalPositiveNumber(0)).toBeUndefined();
    expect(optionalPositiveNumber(12)).toBe(12);
  });

  it("drops non-positive money and defaults currency to THB", () => {
    expect(optionalMoney(0)).toBeUndefined();
    expect(optionalMoney(null)).toBeUndefined();
    expect(optionalMoney(1_000)).toEqual({ amount: 1_000, currency: DEFAULT_CURRENCY });
  });

  it("maps free-text statuses onto closed enums", () => {
    expect(normalizePublicStatus("Available")).toBe("active");
    expect(normalizePublicStatus("")).toBe("unknown");
    expect(normalizeSalesStatus("Sold Out")).toBe("sold_out");
    expect(normalizeConstructionStatus("Under Construction")).toBe("under_construction");
    expect(normalizeConstructionStatus("Completed")).toBe("completed");
    expect(normalizeOwnershipType("Freehold / Leasehold")).toBe("mixed");
    expect(normalizeAvailabilityStatus("Reserved")).toBe("reserved");
    expect(normalizeAvailabilityStatus("mystery")).toBe("unknown");
  });
});
