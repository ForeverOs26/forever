import { describe, expect, it } from "vitest";

import {
  describeProjectField,
  distinctProjectSections,
  distinctProjectSourceRefs,
  findProjectField,
  groupProjectFieldsBySection,
  latestProjectRevision,
  listCurrentProjectFields,
  listProjectFieldsBySection,
  listUnsettledProjectFields,
  nextProjectRevisionNumber,
  projectFieldCount,
  projectFieldKey,
  projectRecordIdentityKey,
  projectRecordKey,
  projectRevisionCount,
  projectSnapshotCount,
  sortProjectFields,
  sortProjectRevisions,
  sortProjectSnapshots,
} from "..";
import {
  OTHER_SOURCE_ID,
  SOURCE_ID,
  makeField,
  makeRecord,
  makeRevision,
  makeSnapshot,
  makeValue,
} from "./fixtures";

function fieldAt(path: string, overrides: Parameters<typeof makeField>[0] = {}) {
  return makeField({ ...describeProjectField({ projectSlug: "coralina", path }), ...overrides });
}

describe("natural keys and counters", () => {
  it("keys records by slug and fields by canonical path", () => {
    const record = makeRecord();
    expect(projectRecordKey(record)).toBe("coralina");
    expect(projectRecordIdentityKey(record.identity)).toBe("coralina");
    expect(projectFieldKey(makeField())).toBe("pricing.basePrice");
  });

  it("counts fields, revisions, and snapshots", () => {
    const record = makeRecord({ snapshots: [makeSnapshot()] });
    expect(projectFieldCount(record)).toBe(1);
    expect(projectRevisionCount(record)).toBe(1);
    expect(projectSnapshotCount(record)).toBe(1);
  });
});

describe("field lookups and grouping", () => {
  it("finds a field by path", () => {
    const record = makeRecord();
    expect(findProjectField(record, "pricing.basePrice")?.id).toBe(
      "pfld_coralina-pricing-baseprice",
    );
    expect(findProjectField(record, "pricing.other")).toBeUndefined();
  });

  it("filters by section, standing, and unsettledness in input order", () => {
    const settled = fieldAt("pricing.basePrice", { values: [makeValue()] });
    const unsettled = fieldAt("general.name", { values: [] });
    const removed = fieldAt("legal.ownership", {
      values: [makeValue({ status: "removed", rawValue: undefined, structuredValue: undefined })],
    });
    const fields = [settled, unsettled, removed];
    expect(listProjectFieldsBySection(fields, "pricing")).toEqual([settled]);
    expect(listCurrentProjectFields(fields)).toEqual([settled]);
    expect(listUnsettledProjectFields(fields)).toEqual([unsettled, removed]);
  });

  it("collects distinct sections in canonical order and groups fields by section", () => {
    const fields = [fieldAt("pricing.basePrice"), fieldAt("general.name"), fieldAt("pricing.fees")];
    expect(distinctProjectSections(fields)).toEqual(["general", "pricing"]);
    const groups = groupProjectFieldsBySection(fields);
    expect(groups.map((group) => group.section)).toEqual(["general", "pricing"]);
    expect(groups[1].fields.map(projectFieldKey)).toEqual(["pricing.basePrice", "pricing.fees"]);
  });

  it("collects the distinct sources a record traces to, in first-seen order", () => {
    const field = makeField({
      values: [makeValue(), makeValue({ sourceIds: [OTHER_SOURCE_ID] })],
    });
    const record = makeRecord({ fields: [field] });
    expect(distinctProjectSourceRefs(record)).toEqual([SOURCE_ID, OTHER_SOURCE_ID]);
  });
});

describe("deterministic ordering", () => {
  it("sorts fields by canonical section rank, then path, then id — stably, immutably", () => {
    const input = [
      fieldAt("pricing.fees"),
      fieldAt("general.name"),
      fieldAt("pricing.basePrice"),
      fieldAt("unclassified.x"),
    ];
    const snapshot = structuredClone(input);
    const sorted = sortProjectFields(input);
    expect(sorted.map(projectFieldKey)).toEqual([
      "general.name",
      "pricing.basePrice",
      "pricing.fees",
      "unclassified.x",
    ]);
    expect(input).toEqual(snapshot);
  });

  it("sorts revisions by number and snapshots by frozen revision", () => {
    const r1 = makeRevision();
    const r2 = makeRevision({ id: "prev_coralina-r2", number: 2, basedOn: r1.id });
    expect(sortProjectRevisions([r2, r1]).map((revision) => revision.number)).toEqual([1, 2]);

    const s1 = makeSnapshot();
    const s2 = makeSnapshot({ id: "psnap_coralina-r2", revisionId: r2.id, revisionNumber: 2 });
    expect(sortProjectSnapshots([s2, s1]).map((snapshot) => snapshot.revisionNumber)).toEqual([
      1, 2,
    ]);
  });

  it("resolves the latest revision and the next sequence number", () => {
    const r1 = makeRevision();
    const r2 = makeRevision({ id: "prev_coralina-r2", number: 2, basedOn: r1.id });
    const record = makeRecord({ revisions: [r1, r2] });
    expect(latestProjectRevision(record)?.number).toBe(2);
    expect(nextProjectRevisionNumber(record)).toBe(3);
    expect(nextProjectRevisionNumber(makeRecord({ revisions: [] }))).toBe(1);
  });
});
