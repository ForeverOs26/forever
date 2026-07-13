import { describe, expect, it } from "vitest";

import { describeCoralinaKnowledgeInspection, getCoralinaKnowledgeInspection } from "../inspection";
import { buildCoralinaKnowledgeSlice } from "../slice";

const slice = buildCoralinaKnowledgeSlice();
const inspection = describeCoralinaKnowledgeInspection(slice);

describe("Coralina knowledge inspection view-model", () => {
  it("summarises all six chain stages as ok", () => {
    expect(inspection.chain.map((stage) => stage.rc)).toEqual([
      "RC4.4",
      "RC4.5",
      "RC4.7",
      "RC4.6",
      "RC4.8",
      "RC4.9",
    ]);
    expect(inspection.chain.every((stage) => stage.ok)).toBe(true);
  });

  it("derives the project name from the canonical record, not a constant", () => {
    expect(inspection.projectName).toBe("The Title Coralina Kamala");
    expect(inspection.projectId).toBe("proj_coralina");
  });

  it("renders one row per source, fact, and canonical field", () => {
    expect(inspection.sources).toHaveLength(slice.sources.definitions.length);
    expect(inspection.facts).toHaveLength(slice.extraction.facts.length);
    expect(inspection.fields).toHaveLength(slice.canonical.record.fields.length);
  });

  it("shows the corroborated field with both supporting sources", () => {
    const buildings = inspection.fields.find((field) => field.path === "units.buildings");
    expect(buildings?.consensus).toBe("corroborated");
    expect(buildings?.standing).toBe("corroborated");
    expect(buildings?.supportingSourceIds).toHaveLength(2);
  });

  it("shows single-source fields as unverified, never as corroborated", () => {
    const name = inspection.fields.find((field) => field.path === "general.name");
    expect(name?.consensus).toBe("uncorroborated");
    expect(name?.standing).toBe("unverified");
  });

  it("keeps the dispute visible with both verbatim claims", () => {
    expect(inspection.disputes).toHaveLength(1);
    const dispute = inspection.disputes[0]!;
    expect(dispute.fieldPath).toBe("units.unitTypes");
    expect(dispute.claims).toHaveLength(2);
    const displays = dispute.claims.map((claim) => claim.display);
    expect(displays.some((display) => display.includes("PH-3 BEDROOM"))).toBe(true);
    expect(displays.some((display) => display.includes("1 Bedroom S"))).toBe(true);
  });

  it("lists the four remaining missing paths, each tied to a real finding", () => {
    expect(inspection.missing).toHaveLength(4);
    for (const row of inspection.missing) {
      expect(row.findingIds.length).toBeGreaterThan(0);
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });

  it("summarises readiness as ready with no blockers", () => {
    expect(inspection.readiness.standing).toBe("ready");
    expect(inspection.readiness.blockers).toEqual([]);
    expect(inspection.readiness.evaluations.length).toBe(slice.readiness.report.evaluations.length);
  });

  it("is fully JSON-serialisable (safe for the route loader)", () => {
    const roundTripped = JSON.parse(JSON.stringify(inspection));
    expect(roundTripped).toEqual(inspection);
  });

  it("returns equal but independent snapshots from the app-facing accessor", () => {
    const first = getCoralinaKnowledgeInspection();
    const second = getCoralinaKnowledgeInspection();
    expect(second).toEqual(first);
    expect(first).toEqual(inspection);
    // Independent copies: mutating one caller's data cannot poison the cache.
    expect(second).not.toBe(first);
    first.facts.pop();
    expect(getCoralinaKnowledgeInspection()).toEqual(second);
  });
});
