import { describe, expect, it } from "vitest";

import {
  defineReadinessProvider,
  readinessProviderBlockerCount,
  readinessProviderEvaluationCount,
  readinessProviderIsBlocked,
  readinessProviderProjectId,
} from "..";
import { makeContestedReadinessReport, makeReadinessReport } from "./fixtures";

describe("provider contract", () => {
  it("defineReadinessProvider is the identity and preserves inference", () => {
    const provider = defineReadinessProvider({ report: makeReadinessReport() });
    expect(provider.report.id).toBe("rrep_coralina");
  });

  it("exposes headline description without executing anything", () => {
    const ready = defineReadinessProvider({ report: makeReadinessReport() });
    expect(readinessProviderProjectId(ready)).toBe("proj_coralina");
    expect(readinessProviderEvaluationCount(ready)).toBe(6);
    expect(readinessProviderBlockerCount(ready)).toBe(0);
    expect(readinessProviderIsBlocked(ready)).toBe(false);

    const blocked = defineReadinessProvider({ report: makeContestedReadinessReport() });
    expect(readinessProviderBlockerCount(blocked)).toBeGreaterThan(0);
    expect(readinessProviderIsBlocked(blocked)).toBe(true);
  });
});
