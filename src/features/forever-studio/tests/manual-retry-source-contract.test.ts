import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const dashboard = readFileSync(
  resolve(process.cwd(), "src/features/forever-studio/components/StudioDashboard.tsx"),
  "utf8",
);
const timing = readFileSync(
  resolve(process.cwd(), "src/features/forever-studio/components/manual-retry-observation.ts"),
  "utf8",
);

const startOwnerRetry = dashboard.slice(
  dashboard.indexOf("const startOwnerRetry"),
  dashboard.indexOf("const refreshOwnerRetryStatus"),
);

describe("manual Retry source-level separation contract", () => {
  it("double-click has a synchronous per-job mutex before the mutation", () => {
    expect(startOwnerRetry).toMatch(/if \(retryLocksRef\.current\.has\(job\.id\)\) return/);
    expect(startOwnerRetry.indexOf("retryLocksRef.current.add(job.id)")).toBeLessThan(
      startOwnerRetry.indexOf("retryJob.mutateAsync"),
    );
  });

  it("pending and observing actions keep their own Retry control disabled", () => {
    expect(dashboard).toContain("disabled={ownerRetryIsBusy(ownerRetry)}");
    expect(timing).toMatch(/phase === "submitting" \|\| view\?\.phase === "observing"/);
  });

  it("action polling calls only the exact-job read endpoint", () => {
    const observer = dashboard.slice(
      dashboard.indexOf("const observeOwnerRetry"),
      dashboard.indexOf("const startOwnerRetry"),
    );
    expect(observer).toContain("studioGetJobStatus({ data: { jobId } })");
    expect(observer).not.toContain("studioResumePending");
    expect(observer).not.toContain("studioProcessJob");
    expect(observer).not.toContain("activeJobs");
  });

  it("query refreshes cannot derive or start an observation loop", () => {
    expect(dashboard).not.toMatch(/useEffect\([\s\S]{0,500}observeOwnerRetry/);
    expect(dashboard).toContain("retryTimersRef.current.set(job.id, timers)");
  });

  it("timeout is read-only and never submits another controlled Retry", () => {
    const timeout = dashboard.slice(
      dashboard.indexOf("const markOwnerRetryTimeout"),
      dashboard.indexOf("const expireOwnerRetry"),
    );
    expect(timeout).not.toContain("retryJob");
    expect(timeout).not.toContain("studioProcessJob");
    expect(timeout).toContain('phase: "timeout"');
    // The per-job lock survives the timeout: only a read-only Refresh that
    // observes a retryable failure may release it.
    expect(timeout).not.toContain("retryLocksRef.current.delete");
  });
});

/**
 * FOREVER-PR134-REPAIR-ISOLATION-AND-ABSOLUTE-DEADLINE-001 — PART 3.
 *
 * The deadline's ORDERING is a source-level property. A test that only advances
 * timers cannot distinguish "armed before the request" from "armed after a fast
 * response", so the ordering is asserted where the decision is actually made.
 */
describe("the Retry action owns one absolute deadline", () => {
  it("arms the deadline before awaiting the mutation", () => {
    const armed = startOwnerRetry.indexOf("deadlineTimer: setTimeout(");
    const submitted = startOwnerRetry.indexOf("retryJob.mutateAsync");
    expect(armed).toBeGreaterThan(-1);
    expect(submitted).toBeGreaterThan(-1);
    expect(armed).toBeLessThan(submitted);
    expect(startOwnerRetry).toContain("expireOwnerRetry(job.id)");
    expect(startOwnerRetry).toContain("STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs");
  });

  it("observation inherits the action's timers instead of creating new ones", () => {
    const observer = dashboard.slice(
      dashboard.indexOf("const observeOwnerRetry"),
      dashboard.indexOf("const startOwnerRetry"),
    );
    expect(observer).toContain("timers: OwnerRetryTimers");
    expect(observer).not.toContain("deadlineTimer: setTimeout(");
    expect(observer).not.toContain("totalTimeoutMs");
  });

  it("treats a response arriving after the deadline as stale", () => {
    const staleGuard =
      "if (retryTimersRef.current.get(job.id) !== timers || timers.expired) return";
    const resolved = startOwnerRetry.indexOf("const result = await retryJob.mutateAsync");
    const guarded = startOwnerRetry.indexOf(staleGuard);
    const observe = startOwnerRetry.indexOf("observeOwnerRetry(job.id, result, timers)");
    expect(resolved).toBeGreaterThan(-1);
    expect(guarded).toBeGreaterThan(resolved);
    expect(observe).toBeGreaterThan(guarded);
    // Both settlement paths are guarded, not only the resolved one.
    expect(startOwnerRetry.split(staleGuard).length - 1).toBe(2);
  });

  it("expiry cancels locally and never treats cancellation as a server outcome", () => {
    const expire = dashboard.slice(
      dashboard.indexOf("const expireOwnerRetry"),
      dashboard.indexOf("const observeOwnerRetry"),
    );
    expect(expire).toContain("timers.expired = true");
    expect(expire).toContain("timers.abort?.abort()");
    expect(expire).toContain("markOwnerRetryTimeout(jobId)");
    expect(expire).not.toContain("retryJob");
    expect(expire).not.toMatch(/status: "failed"/);
  });

  it("the closed timing contract documents one absolute action deadline", () => {
    expect(timing).toMatch(/ONE ABSOLUTE DEADLINE/);
    expect(timing).toMatch(/before the mutation is sent/);
  });
});
