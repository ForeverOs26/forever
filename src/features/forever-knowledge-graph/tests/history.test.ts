import { describe, expect, it } from "vitest";

import {
  appendKnowledgeGraphHistory,
  emptyKnowledgeGraphHistory,
  knowledgeGraphHistoryEntry,
  latestKnowledgeGraphHistoryEntry,
  validateKnowledgeGraphHistory,
} from "..";
import { NOW, runGraph } from "./fixtures";

describe("knowledge-graph history", () => {
  it("starts empty and appends immutably", () => {
    const history = emptyKnowledgeGraphHistory("proj_coralina");
    expect(history).toEqual({ projectId: "proj_coralina", entries: [] });
    expect(latestKnowledgeGraphHistoryEntry(history)).toBeUndefined();

    const entry = knowledgeGraphHistoryEntry(runGraph(), { startedAt: NOW, finishedAt: NOW });
    const grown = appendKnowledgeGraphHistory(history, entry);
    expect(history.entries).toHaveLength(0);
    expect(grown.entries).toHaveLength(1);
    expect(latestKnowledgeGraphHistoryEntry(grown)).toBe(entry);
  });

  it("derives entries from results without inventing anything", () => {
    const result = runGraph();
    const entry = knowledgeGraphHistoryEntry(result);
    expect(entry.projectId).toBe("proj_coralina");
    expect(entry.graphId).toBe("kgr_coralina");
    expect(entry.state).toBe(result.state);
    expect(entry.outcome).toBe(result.outcome);
    expect(entry.stats).toEqual(result.stats);
    expect(entry.stats).not.toBe(result.stats);
    expect(Object.keys(entry)).not.toContain("startedAt");
    expect(Object.keys(entry)).not.toContain("finishedAt");
  });

  it("leaves an unresolved project as a stated blank the validator flags", () => {
    const failed = runGraph({}, { projectSlug: "" });
    const entry = knowledgeGraphHistoryEntry(failed);
    expect(entry.projectId).toBe("");
    expect(entry.graphId).toBeUndefined();
    const history = appendKnowledgeGraphHistory(emptyKnowledgeGraphHistory(""), entry);
    const codes = validateKnowledgeGraphHistory(history).map((issue) => issue.code);
    expect(codes).toContain("missing_history_project");
  });

  it("validates a coherent history cleanly and flags foreign entries", () => {
    const entry = knowledgeGraphHistoryEntry(runGraph(), { startedAt: NOW });
    const history = appendKnowledgeGraphHistory(emptyKnowledgeGraphHistory("proj_coralina"), entry);
    expect(validateKnowledgeGraphHistory(history)).toEqual([]);

    const foreign = appendKnowledgeGraphHistory(history, { ...entry, projectId: "proj_other" });
    const codes = validateKnowledgeGraphHistory(foreign).map((issue) => issue.code);
    expect(codes).toContain("history_project_mismatch");
  });
});
