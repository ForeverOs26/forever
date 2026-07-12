import { describe, expect, it } from "vitest";

import {
  appendProjectSourceHistory,
  emptyProjectSourceHistory,
  latestProjectSourceHistoryEntry,
  projectSourceVersion,
} from "..";

const SOURCE_ID = "psrc_coralina-price-list-v1-0-0";

describe("source history", () => {
  it("starts empty with no latest entry", () => {
    const history = emptyProjectSourceHistory(SOURCE_ID);
    expect(history).toEqual({ sourceId: SOURCE_ID, entries: [] });
    expect(latestProjectSourceHistoryEntry(history)).toBeUndefined();
  });

  it("appends immutably and reports the latest standing", () => {
    const history = emptyProjectSourceHistory(SOURCE_ID);
    const registered = appendProjectSourceHistory(history, {
      sourceId: SOURCE_ID,
      status: "registered",
      version: projectSourceVersion(1, 0, 0),
      at: "2026-01-01T00:00:00.000Z",
    });
    const verified = appendProjectSourceHistory(registered, {
      sourceId: SOURCE_ID,
      status: "verified",
      at: "2026-01-02T00:00:00.000Z",
      notes: "checked against the developer portal",
    });

    expect(history.entries).toHaveLength(0);
    expect(registered.entries).toHaveLength(1);
    expect(verified.entries).toHaveLength(2);
    expect(latestProjectSourceHistoryEntry(verified)?.status).toBe("verified");
  });

  it("stamps no clock of its own — timestamps only appear when the caller supplies them", () => {
    const entry = { sourceId: SOURCE_ID, status: "registered" as const };
    const history = appendProjectSourceHistory(emptyProjectSourceHistory(SOURCE_ID), entry);
    expect(latestProjectSourceHistoryEntry(history)?.at).toBeUndefined();
  });
});
