import { describe, expect, it } from "vitest";

import {
  SOURCE_CATEGORIES,
  SOURCE_TYPES,
  isKnownSourceCategory,
  isKnownSourceType,
  sourceCategoryForType,
  type SourceType,
} from "..";

describe("source type and category enums", () => {
  it("describes every source RC3.3 must support", () => {
    for (const type of [
      "developer_website",
      "crm",
      "marketplace",
      "forever_database",
      "manual_entry",
      "pdf",
      "excel",
      "csv",
      "json",
      "api",
      "ai_agent",
    ] satisfies SourceType[]) {
      expect(SOURCE_TYPES).toContain(type);
    }
  });

  it("represents a future provider explicitly as unknown", () => {
    expect(SOURCE_TYPES).toContain("unknown");
    expect(sourceCategoryForType("unknown")).toBe("unknown");
  });

  it("maps every type to a known category deterministically", () => {
    for (const type of SOURCE_TYPES) {
      const category = sourceCategoryForType(type);
      expect(SOURCE_CATEGORIES).toContain(category);
      expect(sourceCategoryForType(type)).toBe(category);
    }
  });

  it("groups the file formats under the file category", () => {
    for (const type of ["pdf", "excel", "csv", "json"] satisfies SourceType[]) {
      expect(sourceCategoryForType(type)).toBe("file");
    }
  });

  it("guards known and unknown values", () => {
    expect(isKnownSourceType("crm")).toBe(true);
    expect(isKnownSourceType("spreadsheet")).toBe(false);
    expect(isKnownSourceCategory("file")).toBe(true);
    expect(isKnownSourceCategory("blob")).toBe(false);
  });
});
