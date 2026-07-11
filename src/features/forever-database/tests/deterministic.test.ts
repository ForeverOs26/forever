import { describe, expect, it } from "vitest";

import { projectDetailToForeverRecord } from "../adapters";
import { makeInvestmentRow, makeMediaItem, makeProjectDetail, makeUnit } from "./fixtures";

describe("deterministic mapping", () => {
  it("produces deeply-equal output for identical input", () => {
    const build = () =>
      makeProjectDetail({
        pricing: { startingPriceTHB: 5_000_000 },
        units: [makeUnit({ paymentPlan: "30/70" })],
        media: { gallery: [makeMediaItem()] },
        investment: { rows: [makeInvestmentRow({ expectedMonthlyRent: 30_000 })] },
      });

    const a = projectDetailToForeverRecord(build());
    const b = projectDetailToForeverRecord(build());
    expect(a).toEqual(b);
  });

  it("serializes to a stable JSON snapshot", () => {
    const record = projectDetailToForeverRecord(
      makeProjectDetail({ pricing: { startingPriceTHB: 5_000_000 } }),
    );
    const first = JSON.stringify(record);
    const second = JSON.stringify(
      projectDetailToForeverRecord(makeProjectDetail({ pricing: { startingPriceTHB: 5_000_000 } })),
    );
    expect(first).toBe(second);
  });

  it("does not mutate its input", () => {
    const input = makeProjectDetail({
      units: [makeUnit({ paymentPlan: "50/50" })],
      media: { gallery: [makeMediaItem()] },
    });
    const snapshot = structuredClone(input);
    projectDetailToForeverRecord(input);
    expect(input).toEqual(snapshot);
  });

  it("copies arrays instead of aliasing source arrays", () => {
    const input = makeProjectDetail({ core: { highlights: ["Sea view"] } });
    const record = projectDetailToForeverRecord(input);
    record.project.highlights.push("Injected");
    expect(input.core.highlights).toEqual(["Sea view"]);
  });
});
