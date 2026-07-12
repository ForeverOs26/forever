import { describe, expect, it } from "vitest";

import {
  deriveProjectPackageIdentity,
  normalizeProjectSlug,
  projectCanonicalId,
  projectIntegrationIdForSlug,
  projectPackageId,
  projectRegistryId,
} from "..";

describe("identity naming conventions", () => {
  it("normalizes a slug through the RC3.0 rule", () => {
    expect(normalizeProjectSlug("Coralina Kamala")).toBe("coralina-kamala");
    expect(normalizeProjectSlug("coralina")).toBe("coralina");
  });

  it("derives deterministic package, project, and integration ids, normalizing first", () => {
    expect(projectPackageId("coralina")).toBe("pkg_coralina");
    expect(projectCanonicalId("coralina")).toBe("proj_coralina");
    expect(projectIntegrationIdForSlug("coralina")).toBe("integ_coralina");
    expect(projectPackageId("Coralina Kamala")).toBe("pkg_coralina-kamala");
    expect(projectCanonicalId("Coralina Kamala")).toBe("proj_coralina-kamala");
  });

  it("builds a registry id from a slug and role", () => {
    expect(projectRegistryId("coralina", "sources")).toBe("coralina-sources");
    expect(projectRegistryId("Coralina", "integrations")).toBe("coralina-integrations");
  });

  it("derives a full package identity with defaults", () => {
    expect(deriveProjectPackageIdentity("coralina")).toEqual({
      id: "pkg_coralina",
      slug: "coralina",
      name: "coralina",
      scope: "project",
    });
  });

  it("honours name and scope overrides and stays a pure function", () => {
    const identity = deriveProjectPackageIdentity("coralina", { name: "Coralina", scope: "developer" });
    expect(identity.name).toBe("Coralina");
    expect(identity.scope).toBe("developer");
    expect(deriveProjectPackageIdentity("coralina")).toEqual(deriveProjectPackageIdentity("coralina"));
  });
});
