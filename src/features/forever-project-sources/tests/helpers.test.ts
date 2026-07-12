import { describe, expect, it } from "vitest";

import { isNonEmptyString as sourceRegistryIsNonEmptyString } from "@/features/forever-source-registry";

import {
  distinctProjectSourceDocumentTypes,
  distinctProjectSourceFileFormats,
  distinctProjectSourceLanguages,
  distinctProjectSourceProjects,
  distinctProjectSourceTags,
  isNonEmptyString,
  projectSourceDefinitionKey,
  projectSourceDocumentKey,
  projectSourceVersion,
  sortProjectSourcesByVersion,
} from "..";
import { describeProjectSource } from "../definition";
import { makeInput, makeSource } from "./fixtures";

describe("string guard reuse", () => {
  it("is the RC3.3 guard verbatim", () => {
    expect(isNonEmptyString).toBe(sourceRegistryIsNonEmptyString);
    expect(isNonEmptyString("x")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
  });
});

describe("natural keys", () => {
  it("groups revisions by document key and separates them by revision key", () => {
    const v1 = makeSource();
    const v2 = describeProjectSource(makeInput({ version: projectSourceVersion(2, 0, 0) }));
    expect(projectSourceDocumentKey(v1.identity)).toBe("proj_coralina:price-list");
    expect(projectSourceDocumentKey(v1.identity)).toBe(projectSourceDocumentKey(v2.identity));
    expect(projectSourceDefinitionKey(v1)).toBe("proj_coralina:price-list@1.0.0");
    expect(projectSourceDefinitionKey(v2)).toBe("proj_coralina:price-list@2.0.0");
  });
});

describe("version ordering", () => {
  it("sorts oldest first, stably, without mutating the input", () => {
    const v1 = makeSource();
    const v2 = describeProjectSource(makeInput({ version: projectSourceVersion(2, 0, 0) }));
    const twin = makeSource();
    const input = [v2, v1, twin];
    const sorted = sortProjectSourcesByVersion(input);
    // Reference assertions: equal versions must keep their input order.
    expect(sorted[0]).toBe(v1);
    expect(sorted[1]).toBe(twin);
    expect(sorted[2]).toBe(v2);
    expect(input).toEqual([v2, v1, twin]);
  });
});

describe("distinct collectors", () => {
  const sources = [
    makeSource(),
    describeProjectSource(
      makeInput({
        sourceSlug: "brochure",
        documentType: "brochure",
        language: "th",
        metadata: { tags: ["marketing", "print"] },
      }),
    ),
    describeProjectSource(
      makeInput({ projectSlug: "modeva", fileFormat: "image", metadata: { tags: ["marketing"] } }),
    ),
  ];

  it("collects document types, formats, languages, tags, and projects in first-seen order", () => {
    expect(distinctProjectSourceDocumentTypes(sources)).toEqual(["price_list", "brochure"]);
    expect(distinctProjectSourceFileFormats(sources)).toEqual(["pdf", "image"]);
    expect(distinctProjectSourceLanguages(sources)).toEqual(["en", "th"]);
    expect(distinctProjectSourceTags(sources)).toEqual(["marketing", "print"]);
    expect(distinctProjectSourceProjects(sources)).toEqual(["proj_coralina", "proj_modeva"]);
  });

  it("returns empty lists for no sources", () => {
    expect(distinctProjectSourceDocumentTypes([])).toEqual([]);
    expect(distinctProjectSourceTags([])).toEqual([]);
  });
});
