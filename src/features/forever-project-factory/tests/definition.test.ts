import { describe, expect, it } from "vitest";

import {
  FOREVER_PROJECT_FACTORY_ID,
  buildForeverProjectFactory,
  defineFactory,
  deriveFactoryIdentity,
  factoryIdForSlug,
  foreverProjectFactoryRecipe,
  formatFactoryVersion,
} from "..";

describe("the canonical factory", () => {
  it("derives its identity through the module's own id rule — one path, one id", () => {
    const factory = buildForeverProjectFactory();
    expect(FOREVER_PROJECT_FACTORY_ID).toBe(factoryIdForSlug("forever-project"));
    expect(factory.identity).toEqual(
      deriveFactoryIdentity("forever-project", { name: "Forever Project Factory" }),
    );
    expect(factory.identity).toEqual({
      id: "fact_forever-project",
      slug: "forever-project",
      name: "Forever Project Factory",
      scope: "project",
    });
    expect(formatFactoryVersion(factory.version)).toBe("0.1.0");
  });

  it("declares exactly one recipe: the canonical Forever project recipe", () => {
    const factory = buildForeverProjectFactory();
    expect(factory.recipes).toEqual([foreverProjectFactoryRecipe()]);
  });

  it("covers the core entity kinds and carries the safe default policy", () => {
    const factory = buildForeverProjectFactory();
    expect(factory.entities).toEqual(["project", "document", "media"]);
    expect(factory.policy?.dryRunOnly).toBe(true);
    expect(factory.policy?.executionMode).toBe("sequential");
    expect(factory.policy?.onError).toBe("abort");
  });

  it("defineFactory returns the definition unchanged", () => {
    const factory = buildForeverProjectFactory();
    expect(defineFactory(factory)).toBe(factory);
  });
});
