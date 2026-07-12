import { describe, expect, it } from "vitest";

import { FOREVER_PROJECT_TEMPLATE_ID } from "@/features/forever-project-template";

import { FOREVER_PROJECT_FACTORY_ID, FactoryRegistry, deriveFactoryIdentity } from "..";
import { makeFactory } from "./fixtures";

const other = makeFactory({
  identity: deriveFactoryIdentity("portfolio-factory", { scope: "portfolio" }),
  entities: ["project"],
  recipes: [],
});

describe("FactoryRegistry", () => {
  it("registers and resolves factories by id", () => {
    const registry = new FactoryRegistry().register(makeFactory());
    expect(registry.has(FOREVER_PROJECT_FACTORY_ID)).toBe(true);
    expect(registry.resolve(FOREVER_PROJECT_FACTORY_ID)?.identity.slug).toBe("forever-project");
    expect(registry.resolve("fact_unknown")).toBeUndefined();
    expect(registry.has("fact_unknown")).toBe(false);
  });

  it("throws on a duplicate registration so clashes surface at wiring time", () => {
    const registry = new FactoryRegistry().register(makeFactory());
    expect(() => registry.register(makeFactory())).toThrow(FOREVER_PROJECT_FACTORY_ID);
  });

  it("lists registered factories in insertion order", () => {
    const registry = new FactoryRegistry().register(other).register(makeFactory());
    expect(registry.list().map((definition) => definition.identity.id)).toEqual([
      "fact_portfolio-factory",
      FOREVER_PROJECT_FACTORY_ID,
    ]);
  });

  it("filters by scope and by covered entity kind", () => {
    const registry = new FactoryRegistry().register(makeFactory()).register(other);
    expect(registry.listByScope("portfolio").map((d) => d.identity.id)).toEqual([
      "fact_portfolio-factory",
    ]);
    expect(registry.listByEntity("media").map((d) => d.identity.id)).toEqual([
      FOREVER_PROJECT_FACTORY_ID,
    ]);
  });

  it("filters by the RC4.2 template a factory generates from", () => {
    const registry = new FactoryRegistry().register(makeFactory()).register(other);
    expect(registry.listByTemplate(FOREVER_PROJECT_TEMPLATE_ID).map((d) => d.identity.id)).toEqual([
      FOREVER_PROJECT_FACTORY_ID,
    ]);
    expect(registry.listByTemplate("tmpl_unknown")).toEqual([]);
  });
});
