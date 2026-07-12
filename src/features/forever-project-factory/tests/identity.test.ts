import { describe, expect, it } from "vitest";

import { normalizeProjectSlug } from "@/features/forever-project-template";

import {
  FACTORY_ID_PREFIXES,
  deriveFactoryIdentity,
  factoryBuildIdForSlug,
  factoryIdForSlug,
  normalizeFactorySlug,
} from "..";

describe("factory identity", () => {
  it("reuses the RC4.2/RC3.0 slug rule verbatim, never a local variant", () => {
    expect(normalizeFactorySlug).toBe(normalizeProjectSlug);
    expect(normalizeFactorySlug("Villa Coralina")).toBe("villa-coralina");
  });

  it("derives prefixed factory and build ids from an unnormalized slug", () => {
    expect(factoryIdForSlug("Villa Coralina")).toBe("fact_villa-coralina");
    expect(factoryBuildIdForSlug("Villa Coralina")).toBe("build_villa-coralina");
    expect(FACTORY_ID_PREFIXES.factory).toBe("fact_");
    expect(FACTORY_ID_PREFIXES.build).toBe("build_");
  });

  it("derives a full identity with defaults, honouring overrides without touching ids", () => {
    expect(deriveFactoryIdentity("Villa Coralina")).toEqual({
      id: "fact_villa-coralina",
      slug: "villa-coralina",
      name: "villa-coralina",
      scope: "project",
    });
    expect(deriveFactoryIdentity("coralina", { name: "Coralina", scope: "portfolio" })).toEqual({
      id: "fact_coralina",
      slug: "coralina",
      name: "Coralina",
      scope: "portfolio",
    });
  });

  it("is deterministic: the same slug always yields an equal identity", () => {
    expect(deriveFactoryIdentity("coralina")).toEqual(deriveFactoryIdentity("coralina"));
  });
});
