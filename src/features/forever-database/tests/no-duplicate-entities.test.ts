import { describe, expect, it } from "vitest";

import { projectDetailToForeverRecord } from "../adapters";
import { foreverDatabaseEntities, validateNoDuplicateEntities } from "../domain";
import { makeInvestmentRow, makeMediaItem, makeProjectDetail, makeUnit } from "./fixtures";

/**
 * The canonical database must never emit two records for the same real-world
 * entity. These tests assert the adapter output is duplicate-free even for a
 * rich project, and that every emitted id and natural key is unique.
 */

function richRecord() {
  return projectDetailToForeverRecord(
    makeProjectDetail({
      units: [
        makeUnit({ id: "unit-1", code: "A-101", paymentPlan: "30/70" }),
        makeUnit({ id: "unit-2", code: "A-102", paymentPlan: "50/50" }),
      ],
      media: {
        hero: makeMediaItem({ id: "hero", type: "cover", url: "https://x/hero.jpg" }),
        gallery: [
          makeMediaItem({ id: "g1", url: "https://x/g1.jpg" }),
          makeMediaItem({ id: "g2", url: "https://x/g2.jpg" }),
        ],
        brochures: [makeMediaItem({ id: "b1", type: "brochure", url: "https://x/b.pdf" })],
      },
      investment: {
        investmentValue: 6_000_000,
        rentalYield: "7%",
        rows: [
          makeInvestmentRow({
            id: "inv-1",
            unitId: "unit-1",
            expectedMonthlyRent: 30_000,
            annualRoiPercent: 7,
          }),
          makeInvestmentRow({
            id: "inv-2",
            unitId: "unit-2",
            expectedMonthlyRent: 32_000,
            annualRoiPercent: 8,
          }),
        ],
      },
    }),
  );
}

describe("no duplicated entities", () => {
  it("produces a duplicate-free record for a rich project", () => {
    expect(validateNoDuplicateEntities(richRecord()).valid).toBe(true);
  });

  it("emits unique ids across every collection", () => {
    const record = richRecord();
    const ids = [
      record.project.id,
      ...(record.developer ? [record.developer.id] : []),
      ...(record.location ? [record.location.id] : []),
      ...record.units.map((u) => u.id),
      ...record.media.map((m) => m.id),
      ...record.documents.map((d) => d.id),
      ...record.paymentPlans.map((p) => p.id),
      ...record.constructionProgress.map((c) => c.id),
      ...record.rentalInformation.map((r) => r.id),
      ...record.investmentInformation.map((i) => i.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emits unique natural keys within each keyed collection", () => {
    const record = richRecord();
    const unitKeys = record.units.map((u) => foreverDatabaseEntities.unit.naturalKey(u));
    const mediaKeys = record.media.map((m) => foreverDatabaseEntities.media.naturalKey(m));
    expect(new Set(unitKeys).size).toBe(unitKeys.length);
    expect(new Set(mediaKeys).size).toBe(mediaKeys.length);
  });
});
