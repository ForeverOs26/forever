import { describe, expect, it } from "vitest";

import {
  PROJECT_SOURCE_STATUSES,
  PROJECT_SOURCE_TERMINAL_STATUSES,
  isCurrentProjectSourceStatus,
  isKnownProjectSourceStatus,
  isTerminalProjectSourceStatus,
} from "..";

describe("source status", () => {
  it("declares the standing vocabulary in a stable order", () => {
    expect(PROJECT_SOURCE_STATUSES).toEqual([
      "registered",
      "pending_review",
      "verified",
      "superseded",
      "archived",
      "rejected",
    ]);
    expect(PROJECT_SOURCE_TERMINAL_STATUSES).toEqual(["superseded", "archived", "rejected"]);
  });

  it("partitions every status into exactly current or terminal", () => {
    for (const status of PROJECT_SOURCE_STATUSES) {
      expect(isCurrentProjectSourceStatus(status)).toBe(!isTerminalProjectSourceStatus(status));
    }
    expect(isCurrentProjectSourceStatus("verified")).toBe(true);
    expect(isTerminalProjectSourceStatus("superseded")).toBe(true);
  });

  it("guards unknown values", () => {
    expect(isKnownProjectSourceStatus("verified")).toBe(true);
    expect(isKnownProjectSourceStatus("published")).toBe(false);
    expect(isKnownProjectSourceStatus(null)).toBe(false);
  });
});
