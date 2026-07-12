import { describe, expect, it } from "vitest";

import {
  defaultProjectIntegrationPolicy,
  validateProjectIntegrationPolicy,
} from "@/features/forever-project-integration";

import { defaultFactoryPolicy, validateFactoryPolicy } from "..";

describe("factory policy", () => {
  it("is the RC4.0 policy reused verbatim — default and guard are the same functions", () => {
    expect(defaultFactoryPolicy).toBe(defaultProjectIntegrationPolicy);
    expect(validateFactoryPolicy).toBe(validateProjectIntegrationPolicy);
  });

  it("defaults to the safe posture: sequential, abort, no retry, dry-run only", () => {
    expect(defaultFactoryPolicy()).toEqual({
      id: "default",
      executionMode: "sequential",
      onError: "abort",
      retry: { maxAttempts: 1, backoff: "none" },
      dryRunOnly: true,
    });
  });

  it("lets callers override only what they need, and flags an unknown mode", () => {
    const policy = defaultFactoryPolicy({ executionMode: "parallel", maxConcurrency: 2 });
    expect(policy.executionMode).toBe("parallel");
    expect(policy.onError).toBe("abort");
    expect(validateFactoryPolicy(policy)).toEqual([]);

    const bad = defaultFactoryPolicy({ executionMode: "warp" as never });
    expect(validateFactoryPolicy(bad).map((issue) => issue.code)).toContain(
      "unknown_execution_mode",
    );
  });
});
