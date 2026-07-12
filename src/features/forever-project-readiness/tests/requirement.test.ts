import { describe, expect, it } from "vitest";

import {
  READINESS_NECESSITIES,
  READINESS_REQUIREMENT_KINDS,
  compareReadinessRequirements,
  isKnownReadinessNecessity,
  isKnownReadinessRequirementKind,
  isReadinessFieldRequirementKind,
  readinessRequirement,
  readinessRequirementNecessity,
  readinessRequirementSignature,
  readinessRequirementSubject,
} from "..";
import type { ReadinessRequirement } from "..";

describe("requirement", () => {
  it("declares the closed kind and necessity vocabularies with guards", () => {
    expect(READINESS_REQUIREMENT_KINDS).toHaveLength(6);
    for (const kind of READINESS_REQUIREMENT_KINDS) {
      expect(isKnownReadinessRequirementKind(kind)).toBe(true);
    }
    expect(isKnownReadinessRequirementKind("field_blessed")).toBe(false);
    expect(isKnownReadinessRequirementKind(undefined)).toBe(false);
    expect(READINESS_NECESSITIES).toEqual(["required", "recommended"]);
    expect(isKnownReadinessNecessity("required")).toBe(true);
    expect(isKnownReadinessNecessity("optional")).toBe(false);
  });

  it("splits kinds along the path line: field kinds address a path", () => {
    expect(isReadinessFieldRequirementKind("field_present")).toBe(true);
    expect(isReadinessFieldRequirementKind("field_confidence")).toBe(true);
    expect(isReadinessFieldRequirementKind("field_corroborated")).toBe(true);
    expect(isReadinessFieldRequirementKind("field_uncontested")).toBe(true);
    expect(isReadinessFieldRequirementKind("source_present")).toBe(false);
    expect(isReadinessFieldRequirementKind("findings_clear")).toBe(false);
  });

  it("builds requirements without inventing bars, and never aliases the input", () => {
    const requirement = readinessRequirement("field_present", { path: "pricing.basePrice" });
    expect(requirement).toEqual({ kind: "field_present", path: "pricing.basePrice" });
    expect(requirement.necessity).toBeUndefined();
    expect(requirement.minimumTrust).toBeUndefined();

    const options = { path: "pricing.basePrice", note: "why" };
    const built = readinessRequirement("field_present", options);
    options.note = "mutated";
    expect(built.note).toBe("why");
  });

  it("reads necessity through the demanding safe posture", () => {
    expect(readinessRequirementNecessity({ kind: "field_present" })).toBe("required");
    expect(readinessRequirementNecessity({ kind: "field_present", necessity: "recommended" })).toBe(
      "recommended",
    );
    expect(
      readinessRequirementNecessity({
        kind: "field_present",
        necessity: "optional",
      } as unknown as ReadinessRequirement),
    ).toBe("required");
    expect(readinessRequirementNecessity(undefined)).toBe("required");
  });

  it("derives the ordering subject from path, then document type, then nothing", () => {
    expect(readinessRequirementSubject({ kind: "field_present", path: "a.b" })).toBe("a.b");
    expect(
      readinessRequirementSubject({ kind: "source_present", documentType: "price_list" }),
    ).toBe("price_list");
    expect(readinessRequirementSubject({ kind: "findings_clear" })).toBe("");
  });

  it("signatures the demand, not the rationale", () => {
    const a: ReadinessRequirement = { kind: "field_present", path: "a.b", note: "first" };
    const b: ReadinessRequirement = { kind: "field_present", path: "a.b", note: "second" };
    expect(readinessRequirementSignature(a)).toBe(readinessRequirementSignature(b));

    const explicit: ReadinessRequirement = {
      kind: "field_present",
      path: "a.b",
      necessity: "required",
    };
    expect(readinessRequirementSignature(a)).toBe(readinessRequirementSignature(explicit));

    const recommended: ReadinessRequirement = {
      kind: "field_present",
      path: "a.b",
      necessity: "recommended",
    };
    expect(readinessRequirementSignature(a)).not.toBe(readinessRequirementSignature(recommended));
  });

  it("signatures cannot collide across fields — the separator is outside every vocabulary", () => {
    const spacedPath: ReadinessRequirement = { kind: "findings_clear", path: "a b" };
    const otherPath: ReadinessRequirement = { kind: "findings_clear", path: "a" };
    expect(readinessRequirementSignature(spacedPath)).not.toBe(
      readinessRequirementSignature(otherPath),
    );
  });

  it("orders requirements by kind, subject, bars, and necessity — deterministically", () => {
    const requirements: ReadinessRequirement[] = [
      { kind: "findings_clear" },
      { kind: "source_present", documentType: "brochure" },
      { kind: "field_present", path: "b" },
      { kind: "field_present", path: "a" },
      { kind: "field_present", path: "a", necessity: "recommended" },
    ];
    const sorted = [...requirements].sort(compareReadinessRequirements);
    expect(
      sorted.map(
        (entry) =>
          `${entry.kind}:${readinessRequirementSubject(entry)}:${readinessRequirementNecessity(entry)}`,
      ),
    ).toEqual([
      "field_present:a:recommended",
      "field_present:a:required",
      "field_present:b:required",
      "source_present:brochure:required",
      "findings_clear::required",
    ]);
  });
});
