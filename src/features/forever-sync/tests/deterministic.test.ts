import { describe, expect, it } from "vitest";

import {
  createSyncResult,
  deriveSyncOutcome,
  emptySyncStats,
  validateSyncPlan,
  type SyncPlan,
} from "..";
import { makeJob, makeMetadata, makePolicy, makeSchedule, makeTrigger } from "./fixtures";

describe("deterministic foundation", () => {
  it("derivation returns equal output for equal input", () => {
    const stats = { ...emptySyncStats(), total: 3, synced: 2, failed: 1, errors: 1 };
    expect(deriveSyncOutcome(stats)).toBe(deriveSyncOutcome(stats));
    expect(deriveSyncOutcome(stats)).toBe("partial");
  });

  it("createSyncResult is a pure function of its arguments", () => {
    const args = {
      data: [1, 2, 3],
      stats: { ...emptySyncStats(), total: 3, synced: 3 },
      metadata: makeMetadata({ recordCount: 3 }),
    };
    const a = createSyncResult(args);
    const b = createSyncResult(args);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("validateSyncPlan is a pure function of its plan", () => {
    const plan: SyncPlan = {
      job: makeJob({ policyId: "policy-1", triggerIds: ["trigger-1"] }),
      policy: makePolicy(),
      schedules: [makeSchedule()],
      triggers: [makeTrigger({ id: "trigger-1", kind: "scheduled", scheduleId: "schedule-1" })],
    };
    const a = validateSyncPlan(plan);
    const b = validateSyncPlan(plan);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not mutate the plan it validates", () => {
    const plan: SyncPlan = {
      job: makeJob(),
      policy: makePolicy(),
      payload: { media: [] },
    };
    const snapshot = structuredClone(plan);
    validateSyncPlan(plan);
    expect(plan).toEqual(snapshot);
  });
});
