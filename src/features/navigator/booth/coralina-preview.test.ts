import { describe, expect, it } from "vitest";

import { isDemoPreviewEnabled } from "@/features/project-detail/demo-preview";

/**
 * Booth and website read the catalogue through the same ProjectService, whose
 * demo-preview adapter is the ONLY source of the Coralina record. This asserts
 * the boundary the booth relies on: Coralina appears only in local development,
 * and production behavior excludes it. Coralina is never published here.
 */
describe("Coralina is available only in local development preview", () => {
  it("is enabled in local Vite development", () => {
    expect(isDemoPreviewEnabled({ DEV: true })).toBe(true);
  });

  it("is excluded in production behavior", () => {
    expect(isDemoPreviewEnabled({ DEV: false })).toBe(false);
  });

  it("can be explicitly disabled even in development", () => {
    expect(isDemoPreviewEnabled({ DEV: true, VITE_ENABLE_DEMO_PREVIEW: "false" })).toBe(false);
  });
});
