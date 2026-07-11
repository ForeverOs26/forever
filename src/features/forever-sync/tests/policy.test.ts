import { describe, expect, it } from "vitest";

import { defaultSyncPolicy, validateSyncPolicy } from "..";
import { makePolicy } from "./fixtures";

describe("defaultSyncPolicy", () => {
  it("is a conservative, dry-run-only, no-delete policy", () => {
    const policy = defaultSyncPolicy();
    expect(policy.dryRunOnly).toBe(true);
    expect(policy.allowDeletes).toBe(false);
    expect(policy.conflictStrategy).toBe("manual");
    expect(policy.retry).toEqual({ maxAttempts: 1, backoff: "none" });
  });

  it("returns a fresh object each call and applies overrides", () => {
    const a = defaultSyncPolicy();
    const b = defaultSyncPolicy({ conflictStrategy: "source_wins" });
    expect(a).not.toBe(b);
    expect(b.conflictStrategy).toBe("source_wins");
    expect(a.conflictStrategy).toBe("manual");
  });
});

describe("validateSyncPolicy", () => {
  it("passes a well-formed policy", () => {
    expect(validateSyncPolicy(makePolicy())).toEqual([]);
  });

  it("flags a missing id", () => {
    const issues = validateSyncPolicy(makePolicy({ id: "" }));
    expect(issues.map((i) => i.code)).toContain("missing_policy_id");
  });

  it("flags an invalid retry budget", () => {
    const issues = validateSyncPolicy(makePolicy({ retry: { maxAttempts: 0, backoff: "none" } }));
    expect(issues.map((i) => i.code)).toContain("invalid_retry");
  });

  it("flags a negative retry delay and a non-positive batch size", () => {
    const issues = validateSyncPolicy(
      makePolicy({ retry: { maxAttempts: 2, backoff: "fixed", initialDelayMs: -1 }, batchSize: 0 }),
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("invalid_retry_delay");
    expect(codes).toContain("invalid_batch_size");
  });
});
