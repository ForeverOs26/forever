import { describe, expect, it } from "vitest";

import {
  FOREVER_PROJECT_FACTORY_ID,
  appendFactoryHistory,
  emptyFactoryHistory,
  emptyFactoryStats,
  latestFactoryHistoryEntry,
} from "..";
import type { FactoryHistoryEntry } from "..";

function makeHistoryEntry(overrides: Partial<FactoryHistoryEntry> = {}): FactoryHistoryEntry {
  return {
    factoryId: FOREVER_PROJECT_FACTORY_ID,
    state: "succeeded",
    outcome: "success",
    stats: { ...emptyFactoryStats(), stages: 4, steps: 8, completed: 8 },
    ...overrides,
  };
}

describe("factory history", () => {
  it("starts empty, with no latest entry", () => {
    const history = emptyFactoryHistory(FOREVER_PROJECT_FACTORY_ID);
    expect(history).toEqual({ factoryId: FOREVER_PROJECT_FACTORY_ID, entries: [] });
    expect(latestFactoryHistoryEntry(history)).toBeUndefined();
  });

  it("appends immutably, preserving order", () => {
    const history = emptyFactoryHistory(FOREVER_PROJECT_FACTORY_ID);
    const first = makeHistoryEntry({ buildId: "build_a" });
    const second = makeHistoryEntry({ buildId: "build_b", state: "failed", outcome: "failure" });

    const once = appendFactoryHistory(history, first);
    const twice = appendFactoryHistory(once, second);

    expect(history.entries).toEqual([]);
    expect(once.entries).toEqual([first]);
    expect(twice.entries).toEqual([first, second]);
  });

  it("reports the most recently appended entry as latest", () => {
    const history = appendFactoryHistory(
      appendFactoryHistory(emptyFactoryHistory(FOREVER_PROJECT_FACTORY_ID), makeHistoryEntry()),
      makeHistoryEntry({ buildId: "build_latest" }),
    );
    expect(latestFactoryHistoryEntry(history)?.buildId).toBe("build_latest");
  });
});
