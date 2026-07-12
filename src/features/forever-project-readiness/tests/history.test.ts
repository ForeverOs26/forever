import { describe, expect, it } from "vitest";

import {
  appendReadinessHistory,
  emptyReadinessHistory,
  latestReadinessHistoryEntry,
  readinessHistoryEntry,
  validateReadinessHistory,
} from "..";
import { runReadiness } from "./fixtures";

describe("history", () => {
  it("derives an entry from a described examination, copying — never aliasing — the counters", () => {
    const result = runReadiness();
    const entry = readinessHistoryEntry(result, {
      startedAt: "2026-07-12T00:00:00.000Z",
      finishedAt: "2026-07-12T00:00:01.000Z",
    });
    expect(entry.projectId).toBe("proj_coralina");
    expect(entry.reportId).toBe("rrep_coralina");
    expect(entry.state).toBe(result.state);
    expect(entry.stats).toEqual(result.stats);
    entry.stats.completed = 99;
    expect(result.stats.completed).not.toBe(99);
  });

  it("a failed description yields an entry with a stated blank the validator flags", () => {
    const failed = runReadiness({}, { projectSlug: "" });
    const entry = readinessHistoryEntry(failed);
    expect(entry.projectId).toBe("");
    expect(entry.reportId).toBeUndefined();
    const history = appendReadinessHistory(emptyReadinessHistory("proj_coralina"), entry);
    expect(
      validateReadinessHistory(history).some((issue) => issue.code === "missing_history_project"),
    ).toBe(true);
  });

  it("is append-only and immutable", () => {
    const history = emptyReadinessHistory("proj_coralina");
    const entry = readinessHistoryEntry(runReadiness());
    const appended = appendReadinessHistory(history, entry);
    expect(history.entries).toEqual([]);
    expect(appended.entries).toEqual([entry]);
    expect(latestReadinessHistoryEntry(history)).toBeUndefined();
    expect(latestReadinessHistoryEntry(appended)).toBe(entry);
  });

  it("a coherent history passes validation; a foreign entry does not", () => {
    const entry = readinessHistoryEntry(runReadiness());
    const history = appendReadinessHistory(emptyReadinessHistory("proj_coralina"), entry);
    expect(validateReadinessHistory(history)).toEqual([]);
    const foreign = appendReadinessHistory(emptyReadinessHistory("proj_other"), entry);
    expect(
      validateReadinessHistory(foreign).some((issue) => issue.code === "history_project_mismatch"),
    ).toBe(true);
  });
});
