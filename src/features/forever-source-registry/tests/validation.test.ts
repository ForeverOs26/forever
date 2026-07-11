import { describe, expect, it } from "vitest";

import {
  validateSourceCapabilities,
  validateSourceDefinition,
  validateSourceIdentity,
  validateSourceRegistry,
  validateSourceRegistryEntry,
  validateSourceVersion,
  sourceCapability,
  sourceVersion,
} from "..";
import { makeDefinition, makeEntry, makeIdentity, makeRegistry } from "./fixtures";

describe("validateSourceIdentity", () => {
  it("passes a well-formed identity", () => {
    expect(validateSourceIdentity(makeIdentity())).toEqual([]);
  });

  it("flags missing id, slug, and name", () => {
    const codes = validateSourceIdentity(makeIdentity({ id: "", slug: "  ", name: "" })).map(
      (issue) => issue.code,
    );
    expect(codes).toContain("missing_source_id");
    expect(codes).toContain("missing_source_slug");
    expect(codes).toContain("missing_source_name");
  });

  it("errors on an unknown type", () => {
    const issues = validateSourceIdentity(makeIdentity({ type: "spreadsheet" as never }));
    expect(issues.map((i) => i.code)).toContain("unknown_source_type");
  });

  it("warns when the category is not the canonical one for its type", () => {
    const issues = validateSourceIdentity(makeIdentity({ category: "file" }));
    expect(issues.map((i) => i.code)).toContain("category_mismatch");
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });
});

describe("validateSourceVersion", () => {
  it("passes non-negative integers and flags the rest", () => {
    expect(validateSourceVersion(sourceVersion(1, 2, 3))).toEqual([]);
    expect(validateSourceVersion({ major: -1, minor: 0, patch: 0.5 }).map((i) => i.path)).toEqual([
      "version.major",
      "version.patch",
    ]);
  });
});

describe("validateSourceCapabilities", () => {
  it("flags duplicate capability kinds", () => {
    const issues = validateSourceCapabilities([
      sourceCapability("read"),
      sourceCapability("read", false),
    ]);
    expect(issues.map((i) => i.code)).toContain("duplicate_capability");
  });

  it("flags an unknown capability kind", () => {
    const issues = validateSourceCapabilities([{ kind: "teleport" as never, supported: true }]);
    expect(issues.map((i) => i.code)).toContain("unknown_capability_kind");
  });
});

describe("validateSourceDefinition", () => {
  it("passes a well-formed definition", () => {
    expect(validateSourceDefinition(makeDefinition())).toEqual([]);
  });

  it("requires at least one supported entity", () => {
    const issues = validateSourceDefinition(makeDefinition({ supportedEntities: [] }));
    expect(issues.map((i) => i.code)).toContain("no_supported_entities");
  });

  it("errors on unknown lifecycle, priority, and trust", () => {
    const issues = validateSourceDefinition(
      makeDefinition({
        lifecycle: "zombie" as never,
        priority: "urgent" as never,
        trustLevel: "sacred" as never,
      }),
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("unknown_lifecycle");
    expect(codes).toContain("unknown_priority");
    expect(codes).toContain("unknown_trust_level");
  });
});

describe("validateSourceRegistryEntry", () => {
  it("errors on an unknown status", () => {
    const issues = validateSourceRegistryEntry(makeEntry({ status: "paused" as never }));
    expect(issues.map((i) => i.code)).toContain("unknown_status");
  });
});

describe("validateSourceRegistry", () => {
  it("passes a coherent registry", () => {
    const validation = validateSourceRegistry(makeRegistry());
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("requires a registry id", () => {
    const validation = validateSourceRegistry(makeRegistry({ id: "" }));
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((i) => i.code)).toContain("missing_registry_id");
  });

  it("rejects a source registered twice by id", () => {
    const validation = validateSourceRegistry(
      makeRegistry({ entries: [makeEntry(), makeEntry()] }),
    );
    expect(validation.valid).toBe(false);
    const codes = validation.errors.map((i) => i.code);
    expect(codes).toContain("duplicate_source_id");
    expect(codes).toContain("duplicate_source_key");
  });
});
