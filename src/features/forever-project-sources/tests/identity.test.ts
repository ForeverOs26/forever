import { describe, expect, it } from "vitest";

import { projectCanonicalId } from "@/features/forever-project-template";

import {
  PROJECT_SOURCE_ID_PREFIXES,
  deriveProjectSourceIdentity,
  normalizeProjectSourceSlug,
  projectSourceIdFor,
  projectSourceVersion,
} from "..";

describe("source identity", () => {
  it("reuses the RC3.0 slug rule through RC4.2 — never a local variant", () => {
    expect(normalizeProjectSourceSlug("Price List (EN) 2026")).toBe("price-list-en-2026");
    expect(normalizeProjectSourceSlug("Café Brochure")).toBe("cafe-brochure");
  });

  it("derives deterministic ids, with and without a version address", () => {
    expect(projectSourceIdFor("coralina", "price-list")).toBe("psrc_coralina-price-list");
    expect(projectSourceIdFor("Coralina", "Price List", projectSourceVersion(1, 2, 3))).toBe(
      "psrc_coralina-price-list-v1-2-3",
    );
    expect(PROJECT_SOURCE_ID_PREFIXES.source).toBe("psrc_");
  });

  it("derives a full identity: defaults from the input only, project id via the RC4.2 rule", () => {
    const identity = deriveProjectSourceIdentity("coralina", "Price List");
    expect(identity).toEqual({
      id: "psrc_coralina-price-list",
      slug: "price-list",
      name: "price-list",
      projectId: projectCanonicalId("coralina"),
    });
    expect(identity.projectId).toBe("proj_coralina");

    const versioned = deriveProjectSourceIdentity("coralina", "price-list", {
      name: "Coralina Price List",
      version: projectSourceVersion(2, 0, 0),
    });
    expect(versioned.id).toBe("psrc_coralina-price-list-v2-0-0");
    expect(versioned.name).toBe("Coralina Price List");
  });

  it("is pure: the same input always yields an equal, independent identity", () => {
    const derive = () => deriveProjectSourceIdentity("coralina", "price-list");
    expect(derive()).toEqual(derive());
    expect(derive()).not.toBe(derive());
  });
});
