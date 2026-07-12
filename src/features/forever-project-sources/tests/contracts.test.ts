import { describe, expect, it } from "vitest";

import {
  defineProjectSourceProvider,
  projectSourceProviderCoversProject,
  projectSourceProviderDescribes,
  projectSourceProviderDocumentKey,
  projectSourceProviderFormat,
} from "..";
import { makeSource } from "./fixtures";

describe("source provider contract", () => {
  const provider = defineProjectSourceProvider({ definition: makeSource() });

  it("pins the contract without changing the provider", () => {
    expect(provider.definition.identity.slug).toBe("price-list");
  });

  it("answers document type, project, format, and document key from the definition alone", () => {
    expect(projectSourceProviderDescribes(provider, "price_list")).toBe(true);
    expect(projectSourceProviderDescribes(provider, "brochure")).toBe(false);
    expect(projectSourceProviderCoversProject(provider, "proj_coralina")).toBe(true);
    expect(projectSourceProviderCoversProject(provider, "proj_modeva")).toBe(false);
    expect(projectSourceProviderFormat(provider)).toBe("pdf");
    expect(projectSourceProviderDocumentKey(provider)).toBe("proj_coralina:price-list");
  });
});
