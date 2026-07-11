import { describe, expect, it } from "vitest";

import {
  emptySyncStats,
  isNonEmptyString,
  isSameEndpoint,
  mergeSyncStats,
  sumSyncStats,
  syncEndpointKey,
  syncJobKey,
  syncPairKey,
} from "..";
import { makeJob, makeSource, makeStats, makeTarget } from "./fixtures";

describe("isNonEmptyString", () => {
  it("accepts only non-empty, non-whitespace strings", () => {
    expect(isNonEmptyString("x")).toBe(true);
    expect(isNonEmptyString("  ")).toBe(false);
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(5)).toBe(false);
  });
});

describe("key builders", () => {
  it("builds a stable endpoint key", () => {
    expect(syncEndpointKey(makeSource())).toBe("forever_database:memory:forever-db-projects");
  });

  it("builds a stable source→target pair key", () => {
    expect(syncPairKey(makeSource(), makeTarget())).toBe("forever_database->website");
  });

  it("builds a job key independent of the surrogate id", () => {
    const a = makeJob({ id: "job-a" });
    const b = makeJob({ id: "job-b" });
    expect(syncJobKey(a)).toBe("forever_database->website:project:push");
    expect(syncJobKey(a)).toBe(syncJobKey(b));
  });

  it("compares endpoints by id", () => {
    expect(isSameEndpoint(makeSource(), makeSource())).toBe(true);
    expect(isSameEndpoint(makeSource(), makeTarget())).toBe(false);
  });
});

describe("stat combiners", () => {
  it("merges two stat counters field-by-field", () => {
    const merged = mergeSyncStats(
      makeStats({ total: 1, synced: 1 }),
      makeStats({ total: 2, failed: 1, errors: 1 }),
    );
    expect(merged).toEqual({
      total: 3,
      synced: 1,
      skipped: 0,
      failed: 1,
      conflicts: 0,
      warnings: 0,
      errors: 1,
    });
  });

  it("sums a list starting from empty stats", () => {
    expect(sumSyncStats([])).toEqual(emptySyncStats());
    expect(sumSyncStats([makeStats({ synced: 2 }), makeStats({ synced: 3 })]).synced).toBe(5);
  });
});
