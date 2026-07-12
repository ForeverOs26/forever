import { describe, expect, it } from "vitest";

import { describeProjectRecord, emptyProjectTimeline } from "..";
import { projectRecordVersion } from "..";
import { makeField, makeRecord, makeRevision } from "./fixtures";

describe("describeProjectRecord", () => {
  it("derives the identity and defaults the safe posture", () => {
    const record = describeProjectRecord({
      projectSlug: "coralina",
      version: projectRecordVersion(1, 0, 0),
    });
    expect(record.identity).toEqual({
      id: "prec_coralina",
      slug: "coralina",
      name: "coralina",
      projectId: "proj_coralina",
    });
    expect(record.status).toBe("draft");
    expect(record.fields).toEqual([]);
    expect(record.revisions).toEqual([]);
    expect(record.snapshots).toEqual([]);
    expect(record.timeline).toEqual(emptyProjectTimeline("proj_coralina"));
    expect("sourceIds" in record).toBe(false);
    expect("metadata" in record).toBe(false);
  });

  it("honours every supplied observation", () => {
    const record = makeRecord();
    expect(record.identity.name).toBe("Coralina");
    expect(record.status).toBe("active");
    expect(record.fields).toHaveLength(1);
    expect(record.revisions).toHaveLength(1);
    expect(record.sourceIds).toEqual(["psrc_coralina-price-list-v1-0-0"]);
    expect(record.version).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  it("is deterministic: equal input yields byte-identical records", () => {
    expect(JSON.stringify(makeRecord())).toBe(JSON.stringify(makeRecord()));
  });

  it("never aliases its input: mutating the record cannot reach back", () => {
    const fields = [makeField()];
    const revisions = [makeRevision()];
    const record = describeProjectRecord({
      projectSlug: "coralina",
      version: projectRecordVersion(1, 0, 0),
      fields,
      revisions,
    });
    expect(record.fields).not.toBe(fields);
    expect(record.fields[0]).not.toBe(fields[0]);
    expect(record.revisions[0]).not.toBe(revisions[0]);
    record.fields[0].values.pop();
    record.revisions.pop();
    expect(fields[0].values).toHaveLength(1);
    expect(revisions).toHaveLength(1);
  });

  it("two records described from one input share no state", () => {
    const input = {
      projectSlug: "coralina",
      version: projectRecordVersion(1, 0, 0),
      fields: [makeField()],
    };
    const first = describeProjectRecord(input);
    const second = describeProjectRecord(input);
    expect(first).toEqual(second);
    first.fields[0].name = "mutated";
    expect(second.fields[0].name).toBe("Base price");
  });
});
