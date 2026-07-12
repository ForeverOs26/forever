import { describe, expect, it } from "vitest";

import {
  appendProjectHistory,
  describeProjectMerge,
  emptyProjectHistory,
  latestProjectHistoryEntry,
  projectMergeHistoryEntry,
  validateProjectHistory,
  validateProjectHistoryEntry,
} from "..";
import { makeContext, makeHistoryEntry, makeRequest } from "./fixtures";

describe("project history", () => {
  it("starts empty for a project", () => {
    expect(emptyProjectHistory("proj_coralina")).toEqual({
      projectId: "proj_coralina",
      entries: [],
    });
    expect(latestProjectHistoryEntry(emptyProjectHistory("proj_coralina"))).toBeUndefined();
  });

  it("appends immutably and append-only", () => {
    const history = emptyProjectHistory("proj_coralina");
    const first = makeHistoryEntry();
    const second = makeHistoryEntry({
      mergeId: "pmrg_coralina-r3",
      revisionId: "prev_coralina-r3",
    });
    const grown = appendProjectHistory(appendProjectHistory(history, first), second);
    expect(history.entries).toHaveLength(0);
    expect(grown.entries).toEqual([first, second]);
    expect(grown.entries[0]).toBe(first);
    expect(latestProjectHistoryEntry(grown)).toBe(second);
  });

  it("logs described merges through the reused RC4.0 settlement, validating clean", () => {
    const entry = projectMergeHistoryEntry(describeProjectMerge(makeContext(), makeRequest()), {
      startedAt: "2026-07-12T00:00:00.000Z",
      finishedAt: "2026-07-12T00:00:01.000Z",
    });
    expect(entry.projectId).toBe("proj_coralina");
    expect(entry.state).toBe("succeeded");
    expect(entry.outcome).toBe("success");
    const history = appendProjectHistory(emptyProjectHistory("proj_coralina"), entry);
    expect(validateProjectHistory(history)).toEqual([]);
  });

  it("leaves an unresolved project stated blank — flagged by validation, never invented", () => {
    const failed = projectMergeHistoryEntry(describeProjectMerge(null as never, makeRequest()));
    expect(failed.projectId).toBe("");
    expect("mergeId" in failed).toBe(false);
    expect(
      validateProjectHistoryEntry(failed).some((issue) => issue.code === "missing_history_project"),
    ).toBe(true);
  });
});
