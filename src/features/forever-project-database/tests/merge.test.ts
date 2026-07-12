import { describe, expect, it } from "vitest";

import {
  PROJECT_MERGE_ENTRY_KINDS,
  currentProjectFieldValue,
  describeProjectMerge,
  isKnownProjectMergeEntryKind,
  listProjectMergeEntries,
  projectMergeHistoryEntry,
  validateProjectMerge,
} from "..";
import { OTHER_SOURCE_ID, makeContext, makeFact, makeRecord, makeRequest } from "./fixtures";

/** An incoming re-reading of the base price from the same catalogued source. */
function samePriceFact() {
  return makeFact();
}

/** A newer, disagreeing reading from the same source's next received revision. */
function newerPriceFact() {
  return makeFact({
    sourceVersion: { major: 1, minor: 1, patch: 0 },
    rawValue: "THB 4,700,000",
    structuredValue: { amount: 4700000, currency: "THB" },
  });
}

/** A stated absence from the same source: the price is no longer listed. */
function goneFact() {
  return makeFact({
    sourceVersion: { major: 1, minor: 2, patch: 0 },
    rawValue: undefined,
    structuredValue: undefined,
    status: "unavailable",
  });
}

/** A disagreeing reading from a different catalogued source. */
function brochureFact() {
  return makeFact({
    factSlug: "price-1br-brochure",
    sourceId: OTHER_SOURCE_ID,
    rawValue: "THB 4,850,000",
    structuredValue: { amount: 4850000, currency: "THB" },
  });
}

