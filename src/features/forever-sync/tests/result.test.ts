import { describe, expect, it } from "vitest";

import {
  createSyncResult,
  emptySyncStats,
  partitionSyncIssues,
  syncError,
  syncWarning,
  type SyncIssue,
} from "..";
import { makeMetadata } from "./fixtures";

describe("issue constructors", () => {
  it("omits path when none is given, includes it otherwise", () => {
    expect(syncError("c", "m")).toEqual({ code: "c", message: "m", severity: "error" });
    expect(syncWarning("c", "m", "a.b")).toEqual({
      code: "c",
      message: "m",
      path: "a.b",
      severity: "warning",
    });
  });
});

describe("partitionSyncIssues", () => {
  it("splits errors and warnings while preserving order", () => {
    const issues: SyncIssue[] = [
      syncError("e1", "first error"),
      syncWarning("w1", "first warning"),
      syncError("e2", "second error"),
    ];
    const { errors, warnings } = partitionSyncIssues(issues);
    expect(errors.map((e) => e.code)).toEqual(["e1", "e2"]);
    expect(warnings.map((w) => w.code)).toEqual(["w1"]);
  });
});

describe("createSyncResult", () => {
  it("recomputes counts and derives ok/status/outcome from stats", () => {
    const result = createSyncResult({
      data: [1, 2],
      issues: [syncWarning("w", "note")],
      stats: { ...emptySyncStats(), total: 2, synced: 2 },
      metadata: makeMetadata({ recordCount: 2 }),
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("succeeded");
    expect(result.outcome).toBe("success");
    expect(result.stats.warnings).toBe(1);
    expect(result.stats.errors).toBe(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("is not ok and reports a failed status when a blocking error is present", () => {
    const result = createSyncResult({
      data: [],
      issues: [syncError("boom", "blocked")],
      stats: { ...emptySyncStats(), total: 1, failed: 1 },
      metadata: makeMetadata(),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.outcome).toBe("failure");
    expect(result.stats.errors).toBe(1);
  });
});
