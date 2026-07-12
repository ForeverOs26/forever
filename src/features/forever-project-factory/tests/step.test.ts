import { describe, expect, it } from "vitest";

import { FACTORY_STEP_KINDS, factoryStep, isKnownFactoryStepKind } from "..";

describe("factory steps", () => {
  it("guards the closed step-kind vocabulary", () => {
    for (const kind of FACTORY_STEP_KINDS) {
      expect(isKnownFactoryStepKind(kind)).toBe(true);
    }
    expect(isKnownFactoryStepKind("scaffold")).toBe(false);
    expect(isKnownFactoryStepKind(42)).toBe(false);
  });

  it("builds a minimal step with no fabricated optional fields", () => {
    const step = factoryStep("derive-identity", "Derive the package identity", "identity");
    expect(step).toEqual({
      id: "derive-identity",
      name: "Derive the package identity",
      kind: "identity",
    });
    expect(Object.keys(step)).toEqual(["id", "name", "kind"]);
  });

  it("attaches components, entity kind, optionality, and description when supplied", () => {
    const step = factoryStep("describe-package", "Describe the package", "package", {
      components: ["sources", "pipeline"],
      entityKind: "project",
      optional: true,
      description: "Describe the RC4.2 package.",
    });
    expect(step.components).toEqual(["sources", "pipeline"]);
    expect(step.entityKind).toBe("project");
    expect(step.optional).toBe(true);
    expect(step.description).toBe("Describe the RC4.2 package.");
  });
});
