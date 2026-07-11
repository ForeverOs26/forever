import { describe, expect, it } from "vitest";

import { projectDetailToForeverRecord } from "../adapters";
import { validateForeverDatabaseRecord } from "../domain";
import { makeProjectDetail, makeUnit } from "./fixtures";

/**
 * RC3.0 must add the database foundation without disturbing RC2. These tests
 * pin the compatibility contract: the existing `ProjectDetail` shape is
 * consumed read-only, no fact is lost in translation, and every RC2 field the
 * canonical model represents survives the round of mapping.
 */

describe("backward compatibility with the existing ProjectDetail view model", () => {
  it("consumes ProjectDetail without mutating it", () => {
    const input = makeProjectDetail({ units: [makeUnit()] });
    const before = structuredClone(input);
    projectDetailToForeverRecord(input);
    expect(input).toEqual(before);
  });

  it("preserves the original free-text status wording", () => {
    const input = makeProjectDetail({
      core: { status: "Available", constructionStatus: "Planning", ownershipType: "Freehold" },
    });
    const record = projectDetailToForeverRecord(input);
    expect(record.project.raw.constructionStatus).toBe("Planning");
    expect(record.project.raw.ownershipType).toBe("Freehold");
    expect(record.project.raw.publicStatus).toBe("Available");
  });

  it("carries core identity fields through unchanged", () => {
    const input = makeProjectDetail();
    const record = projectDetailToForeverRecord(input);
    expect(record.project.id).toBe(input.core.id);
    expect(record.project.slug).toBe(input.core.slug);
    expect(record.project.name).toBe(input.core.name);
    expect(record.project.projectType).toBe(input.core.type);
    expect(record.project.isFeatured).toBe(input.core.isFeatured);
    expect(record.project.isActive).toBe(input.core.isActive);
  });

  it("maps a sparse verified-but-empty seed into a valid canonical record", () => {
    const record = projectDetailToForeverRecord(makeProjectDetail());
    const result = validateForeverDatabaseRecord(record);
    expect(result.valid).toBe(true);
  });

  it("keeps unit codes and ids stable for downstream joins", () => {
    const input = makeProjectDetail({
      units: [makeUnit({ id: "unit-9", code: "B-204" })],
    });
    const record = projectDetailToForeverRecord(input);
    expect(record.units[0].id).toBe("unit-9");
    expect(record.units[0].code).toBe("B-204");
    expect(record.units[0].projectId).toBe(input.core.id);
  });
});
