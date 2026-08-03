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

describe("manual Retry source-level separation contract", () => {
  it("double-click has a synchronous per-job mutex before the mutation", () => {
    const start = dashboard.slice(
      dashboard.indexOf("const startOwnerRetry"),
      dashboard.indexOf("const refreshOwnerRetryStatus"),
    );
    expect(start).toMatch(/if \(retryLocksRef\.current\.has\(job\.id\)\) return/);
    expect(start.indexOf("retryLocksRef.current.add(job.id)")).toBeLessThan(
      start.indexOf("retryJob.mutateAsync"),
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
    expect(dashboard).toContain("retryTimersRef.current.set(jobId, timers)");
  });

  it("timeout is read-only and never submits another controlled Retry", () => {
    const timeout = dashboard.slice(
      dashboard.indexOf("const markOwnerRetryTimeout"),
      dashboard.indexOf("const observeOwnerRetry"),
    );
    expect(timeout).not.toContain("retryJob");
    expect(timeout).not.toContain("studioProcessJob");
    expect(timeout).toContain('phase: "timeout"');
  });
});
