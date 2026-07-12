import { describe, expect, it } from "vitest";

import * as coralina from "..";

/**
 * The Coralina integration is purely additive: it introduces a new isolated
 * module and consumes the existing foundations and advisory derivations without
 * modifying them. These smoke tests assert the public surface is wired and every
 * top-level entry point runs, so a regression in the barrel is caught here.
 */
describe("Coralina integration backward compatibility", () => {
  it("exposes the full vertical-slice surface from the barrel", () => {
    expect(typeof coralina.buildCoralinaRecord).toBe("function");
    expect(typeof coralina.buildCoralinaImportPayload).toBe("function");
    expect(typeof coralina.buildCoralinaProjectDetail).toBe("function");
    expect(typeof coralina.buildCoralinaIntegrationBundle).toBe("function");
    expect(typeof coralina.deriveCoralinaAdvisory).toBe("function");
    expect(typeof coralina.resolveCoralinaReferences).toBe("function");
    expect(typeof coralina.buildCoralinaVerification).toBe("function");
    expect(Array.isArray(coralina.CORALINA_SOURCE_DEFINITIONS)).toBe(true);
    expect(coralina.CORALINA_INTEGRATION_DEFINITION.identity.id).toBe("integ_coralina");
  });

  it("runs the whole vertical slice end-to-end without throwing", () => {
    expect(() => {
      coralina.buildCoralinaRecord();
      coralina.buildCoralinaImportPayload();
      coralina.buildCoralinaProjectDetail();
      coralina.buildCoralinaIntegrationBundle();
      coralina.deriveCoralinaAdvisory();
      coralina.resolveCoralinaReferences();
      coralina.buildCoralinaVerification();
    }).not.toThrow();
  });
});
