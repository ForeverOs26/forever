import { describe, expect, it } from "vitest";

import { buildReviewSummary, canFinalize } from "../review";
import type { ReviewItem } from "../types";

function item(overrides: Partial<ReviewItem>): ReviewItem {
  return {
    id: "REVIEW-0001",
    reasonCode: "medium_confidence_cell",
    candidateValue: "x",
    rawText: "raw",
    sourceRef: { source_file: "f.pdf", page_number: 1 },
    page: 1,
    table: 0,
    row: 1,
    column: "unit_type",
    recommendedAction: "unresolved",
    allowedActions: ["accept", "edit", "unresolved"],
    blocking: false,
    ...overrides,
  };
}

describe("SIP-001A exception-only review summary", () => {
  it("finalizes when there are no blocking items, even with non-blocking review items", () => {
    const summary = buildReviewSummary("rainpalm-villas", [item({})]);
    expect(summary.review_required_count).toBe(1);
    expect(summary.blocking_issue_count).toBe(0);
    expect(canFinalize(summary)).toBe(true);
  });

  it("never finalizes when a blocking duplicate-identity item is present", () => {
    const summary = buildReviewSummary("rainpalm-villas", [
      item({ reasonCode: "duplicate_identity", blocking: true }),
    ]);
    expect(summary.blocking_issue_count).toBe(1);
    expect(canFinalize(summary)).toBe(false);
  });

  it("carries every field needed for an Owner review decision", () => {
    const summary = buildReviewSummary("rainpalm-villas", [item({})]);
    const only = summary.items[0];
    expect(only.id).toBeTruthy();
    expect(only.reasonCode).toBeTruthy();
    expect(only.sourceRef.source_file).toBeTruthy();
    expect(only.allowedActions.length).toBeGreaterThan(0);
  });
});
