import { describe, expect, it } from "vitest";

import {
  SYNC_TERMINAL_STATUSES,
  deriveSyncOutcome,
  deriveSyncStatus,
  isSuccessfulOutcome,
  isTerminalSyncStatus,
  type SyncStatus,
} from "..";
import { makeStats } from "./fixtures";

describe("sync status vocabulary", () => {
  it("classifies terminal versus pre-terminal statuses", () => {
    for (const status of SYNC_TERMINAL_STATUSES) {
      expect(isTerminalSyncStatus(status)).toBe(true);
    }
    const preTerminal: SyncStatus[] = ["idle", "pending", "running"];
    for (const status of preTerminal) {
      expect(isTerminalSyncStatus(status)).toBe(false);
    }
  });

  it("treats success and noop as successful outcomes", () => {
    expect(isSuccessfulOutcome("success")).toBe(true);
    expect(isSuccessfulOutcome("noop")).toBe(true);
    expect(isSuccessfulOutcome("partial")).toBe(false);
    expect(isSuccessfulOutcome("failure")).toBe(false);
  });
});

describe("deriveSyncOutcome", () => {
  it("is noop when nothing synced and nothing failed", () => {
    expect(deriveSyncOutcome(makeStats())).toBe("noop");
  });

  it("is success when records synced without errors", () => {
    expect(deriveSyncOutcome(makeStats({ total: 2, synced: 2 }))).toBe("success");
  });

  it("is partial when some synced and some failed", () => {
    expect(deriveSyncOutcome(makeStats({ total: 2, synced: 1, failed: 1, errors: 1 }))).toBe(
      "partial",
    );
  });

  it("is failure when everything failed", () => {
    expect(deriveSyncOutcome(makeStats({ total: 2, failed: 2, errors: 1 }))).toBe("failure");
  });
});

describe("deriveSyncStatus", () => {
  it("maps each outcome to its terminal status", () => {
    expect(deriveSyncStatus(makeStats({ synced: 1 }))).toBe("succeeded");
    expect(deriveSyncStatus(makeStats({ synced: 1, failed: 1, errors: 1 }))).toBe("partial");
    expect(deriveSyncStatus(makeStats({ failed: 1, errors: 1 }))).toBe("failed");
    expect(deriveSyncStatus(makeStats())).toBe("skipped");
  });
});
