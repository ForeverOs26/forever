import { describe, expect, it } from "vitest";

import {
  foreverProjectReferences,
  isKnownProjectReferenceKind,
  PROJECT_REFERENCE_KINDS,
  projectReference,
  projectReferencesFrom,
  requiredProjectReferences,
} from "..";

describe("project references", () => {
  it("declares the closed reference vocabulary and guards it", () => {
    expect(PROJECT_REFERENCE_KINDS).toContain("integration-source");
    expect(PROJECT_REFERENCE_KINDS).toContain("canonical-integrity");
    expect(new Set(PROJECT_REFERENCE_KINDS).size).toBe(PROJECT_REFERENCE_KINDS.length);
    expect(isKnownProjectReferenceKind("pipeline-source")).toBe(true);
    expect(isKnownProjectReferenceKind("nope")).toBe(false);
  });

  it("builds a reference with only the fields supplied", () => {
    const ref = projectReference("integration-source", "integration", "sources", true);
    expect(ref).toEqual({
      kind: "integration-source",
      from: "integration",
      to: "sources",
      required: true,
    });
    expect("description" in ref).toBe(false);
  });

  it("marks developer, document, media, and connector references optional (anti-fabrication)", () => {
    const optional = foreverProjectReferences()
      .filter((r) => !r.required)
      .map((r) => r.kind);
    expect(optional).toContain("project-developer");
    expect(optional).toContain("document-project");
    expect(optional).toContain("media-project");
    expect(optional).toContain("integration-connector");
  });

  it("keeps core references required and collects references by their source component", () => {
    const required = requiredProjectReferences(foreverProjectReferences()).map((r) => r.kind);
    expect(required).toContain("integration-source");
    expect(required).toContain("unit-project");
    expect(required).toContain("canonical-integrity");

    const fromIntegration = projectReferencesFrom(foreverProjectReferences(), "integration");
    expect(fromIntegration.every((r) => r.from === "integration")).toBe(true);
  });
});
