import { describe, expect, it } from "vitest";

import {
  validateProjectDatabaseCatalog,
  validateProjectDatabase,
  validateProjectField,
  validateProjectFieldValue,
  validateProjectHistory,
  validateProjectMerge,
  validateProjectRecord,
  validateProjectRecordIdentity,
  validateProjectRegistry,
  validateProjectHistoryEntry,
  validateProjectRevisions,
  validateProjectSnapshot,
  validateProjectSnapshots,
  validateProjectTimeline,
  ProjectRegistry,
  appendProjectHistory,
  emptyProjectHistory,
  emptyProjectTimeline,
  projectTimelineEvent,
  appendProjectTimelineEvent,
} from "..";
import type { ProjectDatabaseIssue } from "..";
import {
  makeCatalog,
  makeDatabase,
  makeEntry,
  makeField,
  makeHistoryEntry,
  makeMerge,
  makeRecord,
  makeRevision,
  makeSnapshot,
  makeValue,
} from "./fixtures";

function codes(issues: ProjectDatabaseIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function errorCodes(issues: ProjectDatabaseIssue[]): string[] {
  return codes(issues.filter((issue) => issue.severity === "error"));
}

describe("never-throw guarantee over deeply malformed input", () => {
  const garbage = [undefined, null, 42, "junk", [], {}, { identity: null }, { values: 7 }];

  it("every validator returns issues — never throws — for arbitrary garbage", () => {
    for (const value of garbage) {
      expect(() => validateProjectFieldValue(value as never)).not.toThrow();
      expect(() => validateProjectField(value as never)).not.toThrow();
      expect(() => validateProjectRecordIdentity(value as never)).not.toThrow();
      expect(() => validateProjectRevisions(value as never)).not.toThrow();
      expect(() => validateProjectSnapshots(value as never)).not.toThrow();
      expect(() => validateProjectTimeline(value as never)).not.toThrow();
      expect(() => validateProjectHistory(value as never)).not.toThrow();
      expect(() => validateProjectRecord(value as never)).not.toThrow();
      expect(() => validateProjectMerge(value as never)).not.toThrow();
      expect(() => validateProjectDatabase(value as never)).not.toThrow();
      expect(() => validateProjectDatabaseCatalog(value as never)).not.toThrow();
      expect(() => validateProjectRegistry(value as never)).not.toThrow();
    }
  });

  it("reports deep garbage inside containers instead of dereferencing it", () => {
    const record = makeRecord({
      fields: [null, { id: 3, values: "junk" }, makeField()] as never,
      revisions: [null, { number: "one", changes: 5 }] as never,
      snapshots: [{ fields: null }] as never,
      timeline: { projectId: "", events: [null, { kind: "publish" }] } as never,
    });
    const issues = validateProjectRecord(record);
    expect(errorCodes(issues)).toEqual(
      expect.arrayContaining([
        "missing_field",
        "invalid_values",
        "missing_revision",
        "invalid_revision_number",
        "invalid_changes",
        "invalid_snapshot_fields",
        "missing_timeline_project",
        "missing_timeline_event",
        "unknown_timeline_event",
      ]),
    );
  });
});

describe("value validation", () => {
  it("passes a settled fixture value", () => {
    expect(validateProjectFieldValue(makeValue())).toEqual([]);
  });

  it("flags a fabricated value on a stated absence, and a current without one", () => {
    const absent = makeValue({ status: "missing" });
    expect(errorCodes(validateProjectFieldValue(absent))).toContain("absent_with_value");
    const empty = makeValue({ rawValue: undefined, structuredValue: undefined });
    expect(errorCodes(validateProjectFieldValue(empty))).toContain("current_without_value");
  });

  it("flags unknown standing, bad structured values, and confidence through the reused guard", () => {
    expect(errorCodes(validateProjectFieldValue(makeValue({ status: "gone" as never })))).toContain(
      "unknown_value_status",
    );
    expect(
      errorCodes(
        validateProjectFieldValue(makeValue({ structuredValue: { nested: {} } as never })),
      ),
    ).toContain("invalid_structured_value");
    expect(
      errorCodes(
        validateProjectFieldValue(
          makeValue({ confidence: { level: "unknown", score: 0.4 } as never }),
        ),
      ),
    ).toContain("score_on_unknown_confidence");
    expect(
      errorCodes(validateProjectFieldValue(makeValue({ confidence: undefined as never }))),
    ).toContain("missing_confidence");
  });

  it("judges provenance and evidence through the reused RC4.5 guards", () => {
    const badProvenance = makeValue({
      provenance: { sourceId: "", sourceVersion: null, method: null, extractedAt: "" } as never,
    });
    expect(errorCodes(validateProjectFieldValue(badProvenance))).toEqual(
      expect.arrayContaining([
        "missing_provenance_source",
        "missing_provenance_version",
        "missing_extraction_method",
        "missing_extraction_time",
      ]),
    );
    const badEvidence = makeValue({ evidence: [{ sourceId: "" }] as never });
    expect(errorCodes(validateProjectFieldValue(badEvidence))).toContain("missing_evidence_source");
  });

  it("keeps the superseding chain walkable", () => {
    expect(codes(validateProjectFieldValue(makeValue({ status: "superseded" })))).toContain(
      "superseded_without_reference",
    );
    const selfRef = makeValue({ supersededBy: makeValue().factId, status: "superseded" });
    expect(errorCodes(validateProjectFieldValue(selfRef))).toContain("self_superseding_reference");
    const standing = makeValue({ supersededBy: "xfact_other" });
    expect(codes(validateProjectFieldValue(standing))).toContain(
      "superseding_reference_on_standing",
    );
  });

  it("warns on unconventional timestamps and language tags — deviations never block", () => {
    const oddTime = validateProjectFieldValue(makeValue({ recordedAt: "yesterday" }));
    expect(codes(oddTime)).toContain("unconventional_recorded_time");
    expect(oddTime.every((issue) => issue.severity === "warning")).toBe(true);

    const oddLanguage = validateProjectFieldValue(makeValue({ language: "English (UK)" }));
    expect(codes(oddLanguage)).toContain("unconventional_language");
    expect(oddLanguage.every((issue) => issue.severity === "warning")).toBe(true);

    expect(errorCodes(validateProjectFieldValue(makeValue({ recordedAt: "" as never })))).toContain(
      "recorded_time",
    );
  });

  it("flags reference-list problems", () => {
    expect(
      errorCodes(validateProjectFieldValue(makeValue({ sourceIds: ["psrc_a", "psrc_a"] }))),
    ).toContain("duplicate_source_reference");
    expect(errorCodes(validateProjectFieldValue(makeValue({ sourceIds: [""] })))).toContain(
      "empty_source_reference",
    );
    expect(errorCodes(validateProjectFieldValue(makeValue({ factId: "" })))).toContain(
      "empty_fact_reference",
    );
  });
});

describe("field validation", () => {
  it("passes the fixture field", () => {
    expect(validateProjectField(makeField())).toEqual([]);
  });

  it("flags invalid paths, unknown sections, and section/path disagreement", () => {
    expect(errorCodes(validateProjectField(makeField({ path: "pricing..base" })))).toContain(
      "invalid_field_path",
    );
    expect(errorCodes(validateProjectField(makeField({ section: "misc" as never })))).toContain(
      "unknown_section",
    );
    const mismatched = makeField({ section: "media" });
    expect(codes(validateProjectField(mismatched))).toContain("section_path_mismatch");
  });

  it("flags two standing current values — a conflict a field cannot hold", () => {
    const field = makeField({ values: [makeValue(), makeValue({ rawValue: "THB 9" })] });
    expect(errorCodes(validateProjectField(field))).toContain("conflicting_current_values");
  });

  it("locates value issues inside the history", () => {
    const field = makeField({ values: [makeValue(), makeValue({ status: "bad" as never })] });
    const issue = validateProjectField(field, "fields.0").find(
      (candidate) => candidate.code === "unknown_value_status",
    );
    expect(issue?.path).toBe("fields.0.values.1.status");
  });
});

describe("revision and snapshot history validation", () => {
  it("passes the fixture history", () => {
    expect(validateProjectRevisions([makeRevision()])).toEqual([]);
    expect(validateProjectSnapshots([makeSnapshot()])).toEqual([]);
  });

  it("flags duplicate ids, non-increasing numbers, and a broken chain", () => {
    const r1 = makeRevision();
    const duplicate = validateProjectRevisions([r1, r1]);
    expect(errorCodes(duplicate)).toContain("duplicate_revision_id");
    expect(errorCodes(duplicate)).toContain("non_increasing_revisions");

    const r2 = makeRevision({ id: "prev_coralina-r2", number: 2, basedOn: "prev_coralina-r9" });
    expect(errorCodes(validateProjectRevisions([r1, r2]))).toContain("broken_revision_chain");
    expect(
      errorCodes(validateProjectRevisions([makeRevision({ basedOn: makeRevision().id })])),
    ).toContain("self_revision_reference");
  });

  it("flags incoherent changes", () => {
    const revision = makeRevision({
      changes: [
        { kind: "added", path: "pricing.basePrice" },
        { kind: "updated", path: "pricing.basePrice", after: makeValue() },
        { kind: "publish" as never, path: "x" },
      ],
    });
    const issues = validateProjectRevisions([revision]);
    expect(errorCodes(issues)).toEqual(
      expect.arrayContaining([
        "change_without_after",
        "change_without_before",
        "unknown_change_kind",
      ]),
    );
  });

  it("flags duplicate snapshots — per id and per frozen revision", () => {
    const issues = validateProjectSnapshots([makeSnapshot(), makeSnapshot()]);
    expect(errorCodes(issues)).toContain("duplicate_snapshot");
    expect(errorCodes(issues)).toContain("duplicate_snapshot_revision");
  });

  it("judges one snapshot standalone, warning on unconventional times", () => {
    expect(errorCodes(validateProjectSnapshot(null as never))).toContain("missing_snapshot");
    expect(validateProjectSnapshot(makeSnapshot())).toEqual([]);
    const issues = validateProjectSnapshot(makeSnapshot({ takenAt: "last Tuesday" }));
    expect(codes(issues)).toContain("unconventional_taken_time");
    expect(codes(validateProjectRevisions([makeRevision({ createdAt: "3 March" })]))).toContain(
      "unconventional_created_time",
    );
  });
});

describe("timeline and history validation", () => {
  it("passes coherent trails and logs", () => {
    const timeline = appendProjectTimelineEvent(
      emptyProjectTimeline("proj_coralina"),
      projectTimelineEvent("revision", { revisionId: "prev_coralina-r1" }),
    );
    expect(validateProjectTimeline(timeline)).toEqual([]);
    const history = appendProjectHistory(emptyProjectHistory("proj_coralina"), makeHistoryEntry());
    expect(validateProjectHistory(history)).toEqual([]);
  });

  it("warns on events that name no referent", () => {
    const timeline = appendProjectTimelineEvent(
      emptyProjectTimeline("proj_coralina"),
      projectTimelineEvent("merge"),
    );
    expect(codes(validateProjectTimeline(timeline))).toContain("event_without_reference");
  });

  it("flags foreign, unknown-state, and miscounted history entries", () => {
    const history = appendProjectHistory(
      appendProjectHistory(
        emptyProjectHistory("proj_coralina"),
        makeHistoryEntry({ projectId: "proj_other" }),
      ),
      makeHistoryEntry({ state: "done" as never, stats: { stages: -1 } as never }),
    );
    const issues = validateProjectHistory(history);
    expect(errorCodes(issues)).toEqual(
      expect.arrayContaining([
        "history_project_mismatch",
        "unknown_history_state",
        "invalid_history_stats",
      ]),
    );
  });

  it("warns when an entry finishes before it starts, or carries odd times", () => {
    const backwards = makeHistoryEntry({
      startedAt: "2026-07-12T00:00:01.000Z",
      finishedAt: "2026-07-12T00:00:00.000Z",
    });
    const issues = validateProjectHistoryEntry(backwards);
    expect(codes(issues)).toContain("history_time_order");
    expect(issues.every((issue) => issue.severity === "warning")).toBe(true);
    expect(codes(validateProjectHistoryEntry(makeHistoryEntry({ startedAt: "noon" })))).toContain(
      "unconventional_started_time",
    );
  });

  it("derives settlement consistency through the reused RC4.0 rules", () => {
    const inconsistent = makeHistoryEntry({ state: "failed", outcome: "failure" });
    const issues = validateProjectHistory(
      appendProjectHistory(emptyProjectHistory("proj_coralina"), inconsistent),
    );
    expect(codes(issues)).toContain("inconsistent_history_state");
    expect(codes(issues)).toContain("inconsistent_history_outcome");
    expect(issues.every((issue) => issue.severity === "warning")).toBe(true);
  });
});

describe("record validation", () => {
  it("passes the canonical fixture record with no issues at all", () => {
    expect(validateProjectRecord(makeRecord())).toEqual([]);
  });

  it("flags identity problems, unknown status, and a missing version", () => {
    const identity = { id: "", slug: "Not Normalized", name: "", projectId: "proj_other" };
    const record = makeRecord({
      identity: identity as never,
      status: "published" as never,
      version: undefined as never,
    });
    const issues = validateProjectRecord(record);
    expect(errorCodes(issues)).toEqual(
      expect.arrayContaining([
        "missing_record_id",
        "missing_record_name",
        "record_project_mismatch",
        "unknown_record_status",
        "missing_record_version",
      ]),
    );
    expect(codes(issues)).toContain("unnormalized_record_slug");
  });

  it("flags duplicate field ids and paths — one field per canonical statement", () => {
    const record = makeRecord({ fields: [makeField(), makeField()] });
    const issues = validateProjectRecord(record);
    expect(errorCodes(issues)).toContain("duplicate_field_id");
    expect(errorCodes(issues)).toContain("duplicate_field_path");
  });

  it("flags parts that belong to another project", () => {
    const foreignField = makeField({ projectId: "proj_other" });
    const foreignRevision = makeRevision({ projectId: "proj_other" });
    const foreignTimeline = emptyProjectTimeline("proj_other");
    const record = makeRecord({
      fields: [foreignField],
      revisions: [foreignRevision],
      timeline: foreignTimeline,
    });
    const issues = validateProjectRecord(record);
    expect(errorCodes(issues)).toEqual(
      expect.arrayContaining([
        "field_project_mismatch",
        "revision_project_mismatch",
        "timeline_project_mismatch",
      ]),
    );
  });

  it("flags snapshots pinning revisions the record does not hold — or the wrong number", () => {
    const unknown = makeSnapshot({ revisionId: "prev_coralina-r9", revisionNumber: 9 });
    expect(errorCodes(validateProjectRecord(makeRecord({ snapshots: [unknown] })))).toContain(
      "unknown_revision_reference",
    );
    const mismatched = makeSnapshot({ revisionNumber: 3 });
    expect(errorCodes(validateProjectRecord(makeRecord({ snapshots: [mismatched] })))).toContain(
      "snapshot_revision_mismatch",
    );
  });

  it("warns when a value names a revision the record does not (yet) hold", () => {
    const field = makeField({ values: [makeValue({ revisionId: "prev_coralina-r9" })] });
    const issues = validateProjectRecord(makeRecord({ fields: [field] }));
    const warning = issues.find((issue) => issue.code === "unknown_revision_reference");
    expect(warning?.severity).toBe("warning");
  });
});

describe("merge validation", () => {
  it("passes the described fixture merge", () => {
    expect(errorCodes(validateProjectMerge(makeMerge()))).toEqual([]);
  });

  it("flags a conflict that does not disagree, and one nobody classified", () => {
    const merge = makeMerge();
    const tampered = {
      ...merge,
      conflicts: [
        {
          path: "pricing.basePrice",
          fieldId: "pfld_coralina-pricing-baseprice",
          factId: "xfact_unlisted",
          existing: makeValue(),
          incoming: makeValue(),
        },
      ],
    };
    const issues = validateProjectMerge(tampered);
    expect(errorCodes(issues)).toContain("non_conflicting_values");
    expect(errorCodes(issues)).toContain("unmatched_conflict");
    expect(errorCodes(issues)).toContain("unaccounted_conflict");
  });

  it("flags entries whose kind and values disagree, and double-classified facts", () => {
    const merge = makeMerge();
    const entry = merge.entries[0];
    const tampered = {
      ...merge,
      entries: [
        { ...entry, incoming: undefined },
        { ...entry, kind: "unchanged" as const, existing: undefined },
      ],
    };
    const issues = validateProjectMerge(tampered);
    expect(errorCodes(issues)).toEqual(
      expect.arrayContaining([
        "merge_entry_without_incoming",
        "merge_entry_without_existing",
        "duplicate_fact_reference",
        "inconsistent_merge_changes",
      ]),
    );
  });

  it("flags a revision that does not account for the classified movements", () => {
    const merge = makeMerge();
    const tampered = { ...merge, revision: { ...merge.revision, changes: [] } };
    expect(errorCodes(validateProjectMerge(tampered))).toContain("inconsistent_merge_changes");
  });
});

describe("database, catalogue, and registry validation", () => {
  it("passes the fixture database, catalogue, and a coherent registry", () => {
    expect(validateProjectDatabase(makeDatabase()).valid).toBe(true);
    expect(validateProjectDatabaseCatalog(makeCatalog()).valid).toBe(true);
    expect(validateProjectRegistry(new ProjectRegistry().register(makeRecord())).valid).toBe(true);
  });

  it("partitions the verdict by the reused severity rule", () => {
    const verdict = validateProjectDatabase(makeDatabase({ id: "" }));
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.length).toBeGreaterThan(0);
    expect(verdict.issues).toHaveLength(verdict.errors.length + verdict.warnings.length);
    expect(codes(verdict.errors)).toContain("missing_database_id");
  });

  it("enforces exactly one canonical record per project", () => {
    const verdict = validateProjectDatabase(
      makeDatabase({ records: [makeRecord(), makeRecord()] }),
    );
    expect(verdict.valid).toBe(false);
    expect(codes(verdict.errors)).toEqual(
      expect.arrayContaining([
        "duplicate_project_record",
        "duplicate_record_id",
        "duplicate_record_key",
      ]),
    );
  });

  it("judges catalogue entries and re-roots record issues inside them", () => {
    const broken = makeEntry({
      enabled: "yes" as never,
      record: makeRecord({ status: "published" as never }),
    });
    const verdict = validateProjectDatabaseCatalog(makeCatalog({ entries: [broken] }));
    expect(codes(verdict.errors)).toContain("invalid_enabled_flag");
    const statusIssue = verdict.errors.find((issue) => issue.code === "unknown_record_status");
    expect(statusIssue?.path).toBe("entries.0.record.status");
  });

  it("flags a catalogue that lists one project twice", () => {
    const verdict = validateProjectDatabaseCatalog(
      makeCatalog({ entries: [makeEntry(), makeEntry()] }),
    );
    expect(codes(verdict.errors)).toContain("duplicate_project_record");
  });

  it("judges what a registry holds, not just how it was keyed", () => {
    const registry = new ProjectRegistry().register(makeRecord({ status: "published" as never }));
    const verdict = validateProjectRegistry(registry);
    expect(verdict.valid).toBe(false);
    expect(codes(verdict.errors)).toContain("unknown_record_status");
  });
});
