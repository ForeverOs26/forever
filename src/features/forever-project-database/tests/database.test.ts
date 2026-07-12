import { describe, expect, it } from "vitest";

import {
  addProjectRecord,
  emptyProjectDatabase,
  findProjectRecord,
  hasProjectRecord,
  sortProjectRecords,
} from "..";
import { makeDatabase, makeRecord } from "./fixtures";

describe("database data model", () => {
  it("starts empty, with the name attached only when supplied", () => {
    expect(emptyProjectDatabase("pdb_forever")).toEqual({ id: "pdb_forever", records: [] });
    expect(emptyProjectDatabase("pdb_forever", "Forever")).toEqual({
      id: "pdb_forever",
      name: "Forever",
      records: [],
    });
  });

  it("appends records immutably", () => {
    const database = makeDatabase();
    const snapshot = structuredClone(database);
    const other = makeRecord({
      identity: {
        ...makeRecord().identity,
        projectId: "proj_other",
        slug: "other",
        id: "prec_other",
      },
    });
    const grown = addProjectRecord(database, other);
    expect(database).toEqual(snapshot);
    expect(grown.records).toHaveLength(2);
    expect(grown.records[0]).toBe(database.records[0]);
  });

  it("finds the one canonical record of a project by its `proj_` id", () => {
    const database = makeDatabase();
    expect(findProjectRecord(database, "proj_coralina")?.identity.slug).toBe("coralina");
    expect(findProjectRecord(database, "proj_missing")).toBeUndefined();
    expect(hasProjectRecord(database, "proj_coralina")).toBe(true);
    expect(hasProjectRecord(database, "proj_missing")).toBe(false);
  });

  it("orders records deterministically by natural key, stably and immutably", () => {
    const a = makeRecord({ identity: { ...makeRecord().identity, slug: "alpha" } });
    const b = makeRecord({ identity: { ...makeRecord().identity, slug: "beta" } });
    const input = [b, a];
    const sorted = sortProjectRecords(input);
    expect(sorted.map((record) => record.identity.slug)).toEqual(["alpha", "beta"]);
    expect(input.map((record) => record.identity.slug)).toEqual(["beta", "alpha"]);
    expect(sortProjectRecords(input)).toEqual(sorted);
  });
});
