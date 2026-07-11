import { describe, expect, it } from "vitest";

import { projectDetailToForeverRecord } from "../adapters";
import {
  findDuplicateEntities,
  foreverDatabaseEntities,
  validateForeverDatabaseRecord,
  validateNoDuplicateEntities,
  validateReferentialIntegrity,
  type ForeverMedia,
} from "../domain";
import { makeInvestmentRow, makeMediaItem, makeProjectDetail, makeUnit } from "./fixtures";

function fullRecord() {
  return projectDetailToForeverRecord(
    makeProjectDetail({
      pricing: { startingPriceTHB: 5_000_000 },
      units: [makeUnit({ paymentPlan: "30/70" })],
      media: {
        gallery: [makeMediaItem()],
        brochures: [makeMediaItem({ id: "b1", type: "brochure", url: "https://x/b.pdf" })],
      },
      investment: {
        investmentValue: 6_000_000,
        rows: [makeInvestmentRow({ expectedMonthlyRent: 30_000, annualRoiPercent: 7 })],
      },
    }),
  );
}

describe("schema validation", () => {
  it("accepts a record produced by the adapter", () => {
    const result = validateForeverDatabaseRecord(fullRecord());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects a structurally-invalid record with a schema issue", () => {
    const record = fullRecord();
    // Corrupt the project slug so it violates the slug pattern.
    (record.project as { slug: string }).slug = "Not A Slug";
    const result = validateForeverDatabaseRecord(record);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "schema")).toBe(true);
  });
});

describe("duplicate entity detection", () => {
  it("finds repeated natural keys deterministically", () => {
    const media: ForeverMedia[] = [
      {
        id: "1",
        projectId: "p",
        mediaType: "gallery_image",
        title: "",
        url: "u",
        sortOrder: 0,
        isPublic: true,
      },
      {
        id: "2",
        projectId: "p",
        mediaType: "gallery_image",
        title: "",
        url: "u",
        sortOrder: 1,
        isPublic: true,
      },
    ];
    expect(findDuplicateEntities(media, foreverDatabaseEntities.media)).toEqual([
      "p::gallery_image::u",
    ]);
  });

  it("passes for a clean adapter record", () => {
    expect(validateNoDuplicateEntities(fullRecord()).valid).toBe(true);
  });

  it("flags an injected duplicate unit", () => {
    const record = fullRecord();
    record.units.push({ ...record.units[0], id: "unit-dup" });
    const result = validateNoDuplicateEntities(record);
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe("duplicate_entity");
  });
});

describe("referential integrity", () => {
  it("passes for a clean adapter record", () => {
    expect(validateReferentialIntegrity(fullRecord()).valid).toBe(true);
  });

  it("flags a child pointing at the wrong project", () => {
    const record = fullRecord();
    record.units[0].projectId = "other-project";
    const result = validateReferentialIntegrity(record);
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe("orphan_reference");
  });

  it("flags a rental row referencing an unknown unit", () => {
    const record = fullRecord();
    record.rentalInformation.push({
      id: "ghost::rental",
      projectId: record.project.id,
      unitId: "ghost-unit",
    });
    const result = validateReferentialIntegrity(record);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("ghost-unit"))).toBe(true);
  });
});
