import { describe, expect, it } from "vitest";

import {
  addProjectSourceCatalogEntry,
  describeProjectSource,
  sortProjectSourcesByVersion,
  validateProjectSourceCatalog,
  validateProjectSourceDefinition,
} from "..";
import { makeCatalog, makeEntry, makeInput } from "./fixtures";

describe("deterministic foundation", () => {
  it("describeProjectSource is pure: equal, independent values per call", () => {
    expect(describeProjectSource(makeInput())).toEqual(describeProjectSource(makeInput()));
    expect(describeProjectSource(makeInput())).not.toBe(describeProjectSource(makeInput()));

    const mutated = describeProjectSource(makeInput());
    mutated.status = "archived";
    expect(describeProjectSource(makeInput()).status).toBe("registered");
  });

  it("describeProjectSource is byte-identical for identical input and stamps no clock of its own", () => {
    const describe = () =>
      describeProjectSource(makeInput({ uploadedAt: undefined, documentDate: undefined }));
    expect(JSON.stringify(describe())).toBe(JSON.stringify(describe()));
    expect(JSON.stringify(describe())).not.toContain("uploadedAt");
    expect(JSON.stringify(describe())).not.toContain("registeredAt");
  });

  it("does not mutate the input it describes from, and its result never aliases it", () => {
    const input = makeInput({ metadata: { tags: ["print"] } });
    const snapshot = structuredClone(input);
    const result = describeProjectSource(input);
    expect(input).toEqual(snapshot);

    // Mutating a described definition must never reach back into the input,
    // and two definitions described from one input must share no state.
    expect(result.metadata).not.toBe(input.metadata);
    expect(result.authority).not.toBe(input.authority);
    expect(result.version).not.toBe(input.version);
    result.metadata?.tags?.push("mutated");
    result.authority.trust = "authoritative";
    expect(input).toEqual(snapshot);
    expect(describeProjectSource(input).metadata).not.toBe(result.metadata);
  });

  it("does not mutate the catalogue it validates, appends to, or sorts", () => {
    const catalog = makeCatalog({ entries: [makeEntry(), makeEntry({ enabled: false })] });
    const snapshot = structuredClone(catalog);
    validateProjectSourceCatalog(catalog);
    addProjectSourceCatalogEntry(catalog, makeEntry());
    sortProjectSourcesByVersion(catalog.entries.map((entry) => entry.definition));
    expect(catalog).toEqual(snapshot);
  });

  it("validation is deterministic: identical input yields identical issues", () => {
    const source = describeProjectSource(makeInput({ status: "superseded" }));
    expect(validateProjectSourceDefinition(source)).toEqual(
      validateProjectSourceDefinition(source),
    );
    expect(validateProjectSourceCatalog(makeCatalog())).toEqual(
      validateProjectSourceCatalog(makeCatalog()),
    );
  });
});
