import { describe, expect, it } from "vitest";

import type { ForeverMedia } from "@/features/forever-database";

import { validateSyncJob, validateSyncPlan, type SyncPlan } from "..";
import { makeJob, makePolicy, makeSchedule, makeSource, makeTarget, makeTrigger } from "./fixtures";

const media: ForeverMedia = {
  id: "m-1",
  projectId: "p-1",
  mediaType: "gallery_image",
  title: "Pool",
  url: "https://cdn.example.com/pool.jpg",
  sortOrder: 0,
  isPublic: true,
};

describe("validateSyncJob", () => {
  it("passes a well-formed job", () => {
    expect(validateSyncJob(makeJob())).toEqual([]);
  });

  it("flags identical source and target endpoints", () => {
    const shared = makeSource({ id: "same" });
    const job = makeJob({ source: shared, target: makeTarget({ id: "same" }) });
    expect(validateSyncJob(job).map((i) => i.code)).toContain("identical_endpoints");
  });

  it("flags a missing endpoint label", () => {
    const job = makeJob({ target: makeTarget({ label: "" }) });
    expect(validateSyncJob(job).map((i) => i.path)).toContain("target.label");
  });
});

describe("validateSyncPlan", () => {
  it("passes a coherent plan with resolvable cross-references", () => {
    const plan: SyncPlan = {
      job: makeJob({ policyId: "policy-1", triggerIds: ["trigger-1"] }),
      policy: makePolicy(),
      schedules: [makeSchedule()],
      triggers: [makeTrigger({ id: "trigger-1", kind: "scheduled", scheduleId: "schedule-1" })],
    };
    const result = validateSyncPlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("flags a policyId that does not match the supplied policy", () => {
    const plan: SyncPlan = {
      job: makeJob({ policyId: "other" }),
      policy: makePolicy({ id: "policy-1" }),
    };
    expect(validateSyncPlan(plan).errors.map((e) => e.code)).toContain("unresolved_policy");
  });

  it("flags a triggerId that resolves to no trigger", () => {
    const plan: SyncPlan = {
      job: makeJob({ triggerIds: ["ghost"] }),
      triggers: [makeTrigger({ id: "trigger-1" })],
    };
    expect(validateSyncPlan(plan).errors.map((e) => e.code)).toContain("unresolved_trigger");
  });

  it("delegates payload integrity to the RC3.1 import pipeline", () => {
    const plan: SyncPlan = {
      job: makeJob({ entityKind: "media" }),
      payload: { media: [media] },
    };
    // The media references project "p-1", which is neither in the payload nor
    // the scope, so the reused import validation raises an unresolved reference.
    const unscoped = validateSyncPlan(plan);
    expect(unscoped.valid).toBe(false);
    expect(unscoped.errors.map((e) => e.code)).toContain("unresolved_reference");

    // Supplying the id via the reused reference scope resolves it.
    const scoped = validateSyncPlan({ ...plan, scope: { projectIds: new Set(["p-1"]) } });
    expect(scoped.valid).toBe(true);
  });

  it("aggregates issues from every layer in one pass", () => {
    const plan: SyncPlan = {
      job: makeJob({ id: "", policyId: "mismatch" }),
      policy: makePolicy({ id: "policy-1", retry: { maxAttempts: 0, backoff: "none" } }),
      schedules: [makeSchedule({ id: "schedule-1", kind: "cron", intervalSeconds: undefined })],
    };
    const codes = new Set(validateSyncPlan(plan).errors.map((e) => e.code));
    expect(codes.has("missing_job_id")).toBe(true);
    expect(codes.has("invalid_retry")).toBe(true);
    expect(codes.has("missing_cron_expression")).toBe(true);
    expect(codes.has("unresolved_policy")).toBe(true);
  });
});
