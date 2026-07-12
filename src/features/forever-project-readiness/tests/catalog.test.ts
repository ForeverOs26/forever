import { describe, expect, it } from "vitest";

import {
  addReadinessCatalogEntry,
  emptyReadinessCatalog,
  findReadinessCatalogEntry,
  listEnabledReadinessCatalogEntries,
  listReadinessCatalogEntriesForProject,
  validateReadinessCatalog,
} from "..";
import { makeReadinessReport } from "./fixtures";

describe("catalog", () => {
  it("builds immutably and looks up by report id and project", () => {
    const report = makeReadinessReport();
    const empty = emptyReadinessCatalog("readiness", "Readiness reports");
    const catalog = addReadinessCatalogEntry(empty, {
      report,
      enabled: true,
      registeredAt: "2026-07-12T00:00:00.000Z",
    });
    expect(empty.entries).toEqual([]);
    expect(findReadinessCatalogEntry(catalog, report.id)?.report).toBe(report);
    expect(findReadinessCatalogEntry(catalog, "rrep_other")).toBeUndefined();
    expect(listEnabledReadinessCatalogEntries(catalog)).toHaveLength(1);
    expect(listReadinessCatalogEntriesForProject(catalog, "proj_coralina")).toHaveLength(1);
    expect(listReadinessCatalogEntriesForProject(catalog, "proj_other")).toEqual([]);
  });

  it("a coherent catalogue passes validation", () => {
    const catalog = addReadinessCatalogEntry(emptyReadinessCatalog("readiness"), {
      report: makeReadinessReport(),
      enabled: true,
    });
    expect(validateReadinessCatalog(catalog)).toEqual([]);
  });

  it("flags duplicate report registrations and incoherent entries", () => {
    const report = makeReadinessReport();
    let catalog = emptyReadinessCatalog("readiness");
    catalog = addReadinessCatalogEntry(catalog, { report, enabled: true });
    catalog = addReadinessCatalogEntry(catalog, { report, enabled: "yes" as unknown as boolean });
    const codes = validateReadinessCatalog(catalog).map((issue) => issue.code);
    expect(codes).toContain("duplicate_report_id");
    expect(codes).toContain("invalid_entry_enabled");
  });
});
