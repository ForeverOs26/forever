import { describe, expect, it } from "vitest";

import {
  addProjectDatabaseCatalogEntry,
  describeProjectField,
  describeProjectMerge,
  describeProjectRecord,
  describeProjectSnapshot,
  projectFieldValueFromFact,
  sortProjectFields,
  validateProjectDatabaseCatalog,
  validateProjectDatabase,
  validateProjectRecord,
} from "..";
import { projectRecordVersion } from "..";
import {
  makeCatalog,
  makeContext,
  makeDatabase,
  makeEntry,
  makeFact,
  makeField,
  makeRecord,
  makeRequest,
  makeRevision,
} from "./fixtures";

describe("deterministic foundation", () => {
  it("describe builders are pure: equal, independent values per call", () => {
    expect(makeRecord()).toEqual(makeRecord());
    expect(makeField()).toEqual(makeField());
    const mutated = makeRecord();
    mutated.fields.pop();
    mutated.revisions.pop();
    expect(makeRecord().fields).toHaveLength(1);
    expect(makeRecord().revisions).toHaveLength(1);
  });

  it("describeProjectMerge is byte-identical for identical input and stamps no clock of its own", () => {
    const merge = () => describeProjectMerge(makeContext(), makeRequest());
    expect(JSON.stringify(merge())).toBe(JSON.stringify(merge()));
    const unstamped = describeProjectMerge(makeContext({ now: undefined }), makeRequest());
    expect(JSON.stringify(unstamped)).not.toContain("describedAt");
    expect(JSON.stringify(unstamped)).not.toContain("recordedAt");
    expect(JSON.stringify(unstamped)).not.toContain("detectedAt");
    expect(JSON.stringify(unstamped.data[0].revision)).not.toContain("createdAt");
  });

  it("describeProjectMerge mutates neither the context nor the request, and never aliases them", () => {
    const context = makeContext();
    const request = makeRequest();
    const contextSnapshot = structuredClone(context);
    const requestSnapshot = structuredClone(request);
    const result = describeProjectMerge(context, request);
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);

    // Mutating the described merge must never reach back into the record or
    // the incoming facts.
    const merge = result.data[0];
    expect(merge.mergedFields[1]).not.toBe(context.record.fields[0]);
    expect(merge.entries[0].incoming?.provenance).not.toBe(request.facts[0].provenance);
    merge.mergedFields.forEach((field) => field.values.pop());
    merge.entries[0].incoming!.rawValue = "mutated";
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);
  });

  it("snapshots and settled values never alias their sources", () => {
    const record = makeRecord();
    const snapshot = describeProjectSnapshot(record, makeRevision());
    expect(snapshot.fields[0]).not.toBe(record.fields[0]);
    snapshot.fields[0].values.pop();
    expect(record.fields[0].values).toHaveLength(1);

    const fact = makeFact();
    const value = projectFieldValueFromFact(fact);
    value.sourceIds?.pop();
    expect(fact.sourceId).toBe("psrc_coralina-price-list-v1-0-0");
  });

  it("does not mutate what it validates, appends to, or sorts", () => {
    const database = makeDatabase();
    const databaseSnapshot = structuredClone(database);
    validateProjectDatabase(database);
    expect(database).toEqual(databaseSnapshot);

    const catalog = makeCatalog({ entries: [makeEntry(), makeEntry({ enabled: false })] });
    const catalogSnapshot = structuredClone(catalog);
    validateProjectDatabaseCatalog(catalog);
    addProjectDatabaseCatalogEntry(catalog, makeEntry());
    expect(catalog).toEqual(catalogSnapshot);

    const fields = [
      makeField(),
      describeProjectField({ projectSlug: "coralina", path: "general.name" }),
    ];
    const fieldsSnapshot = structuredClone(fields);
    sortProjectFields(fields);
    expect(fields).toEqual(fieldsSnapshot);
  });

  it("validation is deterministic: identical input yields identical issues", () => {
    const record = makeRecord({ status: "published" as never });
    expect(validateProjectRecord(record)).toEqual(validateProjectRecord(record));
    expect(validateProjectDatabase(makeDatabase())).toEqual(
      validateProjectDatabase(makeDatabase()),
    );
    expect(validateProjectDatabaseCatalog(makeCatalog())).toEqual(
      validateProjectDatabaseCatalog(makeCatalog()),
    );
  });

  it("record description is total over equal input regardless of call order", () => {
    const first = describeProjectRecord({
      projectSlug: "coralina",
      version: projectRecordVersion(1, 0, 0),
    });
    makeRecord();
    makeContext();
    const second = describeProjectRecord({
      projectSlug: "coralina",
      version: projectRecordVersion(1, 0, 0),
    });
    expect(first).toEqual(second);
  });
});
