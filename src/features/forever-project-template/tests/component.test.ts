import { describe, expect, it } from "vitest";

import {
  isKnownProjectComponentKind,
  isKnownProjectFoundation,
  PROJECT_COMPONENT_KINDS,
  PROJECT_FOUNDATIONS,
  projectComponent,
} from "..";

describe("project components", () => {
  it("declares the closed component vocabulary in data-flow order and guards it", () => {
    expect(PROJECT_COMPONENT_KINDS).toEqual([
      "identity",
      "sources",
      "connector",
      "pipeline",
      "canonical",
      "integration",
      "references",
      "verification",
    ]);
    expect(isKnownProjectComponentKind("sources")).toBe(true);
    expect(isKnownProjectComponentKind("nope")).toBe(false);
  });

  it("declares the closed foundation vocabulary in release order and guards it", () => {
    expect(PROJECT_FOUNDATIONS).toEqual(["rc3.0", "rc3.3", "rc3.4", "rc3.5", "rc4.0", "rc4.1"]);
    expect(isKnownProjectFoundation("rc4.0")).toBe(true);
    expect(isKnownProjectFoundation("rc9.9")).toBe(false);
  });

  it("builds a component with only the fields supplied", () => {
    const bare = projectComponent("connector", "Transport connector", "rc3.4", false);
    expect(bare).toEqual({
      kind: "connector",
      name: "Transport connector",
      foundation: "rc3.4",
      required: false,
    });
    expect("entities" in bare).toBe(false);
    expect("description" in bare).toBe(false);
  });

  it("attaches optional entities and description when supplied", () => {
    const full = projectComponent("sources", "Source definitions", "rc3.3", true, {
      entities: ["project", "document"],
      description: "verified sources",
    });
    expect(full.entities).toEqual(["project", "document"]);
    expect(full.description).toBe("verified sources");
  });
});
