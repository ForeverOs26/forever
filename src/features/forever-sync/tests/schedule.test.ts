import { describe, expect, it } from "vitest";

import { validateSyncSchedule, validateSyncTrigger } from "..";
import { makeSchedule, makeTrigger } from "./fixtures";

describe("validateSyncSchedule", () => {
  it("passes an interval schedule with a positive interval", () => {
    expect(validateSyncSchedule(makeSchedule())).toEqual([]);
  });

  it("requires a cronExpression for a cron schedule but never parses it", () => {
    expect(
      validateSyncSchedule(makeSchedule({ kind: "cron", intervalSeconds: undefined })),
    ).toEqual([expect.objectContaining({ code: "missing_cron_expression" })]);
    // An opaque, even nonsensical, cron string is accepted — it is never evaluated.
    expect(validateSyncSchedule({ id: "s", kind: "cron", cronExpression: "*/5 not-real" })).toEqual(
      [],
    );
  });

  it("requires a positive interval for an interval schedule", () => {
    const issues = validateSyncSchedule(makeSchedule({ intervalSeconds: 0 }));
    expect(issues.map((i) => i.code)).toContain("invalid_interval");
  });

  it("requires runAt for a once schedule", () => {
    const issues = validateSyncSchedule({ id: "s", kind: "once" });
    expect(issues.map((i) => i.code)).toContain("missing_run_at");
  });

  it("accepts a manual schedule with no timing field", () => {
    expect(validateSyncSchedule({ id: "s", kind: "manual" })).toEqual([]);
  });
});

describe("validateSyncTrigger", () => {
  it("passes a manual trigger", () => {
    expect(validateSyncTrigger(makeTrigger())).toEqual([]);
  });

  it("requires a resolvable schedule for a scheduled trigger", () => {
    const missing = validateSyncTrigger(makeTrigger({ kind: "scheduled" }));
    expect(missing.map((i) => i.code)).toContain("missing_trigger_schedule");

    const unresolved = validateSyncTrigger(
      makeTrigger({ kind: "scheduled", scheduleId: "ghost" }),
      new Set(["schedule-1"]),
    );
    expect(unresolved.map((i) => i.code)).toContain("unresolved_schedule");

    const resolved = validateSyncTrigger(
      makeTrigger({ kind: "scheduled", scheduleId: "schedule-1" }),
      new Set(["schedule-1"]),
    );
    expect(resolved).toEqual([]);
  });

  it("warns (not errors) when a webhook trigger names no event", () => {
    const issues = validateSyncTrigger(makeTrigger({ kind: "webhook" }));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("missing_trigger_event");
    expect(issues[0].severity).toBe("warning");
  });
});
