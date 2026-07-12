import { describe, expect, it } from "vitest";

import {
  deriveProjectIntegrationOutcome,
  deriveProjectIntegrationState,
  emptyProjectIntegrationStats,
} from "@/features/forever-project-integration";

import {
  FOREVER_PROJECT_FACTORY_ID,
  createFactoryResult,
  deriveFactoryOutcome,
  deriveFactoryState,
  emptyFactoryStats,
  factoryError,
  factoryWarning,
} from "..";
import type { FactoryBuildMetadata } from "..";

const metadata: FactoryBuildMetadata = {
  factoryId: FOREVER_PROJECT_FACTORY_ID,
  stageCount: 4,
  stepCount: 8,
  entityCount: 1,
};

describe("factory results", () => {
  it("reuses the RC4.0 stats shape and derivation rules verbatim", () => {
    expect(emptyFactoryStats).toBe(emptyProjectIntegrationStats);
    expect(deriveFactoryState).toBe(deriveProjectIntegrationState);
    expect(deriveFactoryOutcome).toBe(deriveProjectIntegrationOutcome);
    expect(emptyFactoryStats()).toEqual({
      stages: 0,
      steps: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      warnings: 0,
      errors: 0,
    });
  });

  it("reconciles the stats counters from the issues so they can never drift", () => {
    const result = createFactoryResult({
      data: ["described"],
      issues: [factoryError("boom", "Blocked"), factoryWarning("hmm", "Noted")],
      stats: { ...emptyFactoryStats(), steps: 2, completed: 2 },
      metadata,
    });
    expect(result.ok).toBe(false);
    expect(result.stats.errors).toBe(1);
    expect(result.stats.warnings).toBe(1);
    expect(result.errors.map((error) => error.code)).toEqual(["boom"]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["hmm"]);
  });

  it("derives succeeded/success for a clean completed plan", () => {
    const result = createFactoryResult({
      data: ["described"],
      stats: { ...emptyFactoryStats(), stages: 4, steps: 8, completed: 8 },
      metadata,
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("succeeded");
    expect(result.outcome).toBe("success");
  });

  it("derives failed/failure when nothing completed and partial when something did", () => {
    const failed = createFactoryResult({
      data: [],
      issues: [factoryError("boom", "Blocked")],
      stats: emptyFactoryStats(),
      metadata,
    });
    expect(failed.state).toBe("failed");
    expect(failed.outcome).toBe("failure");

    const partial = createFactoryResult({
      data: ["described"],
      issues: [factoryError("boom", "Blocked")],
      stats: { ...emptyFactoryStats(), steps: 8, completed: 7, failed: 1 },
      metadata,
    });
    expect(partial.state).toBe("partial");
    expect(partial.outcome).toBe("partial");
  });
});
