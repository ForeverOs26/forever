import { describe, expect, it } from "vitest";

import {
  buildForeverProjectTemplate,
  FOREVER_PROJECT_TEMPLATE_ID,
  formatProjectPackageVersion,
  PROJECT_COMPONENT_KINDS,
  requiredProjectComponentKinds,
} from "..";

describe("canonical Forever project template", () => {
  it("has the canonical identity, version, and one component per known kind", () => {
    const template = buildForeverProjectTemplate();
    expect(template.identity.id).toBe(FOREVER_PROJECT_TEMPLATE_ID);
    expect(template.identity.slug).toBe("forever-project");
    expect(formatProjectPackageVersion(template.version)).toBe("0.1.0");
    expect(template.components.map((c) => c.kind)).toEqual([...PROJECT_COMPONENT_KINDS]);
  });

  it("requires everything except the transport connector", () => {
    const template = buildForeverProjectTemplate();
    expect(template.components.filter((c) => !c.required).map((c) => c.kind)).toEqual(["connector"]);
    const required = requiredProjectComponentKinds(template);
    expect(required).toContain("identity");
    expect(required).toContain("verification");
    expect(required).not.toContain("connector");
  });

  it("carries a layout root template and a reference contract", () => {
    const template = buildForeverProjectTemplate();
    expect(template.layout.root).toBe("src/features/{slug}-integration");
    expect(template.references.length).toBeGreaterThan(0);
  });

  it("is a pure factory returning independent, equal values", () => {
    const a = buildForeverProjectTemplate();
    const b = buildForeverProjectTemplate();
    expect(a).toEqual(b);
    a.components.push({ kind: "identity", name: "x", foundation: "rc3.0", required: true });
    expect(b.components).toHaveLength(PROJECT_COMPONENT_KINDS.length);
  });
});
