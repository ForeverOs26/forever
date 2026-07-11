import { describe, expect, it } from "vitest";

import {
  validateEntityIds,
  validateImport,
  validateReferences,
  validateRequiredFields,
  type ImportBatch,
} from "../validation";
import { makeDeveloper, makeDocument, makeMedia, makeProject } from "./fixtures";

describe("validateRequiredFields", () => {
  it("passes when every required field is present", () => {
    const issues = validateRequiredFields({ name: "X", slug: "x" }, ["name", "slug"]);
    expect(issues).toEqual([]);
  });

  it("flags undefined, null, and blank values with a located error", () => {
    const issues = validateRequiredFields(
      { name: "", slug: null, url: "  " },
      ["name", "slug", "url"],
      "project",
    );
    expect(issues.map((i) => i.path)).toEqual(["project.name", "project.slug", "project.url"]);
    expect(issues.every((i) => i.code === "missing_required_field" && i.severity === "error")).toBe(
      true,
    );
  });
});

describe("validateEntityIds", () => {
  it("passes for unique, non-empty ids", () => {
    expect(validateEntityIds([makeMedia({ id: "a" }), makeMedia({ id: "b" })], "media")).toEqual(
      [],
    );
  });

  it("flags a missing id and a duplicate id", () => {
    const issues = validateEntityIds([{ id: "" }, { id: "dup" }, { id: "dup" }], "media");
    expect(issues.map((i) => i.code)).toEqual(["missing_entity_id", "duplicate_entity_id"]);
    expect(issues[1].path).toBe("media.2.id");
  });
});

describe("validateReferences", () => {
  it("resolves references satisfied within the batch", () => {
    const batch: ImportBatch = {
      developers: [makeDeveloper({ id: "dev-1" })],
      projects: [makeProject({ id: "p-1", developerId: "dev-1" })],
      media: [makeMedia({ projectId: "p-1" })],
    };
    expect(validateReferences(batch)).toEqual([]);
  });

  it("resolves references satisfied only by an external scope", () => {
    const batch: ImportBatch = { media: [makeMedia({ projectId: "p-9" })] };
    expect(validateReferences(batch, { projectIds: new Set(["p-9"]) })).toEqual([]);
  });

  it("flags a dangling project reference on media", () => {
    const batch: ImportBatch = { media: [makeMedia({ projectId: "ghost" })] };
    const issues = validateReferences(batch);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("unresolved_reference");
    expect(issues[0].path).toBe("media.0.projectId");
  });

  it("flags an unresolved developer reference on a project", () => {
    const batch: ImportBatch = { projects: [makeProject({ developerId: "missing" })] };
    const issues = validateReferences(batch);
    expect(issues.some((i) => i.path === "projects.0.developerId")).toBe(true);
  });

  it("ignores absent optional references", () => {
    const batch: ImportBatch = { projects: [makeProject({ developerId: undefined })] };
    expect(validateReferences(batch)).toEqual([]);
  });
});

describe("validateImport", () => {
  it("returns valid for a clean, self-consistent batch", () => {
    const batch: ImportBatch = {
      projects: [makeProject({ id: "p-1", developerId: undefined, locationId: undefined })],
      documents: [makeDocument({ projectId: "p-1" })],
    };
    const result = validateImport(batch);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("aggregates id, duplicate, and reference issues in one pass", () => {
    const batch: ImportBatch = {
      media: [
        makeMedia({ id: "m-1", projectId: "ghost", url: "https://x/a.jpg" }),
        makeMedia({ id: "m-1", projectId: "ghost", url: "https://x/a.jpg" }),
      ],
    };
    const result = validateImport(batch);
    expect(result.valid).toBe(false);
    const codes = new Set(result.errors.map((e) => e.code));
    expect(codes.has("duplicate_entity_id")).toBe(true);
    expect(codes.has("duplicate_entity")).toBe(true);
    expect(codes.has("unresolved_reference")).toBe(true);
  });
});
