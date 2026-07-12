import { describe, expect, it } from "vitest";

import {
  addProjectSnapshot,
  describeProjectField,
  describeProjectSnapshot,
  latestProjectSnapshot,
} from "..";
import { makeRecord, makeRevision, makeSnapshot } from "./fixtures";

describe("describeProjectSnapshot", () => {
  it("freezes the record's fields at a revision, deterministically", () => {
    const record = makeRecord();
    const revision = makeRevision();
    const snapshot = describeProjectSnapshot(record, revision, {
      takenAt: "2026-03-01T00:00:00.000Z",
    });
    expect(snapshot.id).toBe("psnap_coralina-r1");
    expect(snapshot.projectId).toBe("proj_coralina");
    expect(snapshot.revisionId).toBe(revision.id);
    expect(snapshot.revisionNumber).toBe(1);
    expect(snapshot.takenAt).toBe("2026-03-01T00:00:00.000Z");
    expect(snapshot.fields).toEqual(record.fields);
    expect(
      describeProjectSnapshot(record, revision, { takenAt: "2026-03-01T00:00:00.000Z" }),
    ).toEqual(snapshot);
  });

  it("never fabricates a taken time", () => {
    expect("takenAt" in describeProjectSnapshot(makeRecord(), makeRevision())).toBe(false);
  });

  it("orders the frozen fields canonically, independent of insertion order", () => {
    const general = describeProjectField({ projectSlug: "coralina", path: "general.name" });
    const pricing = describeProjectField({ projectSlug: "coralina", path: "pricing.basePrice" });
    const record = makeRecord({ fields: [pricing, general] });
    const snapshot = describeProjectSnapshot(record, makeRevision());
    expect(snapshot.fields.map((field) => field.path)).toEqual([
      "general.name",
      "pricing.basePrice",
    ]);
  });

  it("never aliases the living record: mutating the record cannot reach a snapshot", () => {
    const record = makeRecord();
    const snapshot = describeProjectSnapshot(record, makeRevision());
    expect(snapshot.fields[0]).not.toBe(record.fields[0]);
    record.fields[0].values.pop();
    expect(snapshot.fields[0].values).toHaveLength(1);
    snapshot.fields[0].name = "mutated";
    expect(record.fields[0].name).toBe("Base price");
  });
});

describe("snapshot history", () => {
  it("appends immutably and resolves the latest snapshot", () => {
    const record = makeRecord();
    const recordSnapshot = structuredClone(record);
    expect(latestProjectSnapshot(record)).toBeUndefined();
    const grown = addProjectSnapshot(record, makeSnapshot());
    expect(record).toEqual(recordSnapshot);
    expect(grown.snapshots).toHaveLength(1);
    expect(latestProjectSnapshot(grown)).toEqual(makeSnapshot());
  });
});
