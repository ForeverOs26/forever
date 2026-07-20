import { describe, expect, it } from "vitest";

import { buildVersionDiff } from "../update-package";

const fact = <T extends string | number>(value: T, page = 1) => ({
  value,
  source_file: "price-list.pdf",
  page_number: page,
  confidence: "high" as const,
  status: "source_verified" as const,
});

describe("SIP-001B version diff", () => {
  it("uses missing_from_latest_price_list without fabricating an availability outcome", () => {
    const previous = {
      price_list_date: fact("2026-07-03"),
      unit_inventory: [
        { source_row: 1, unit_number: fact("A101"), price: fact(100), price_per_sqm: fact(10) },
        { source_row: 2, unit_number: fact("A102"), price: fact(200), price_per_sqm: fact(20) },
      ],
    };
    const latest = {
      price_list_date: fact("2026-07-17"),
      unit_inventory: [
        { source_row: 1, unit_number: fact("A101"), price: fact(120), price_per_sqm: fact(12) },
        { source_row: 2, unit_number: fact("A103"), price: fact(300), price_per_sqm: fact(30) },
      ],
    };
    const diff = buildVersionDiff(previous, latest);
    expect(diff.units_absent_from_new_available_table).toEqual([
      expect.objectContaining({
        unit_identity: "A102",
        classification: "missing_from_latest_price_list",
      }),
    ]);
    expect(diff.price_changes).toEqual([
      expect.objectContaining({ unit_identity: "A101", absolute_delta: 20, percentage_delta: 20 }),
    ]);
    expect(diff.summary_counts).toMatchObject({ added: 1, missing_from_latest_price_list: 1 });
  });
});
