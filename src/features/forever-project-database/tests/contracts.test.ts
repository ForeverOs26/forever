import { describe, expect, it } from "vitest";

import {
  ProjectRegistry,
  defineProjectProvider,
  projectProviderCovers,
  projectProviderFieldCount,
  projectProviderProjectId,
  projectProviderRevisionCount,
} from "..";
import { makeRecord } from "./fixtures";

describe("ProjectProvider contract", () => {
  it("pins an implementation without changing it", () => {
    const provider = defineProjectProvider({ record: makeRecord() });
    expect(provider.record.identity.projectId).toBe("proj_coralina");
    const passthrough = { record: makeRecord(), extra: "kept" };
    expect(defineProjectProvider(passthrough)).toBe(passthrough);
  });

  it("answers the headline questions from the record alone", () => {
    const provider = defineProjectProvider({ record: makeRecord() });
    expect(projectProviderProjectId(provider)).toBe("proj_coralina");
    expect(projectProviderCovers(provider, "pricing")).toBe(true);
    expect(projectProviderCovers(provider, "legal")).toBe(false);
    expect(projectProviderFieldCount(provider)).toBe(1);
    expect(projectProviderRevisionCount(provider)).toBe(1);
  });

  it("plugs into the registry as the open/closed seam", () => {
    const provider = defineProjectProvider({ record: makeRecord() });
    const registry = new ProjectRegistry().register(provider.record);
    expect(registry.resolve(projectProviderProjectId(provider))).toBe(provider.record);
  });
});
