import { describe, expect, it } from "vitest";

import {
  appendExtractionHistory,
  emptyExtractionHistory,
  emptyExtractionStats,
  extractionVersion,
  latestExtractionHistoryEntry,
} from "..";

const DEFINITION_ID = "extr_forever-extraction";

describe("extraction history", () => {
  it("starts empty with no latest entry", () => {
    const history = emptyExtractionHistory(DEFINITION_ID);
    expect(history).toEqual({ definitionId: DEFINITION_ID, entries: [] });
    expect(latestExtractionHistoryEntry(history)).toBeUndefined();
  });

  it("appends immutably and supports repeated attempts over the same source", () => {
    const history = emptyExtractionHistory(DEFINITION_ID);
    const first = appendExtractionHistory(history, {
      definitionId: DEFINITION_ID,
      planId: "xplan_proj-coralina-price-list-v1-0-0",
      sourceId: "psrc_coralina-price-list-v1-0-0",
      sourceVersion: extractionVersion(1, 0, 0),
      state: "failed",
      outcome: "failure",
      startedAt: "2026-02-01T00:00:00.000Z",
      stats: emptyExtractionStats(),
    });
    const second = appendExtractionHistory(first, {
      definitionId: DEFINITION_ID,
      planId: "xplan_proj-coralina-price-list-v1-0-0",
      sourceId: "psrc_coralina-price-list-v1-0-0",
      sourceVersion: extractionVersion(1, 0, 0),
      state: "succeeded",
      outcome: "success",
      startedAt: "2026-02-02T00:00:00.000Z",
      stats: emptyExtractionStats(),
    });

    expect(history.entries).toHaveLength(0);
    expect(first.entries).toHaveLength(1);
    expect(second.entries).toHaveLength(2);
    expect(latestExtractionHistoryEntry(second)?.state).toBe("succeeded");
  });

  it("stamps no clock of its own — timestamps only appear when the caller supplies them", () => {
    const entry = {
      definitionId: DEFINITION_ID,
      state: "succeeded" as const,
      outcome: "success" as const,
      stats: emptyExtractionStats(),
    };
    const history = appendExtractionHistory(emptyExtractionHistory(DEFINITION_ID), entry);
    expect(latestExtractionHistoryEntry(history)?.startedAt).toBeUndefined();
    expect(latestExtractionHistoryEntry(history)?.finishedAt).toBeUndefined();
  });
});
