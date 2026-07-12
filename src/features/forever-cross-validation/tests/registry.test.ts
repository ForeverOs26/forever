import { describe, expect, it } from "vitest";

import {
  CrossValidationRegistry,
  addCrossValidationCatalogEntry,
  appendCrossValidationHistory,
  crossValidationHistoryEntry,
  crossValidationProviderFindingCount,
  crossValidationProviderProjectId,
  crossValidationProviderRequiresReview,
  crossValidationProviderSubjectCount,
  defineCrossValidationProvider,
  emptyCrossValidationCatalog,
  emptyCrossValidationHistory,
  findCrossValidationCatalogEntry,
  latestCrossValidationHistoryEntry,
  listCrossValidationCatalogEntriesForProject,
  listEnabledCrossValidationCatalogEntries,
} from "..";
import { makeConflictingFact, makeFact, makeReport, runValidation } from "./fixtures";

describe("CrossValidationRegistry", () => {
  it("registers, resolves, and lists deterministically, clashing on duplicates", () => {
    const registry = new CrossValidationRegistry();
    const clean = makeReport();
    const contested = runValidation(
      {},
      { batch: "contested", facts: [makeFact(), makeConflictingFact()] },
    ).data[0];
    registry.register(clean).register(contested);

    expect(registry.has("xrep_coralina")).toBe(true);
    expect(registry.resolve("xrep_coralina-contested")).toBe(contested);
    expect(registry.list()).toEqual([clean, contested]);
    expect(registry.listByProject("proj_coralina")).toHaveLength(2);
    expect(registry.listByProject("proj_other")).toEqual([]);
    expect(registry.listByFindingKind("conflict")).toEqual([contested]);
    expect(registry.listRequiringReview()).toEqual([contested]);
    expect(() => registry.register(clean)).toThrow(/already registered/);
  });
});

describe("catalogue model", () => {
  it("builds immutably and looks up by report and project", () => {
    const catalog = emptyCrossValidationCatalog("forever-cross-validation", "Forever");
    const entry = { report: makeReport(), enabled: true };
    const disabled = {
      report: runValidation({}, { batch: "b2" }).data[0],
      enabled: false,
    };
    const grown = addCrossValidationCatalogEntry(
      addCrossValidationCatalogEntry(catalog, entry),
      disabled,
    );
    expect(catalog.entries).toEqual([]);
    expect(grown.entries).toHaveLength(2);
    expect(findCrossValidationCatalogEntry(grown, "xrep_coralina")).toBe(entry);
    expect(findCrossValidationCatalogEntry(grown, "xrep_missing")).toBeUndefined();
    expect(listEnabledCrossValidationCatalogEntries(grown)).toEqual([entry]);
    expect(listCrossValidationCatalogEntriesForProject(grown, "proj_coralina")).toHaveLength(2);
  });
});

describe("history model", () => {
  it("appends immutably and derives entries from results without inventing", () => {
    const result = runValidation();
    const entry = crossValidationHistoryEntry(result);
    expect(entry.projectId).toBe("proj_coralina");
    expect(entry.reportId).toBe("xrep_coralina");
    expect(entry.state).toBe("succeeded");
    expect(entry.startedAt).toBeUndefined();
    expect(entry.stats).toEqual(result.stats);
    expect(entry.stats).not.toBe(result.stats);

    const history = emptyCrossValidationHistory("proj_coralina");
    const grown = appendCrossValidationHistory(history, entry);
    expect(history.entries).toEqual([]);
    expect(latestCrossValidationHistoryEntry(grown)).toBe(entry);
    expect(latestCrossValidationHistoryEntry(history)).toBeUndefined();
  });

  it("states a blank project for an unresolved examination instead of inventing one", () => {
    const failed = runValidation({}, { projectSlug: "" as never });
    const entry = crossValidationHistoryEntry(failed);
    expect(entry.projectId).toBe("");
    expect(entry.reportId).toBeUndefined();
  });
});

describe("provider contract", () => {
  it("pins implementations and reads through to the report", () => {
    const report = runValidation({}, { facts: [makeFact(), makeConflictingFact()] }).data[0];
    const provider = defineCrossValidationProvider({ report });
    expect(crossValidationProviderProjectId(provider)).toBe("proj_coralina");
    expect(crossValidationProviderFindingCount(provider)).toBe(report.findings.length);
    expect(crossValidationProviderSubjectCount(provider)).toBe(1);
    expect(crossValidationProviderRequiresReview(provider)).toBe(true);
    expect(
      crossValidationProviderRequiresReview(
        defineCrossValidationProvider({ report: makeReport() }),
      ),
    ).toBe(false);
  });
});