describe("merge classification", () => {
  it("declares the six entry kinds and guards them", () => {
    expect(PROJECT_MERGE_ENTRY_KINDS).toEqual([
      "added",
      "updated",
      "removed",
      "unchanged",
      "conflicting",
      "rejected",
    ]);
    for (const kind of PROJECT_MERGE_ENTRY_KINDS) {
      expect(isKnownProjectMergeEntryKind(kind)).toBe(true);
    }
    expect(isKnownProjectMergeEntryKind("merged")).toBe(false);
    expect(isKnownProjectMergeEntryKind(undefined)).toBe(false);
  });

  it("classifies a fact at a new path as added and describes the new field", () => {
    const result = describeProjectMerge(makeContext(), makeRequest());
    expect(result.ok).toBe(true);
    const merge = result.data[0];
    expect(merge.entries).toHaveLength(1);
    expect(merge.entries[0].kind).toBe("added");
    expect(merge.entries[0].path).toBe("units.area1br");
    expect(merge.conflicts).toEqual([]);
    const added = merge.mergedFields.find((field) => field.path === "units.area1br");
    expect(added?.id).toBe("pfld_coralina-units-area1br");
    expect(added?.section).toBe("units");
    expect(currentProjectFieldValue(added!)?.factId).toBe(merge.entries[0].factId);
  });

  it("classifies a byte-identical reading as unchanged — nothing moves", () => {
    const record = makeRecord();
    const result = describeProjectMerge(makeContext(), { facts: [samePriceFact()] });
    const merge = result.data[0];
    expect(merge.entries[0].kind).toBe("unchanged");
    expect(merge.conflicts).toEqual([]);
    expect(merge.mergedFields).toEqual(
      describeProjectMerge(makeContext(), { facts: [] }).data[0].mergedFields,
    );
    expect(merge.mergedFields[0].values).toEqual(record.fields[0].values);
  });

  it("describes a same-source disagreement as updated: superseded, chained, kept", () => {
    const fact = newerPriceFact();
    const result = describeProjectMerge(makeContext(), { facts: [fact] });
    const merge = result.data[0];
    expect(merge.entries[0].kind).toBe("updated");
    expect(merge.conflicts).toEqual([]);

    const field = merge.mergedFields.find((f) => f.path === "pricing.basePrice");
    expect(field?.values).toHaveLength(2);
    // Superseded values stay in history, chained to what replaced them.
    expect(field?.values[0].status).toBe("superseded");
    expect(field?.values[0].supersededBy).toBe(fact.id);
    expect(field?.values[0].rawValue).toBe("THB 4,590,000");
    // The standing value is the incoming reading.
    expect(currentProjectFieldValue(field!)?.rawValue).toBe("THB 4,700,000");
    expect(currentProjectFieldValue(field!)?.factId).toBe(fact.id);
  });

  it("describes a same-source stated absence as removed — absence stays data", () => {
    const fact = goneFact();
    const result = describeProjectMerge(makeContext(), { facts: [fact] });
    const merge = result.data[0];
    expect(merge.entries[0].kind).toBe("removed");
    const field = merge.mergedFields.find((f) => f.path === "pricing.basePrice");
    expect(field?.values[0].status).toBe("removed");
    expect(field?.values[1].status).toBe("missing");
    expect("rawValue" in field!.values[1]).toBe(false);
    expect(currentProjectFieldValue(field!)).toBeUndefined();
  });

  it("describes a cross-source disagreement as a conflict and resolves nothing", () => {
    const fact = brochureFact();
    const result = describeProjectMerge(makeContext(), { facts: [fact] });
    const merge = result.data[0];
    expect(merge.entries[0].kind).toBe("conflicting");
    expect(merge.conflicts).toHaveLength(1);
    const conflict = merge.conflicts[0];
    expect(conflict.path).toBe("pricing.basePrice");
    expect(conflict.factId).toBe(fact.id);
    expect(conflict.existing.rawValue).toBe("THB 4,590,000");
    expect(conflict.incoming.rawValue).toBe("THB 4,850,000");
    expect(conflict.detectedAt).toBe("2026-07-12T00:00:00.000Z");
    // Nothing moved: the standing value is exactly what stood before.
    const field = merge.mergedFields.find((f) => f.path === "pricing.basePrice");
    expect(field?.values).toHaveLength(1);
    expect(currentProjectFieldValue(field!)?.rawValue).toBe("THB 4,590,000");
    // The disagreement is annotated, never escalated to a blocking error.
    expect(result.ok).toBe(true);
    expect(result.warnings.some((issue) => issue.code === "conflicting_values")).toBe(true);
  });

  it("treats a byte-identical reading from another source as unchanged — corroboration moves nothing", () => {
    const corroborating = makeFact({ factSlug: "price-1br-brochure", sourceId: OTHER_SOURCE_ID });
    const merge = describeProjectMerge(makeContext(), { facts: [corroborating] }).data[0];
    expect(merge.entries[0].kind).toBe("unchanged");
    expect(merge.conflicts).toEqual([]);
  });

  it("describes a cross-source stated absence as a conflict, not a removal", () => {
    const gone = makeFact({
      factSlug: "price-1br-brochure",
      sourceId: OTHER_SOURCE_ID,
      rawValue: undefined,
      structuredValue: undefined,
      status: "unavailable",
    });
    const merge = describeProjectMerge(makeContext(), { facts: [gone] }).data[0];
    expect(merge.entries[0].kind).toBe("conflicting");
    expect(merge.conflicts[0].incoming.status).toBe("missing");
    // The standing value is untouched — another source's silence never
    // removes what this source stated.
    const field = merge.mergedFields.find((f) => f.path === "pricing.basePrice");
    expect(currentProjectFieldValue(field!)?.rawValue).toBe("THB 4,590,000");
  });

  it("rejects a fact id already classified in the batch — one fact, one classification", () => {
    const fact = newerPriceFact();
    const result = describeProjectMerge(makeContext(), { facts: [fact, fact] });
    const merge = result.data[0];
    expect(merge.entries.map((entry) => entry.kind)).toEqual(["updated", "rejected"]);
    expect(merge.entries[1].reason).toContain("already classified");
    expect(validateProjectMerge(merge).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("rejects what cannot settle, each with a stated reason", () => {
    const wrongProject = makeFact({ projectSlug: "elsewhere" });
    const unmapped = makeFact({ factSlug: "unmapped", fieldPath: undefined });
    const superseded = makeFact({ factSlug: "old", status: "superseded" });
    const result = describeProjectMerge(makeContext(), {
      facts: [wrongProject, unmapped, superseded],
    });
    const merge = result.data[0];
    expect(merge.entries.map((entry) => entry.kind)).toEqual(["rejected", "rejected", "rejected"]);
    for (const entry of merge.entries) expect(entry.reason).toBeTruthy();
    // A foreign fact blocks; an unmapped or superseded one merely warns.
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings.filter((issue) => issue.code === "rejected_fact")).toHaveLength(2);
  });

  it("describes a whole batch in input order against the settling view", () => {
    const facts = [
      makeFact({ factSlug: "area-1br", factType: "internal_area", fieldPath: "units.area1br" }),
      newerPriceFact(),
      brochureFact(),
      makeFact({ factSlug: "unmapped", fieldPath: undefined }),
    ];
    const result = describeProjectMerge(makeContext(), {
      facts,
      reason: "batch",
      author: "intake",
    });
    const merge = result.data[0];
    expect(merge.entries.map((entry) => entry.kind)).toEqual([
      "added",
      "updated",
      "conflicting",
      "rejected",
    ]);
    expect(listProjectMergeEntries(merge, "added")).toHaveLength(1);
    expect(listProjectMergeEntries(merge, "conflicting")).toHaveLength(1);
    // The brochure conflicts with the *newer* same-source reading that
    // settled just before it in the batch.
    expect(merge.conflicts[0].existing.rawValue).toBe("THB 4,700,000");
    expect(result.stats).toMatchObject({
      stages: 1,
      steps: 4,
      completed: 2,
      skipped: 1,
      failed: 1,
    });
    expect(result.metadata.conflictCount).toBe(1);
    expect(result.metadata.factCount).toBe(4);
  });
});

describe("merge revision description", () => {
  it("describes — never applies — the next revision of the record", () => {
    const context = makeContext();
    const result = describeProjectMerge(context, makeRequest({ author: "intake" }));
    const merge = result.data[0];
    expect(merge.id).toBe("pmrg_coralina-r2");
    expect(merge.revision.id).toBe("prev_coralina-r2");
    expect(merge.revision.number).toBe(2);
    expect(merge.revision.basedOn).toBe("prev_coralina-r1");
    expect(merge.revision.createdAt).toBe("2026-07-12T00:00:00.000Z");
    expect(merge.revision.author).toBe("intake");
    expect(merge.revision.changes).toHaveLength(1);
    expect(merge.revision.changes[0].kind).toBe("added");
    // Described, never applied: the record still holds exactly one revision.
    expect(context.record.revisions).toHaveLength(1);
  });

  it("starts the chain at revision 1 for a record with no revision yet", () => {
    const record = makeRecord({ revisions: [] });
    const merge = describeProjectMerge(makeContext({ record }), makeRequest()).data[0];
    expect(merge.revision.number).toBe(1);
    expect("basedOn" in merge.revision).toBe(false);
  });

  it("stamps the incoming values with the described revision and caller clock", () => {
    const merge = describeProjectMerge(makeContext(), makeRequest()).data[0];
    const incoming = merge.entries[0].incoming;
    expect(incoming?.revisionId).toBe("prev_coralina-r2");
    expect(incoming?.recordedAt).toBe("2026-07-12T00:00:00.000Z");
    const unstamped = describeProjectMerge(makeContext({ now: undefined }), makeRequest()).data[0];
    expect("recordedAt" in unstamped.entries[0].incoming!).toBe(false);
  });
});

describe("merge robustness", () => {
  it("reports an absent record or a non-list facts value instead of throwing", () => {
    const noRecord = describeProjectMerge({} as never, makeRequest());
    expect(noRecord.ok).toBe(false);
    expect(noRecord.data).toEqual([]);
    expect(noRecord.errors[0].code).toBe("missing_merge_record");

    const badFacts = describeProjectMerge(makeContext(), { facts: "nope" as never });
    expect(badFacts.ok).toBe(false);
    expect(badFacts.errors[0].code).toBe("invalid_merge_facts");
    expect(badFacts.data).toEqual([]);
  });

  it("classifies around deeply malformed record internals instead of throwing", () => {
    const record = makeRecord({
      fields: [
        null,
        { id: 7, path: "pricing.basePrice", values: "junk" },
        { path: "units.area1br", values: [null] },
      ] as never,
      revisions: [null, { number: "one" }] as never,
    });
    const result = describeProjectMerge(makeContext({ record }), {
      facts: [makeFact(), null, { id: "xfact_bare" }] as never,
    });
    // The malformed field holds no readable standing value, so the coherent
    // incoming reading is described as its first standing entry; the two
    // malformed facts are rejected with reasons, never dereferenced.
    expect(result.data).toHaveLength(1);
    expect(result.data[0].entries.map((entry) => entry.kind)).toEqual([
      "added",
      "rejected",
      "rejected",
    ]);
    expect(result.data[0].revision.number).toBe(1);
  });

  it("rejects a fact whose representation cannot be described instead of throwing", () => {
    const exotic = { ...makeFact(), structuredValue: { nested: { deep: true } } };
    const result = describeProjectMerge(makeContext(), { facts: [exotic as never] });
    expect(result.data[0].entries[0].kind).toBe("rejected");
    expect(result.data[0].entries[0].reason).toContain("structured value");
    expect(result.ok).toBe(false);
  });

  it("rejects sparse-array holes as malformed facts — never silently dropped", () => {
    const facts: unknown[] = [];
    facts[1] = makeFact();
    const result = describeProjectMerge(makeContext(), { facts: facts as never });
    expect(result.data[0].entries.map((entry) => entry.kind)).toEqual(["rejected", "unchanged"]);
    expect(result.stats.steps).toBe(2);
  });

  it("warns on a non-list record fields value and still describes the batch", () => {
    const record = makeRecord({ fields: "junk" as never });
    const result = describeProjectMerge(makeContext({ record }), makeRequest());
    expect(result.warnings.some((issue) => issue.code === "invalid_record_fields")).toBe(true);
    expect(result.data[0].entries[0].kind).toBe("added");
  });

  it("its own removal description validates cleanly", () => {
    const merge = describeProjectMerge(makeContext(), { facts: [goneFact()] }).data[0];
    // The removed entry keeps the reading it once was — history preserves
    // what was removed — and the module's own validator accepts it.
    const field = merge.mergedFields.find((f) => f.path === "pricing.basePrice");
    expect(field?.values[0].status).toBe("removed");
    expect(field?.values[0].rawValue).toBe("THB 4,590,000");
    expect(validateProjectMerge(merge).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("settles an empty batch as a noop", () => {
    const result = describeProjectMerge(makeContext(), { facts: [] });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("skipped");
    expect(result.outcome).toBe("noop");
    expect(result.data[0].entries).toEqual([]);
  });

  it("its own output validates cleanly", () => {
    const facts = [
      makeFact({ factSlug: "area-1br", factType: "internal_area", fieldPath: "units.area1br" }),
      newerPriceFact(),
      brochureFact(),
      samePriceFact(),
    ];
    // The identical re-reading arrives last so it meets the already-updated
    // standing value and classifies as conflicting-free "updated" history —
    // still a coherent merge.
    const merge = describeProjectMerge(makeContext(), { facts }).data[0];
    const verdict = validateProjectMerge(merge);
    expect(verdict.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});

describe("merge history glue", () => {
  it("derives a history entry from a described merge", () => {
    const result = describeProjectMerge(makeContext(), makeRequest());
    const entry = projectMergeHistoryEntry(result, {
      startedAt: "2026-07-12T00:00:00.000Z",
      finishedAt: "2026-07-12T00:00:01.000Z",
    });
    expect(entry.projectId).toBe("proj_coralina");
    expect(entry.mergeId).toBe("pmrg_coralina-r2");
    expect(entry.revisionId).toBe("prev_coralina-r2");
    expect(entry.state).toBe(result.state);
    expect(entry.outcome).toBe(result.outcome);
    expect(entry.stats).toEqual(result.stats);
    expect(entry.stats).not.toBe(result.stats);
    expect(entry.startedAt).toBe("2026-07-12T00:00:00.000Z");
  });
});
