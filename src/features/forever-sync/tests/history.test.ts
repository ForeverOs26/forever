import { describe, expect, it } from "vitest";

import {
  appendSyncHistory,
  emptySyncHistory,
  latestSyncHistoryEntry,
  type SyncHistoryEntry,
} from "..";
import { makeStats } from "./fixtures";

function makeEntry(overrides: Partial<SyncHistoryEntry> = {}): SyncHistoryEntry {
  return {
    jobId: "job-1",
    status: "succeeded",
    outcome: "success",
    stats: makeStats({ total: 1, synced: 1 }),
    ...overrides,
  };
}

describe("sync history", () => {
  it("starts empty", () => {
    const history = emptySyncHistory("job-1");
    expect(history.entries).toEqual([]);
    expect(latestSyncHistoryEntry(history)).toBeUndefined();
  });

  it("appends immutably and returns the latest entry", () => {
    const start = emptySyncHistory("job-1");
    const first = appendSyncHistory(start, makeEntry({ status: "succeeded" }));
    const second = appendSyncHistory(first, makeEntry({ status: "failed", outcome: "failure" }));

    expect(start.entries).toHaveLength(0);
    expect(first.entries).toHaveLength(1);
    expect(second.entries).toHaveLength(2);
    expect(latestSyncHistoryEntry(second)?.status).toBe("failed");
  });

  it("never mutates the input history", () => {
    const start = emptySyncHistory("job-1");
    const snapshot = structuredClone(start);
    appendSyncHistory(start, makeEntry());
    expect(start).toEqual(snapshot);
  });
});
