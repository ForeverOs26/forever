import { describe, expect, it } from "vitest";

import {
  buildForeverProjectTemplate,
  defineProjectPackageProvider,
  projectPackageProviderComponentCount,
  projectPackageProviderCovers,
  projectPackageProviderProvides,
  type ProjectPackageProvider,
} from "..";
import { makePackage } from "./fixtures";

describe("package provider contract", () => {
  const provider = defineProjectPackageProvider({
    package: makePackage({ provides: ["identity", "sources"], entities: ["project", "media"] }),
    template: buildForeverProjectTemplate(),
  });

  it("returns the provider unchanged", () => {
    expect(provider.package.identity.slug).toBe("coralina");
    expect(provider.template?.identity.id).toBe("tmpl_forever_project");
  });

  it("reports the components the package provides", () => {
    expect(projectPackageProviderProvides(provider, "sources")).toBe(true);
    expect(projectPackageProviderProvides(provider, "pipeline")).toBe(false);
  });

  it("reports the entities the package covers", () => {
    expect(projectPackageProviderCovers(provider, "media")).toBe(true);
    expect(projectPackageProviderCovers(provider, "document")).toBe(false);
  });

  it("counts the provided components", () => {
    expect(projectPackageProviderComponentCount(provider)).toBe(2);
  });

  it("accepts a provider without a template", () => {
    const bare: ProjectPackageProvider = defineProjectPackageProvider({ package: makePackage() });
    expect(bare.template).toBeUndefined();
  });
});
