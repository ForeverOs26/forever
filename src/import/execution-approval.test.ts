import { describe, expect, it } from "vitest";

import {
  EXECUTION_APPROVAL_MAX_LIFETIME_MS,
  InMemoryApprovalRegistry,
  validateExecutionApproval,
  type ExecutionApprovalScope,
  type ImportExecutionApproval,
} from "./execution-approval";

const NOW = new Date("2026-07-15T12:00:00Z");

const SCOPE: ExecutionApprovalScope = {
  projectSlug: "coralina",
  target: "local",
  targetProjectId: "forever-local",
  planHash: "a".repeat(64),
  operationCount: 405,
  collisionReportFingerprint: "f".repeat(64),
};

function approval(overrides: Partial<ImportExecutionApproval> = {}): ImportExecutionApproval {
  return {
    schemaVersion: "1",
    approvalId: "approval-1",
    projectSlug: SCOPE.projectSlug,
    target: SCOPE.target,
    targetProjectId: SCOPE.targetProjectId,
    planHash: SCOPE.planHash,
    operationCount: SCOPE.operationCount,
    collisionReportFingerprint: SCOPE.collisionReportFingerprint,
    issuedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    ...overrides,
  };
}

function validate(candidate: unknown) {
  return validateExecutionApproval(candidate, SCOPE, NOW);
}

describe("RC5.5C execution approval contract", () => {
  it("accepts a fully matching, in-window, unused approval", () => {
    expect(validate(approval())).toMatchObject({ ok: true });
  });

  it.each([
    ["missing", null, "approval_missing"],
    ["undefined", undefined, "approval_missing"],
    ["non-object", "approve!", "approval_malformed"],
    ["array", [], "approval_malformed"],
    [
      "unsupported schema",
      approval({ schemaVersion: "2" as never }),
      "approval_schema_unsupported",
    ],
    ["empty approvalId", approval({ approvalId: "" }), "approval_malformed"],
    ["non-integer count", approval({ operationCount: 404.5 }), "approval_malformed"],
    ["unparseable issuedAt", approval({ issuedAt: "not-a-date" }), "approval_malformed"],
    [
      "expiry before issue",
      approval({ expiresAt: new Date(NOW.getTime() - 90_000).toISOString() }),
      "approval_malformed",
    ],
  ])("fails closed on a %s artifact", (_label, candidate, code) => {
    expect(validate(candidate)).toEqual({ ok: false, code });
  });

  it("rejects an approval that is not yet valid", () => {
    const notYet = approval({
      issuedAt: new Date(NOW.getTime() + 60_000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    });
    expect(validate(notYet)).toEqual({ ok: false, code: "approval_not_yet_valid" });
  });

  it("rejects an expired approval", () => {
    const expired = approval({
      issuedAt: new Date(NOW.getTime() - 120_000).toISOString(),
      expiresAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    expect(validate(expired)).toEqual({ ok: false, code: "approval_expired" });
  });

  it("rejects an approval whose lifetime exceeds the short-lived maximum", () => {
    const longLived = approval({
      expiresAt: new Date(
        Date.parse(approval().issuedAt) + EXECUTION_APPROVAL_MAX_LIFETIME_MS + 1,
      ).toISOString(),
    });
    expect(validate(longLived)).toEqual({ ok: false, code: "approval_lifetime_exceeded" });
  });

  it.each([
    ["projectSlug", approval({ projectSlug: "modeva" })],
    ["target", approval({ target: "staging" })],
    ["targetProjectId", approval({ targetProjectId: "other" })],
    ["planHash", approval({ planHash: "b".repeat(64) })],
    ["operationCount", approval({ operationCount: 404 })],
    ["collisionReportFingerprint", approval({ collisionReportFingerprint: "0".repeat(64) })],
  ])("rejects a scope mismatch on %s", (field, candidate) => {
    expect(validate(candidate)).toEqual({
      ok: false,
      code: `approval_scope_mismatch:${field}`,
    });
  });

  it.each([
    ["overly long id", "a".repeat(65)],
    ["whitespace in id", "approval one"],
    ["control character in id", "approval\u0000one"],
    ["newline in id", "approval\n1"],
    ["URL-like id", "https://evil.example/steal?key=abc"],
    ["token-like id with padding", "eyJhbGciOiJIUzI1NiJ9.payload.signature+/="],
    ["empty id", ""],
  ])("fails closed as approval_malformed on an unsafe approvalId: %s", (_label, approvalId) => {
    expect(validate(approval({ approvalId }))).toEqual({ ok: false, code: "approval_malformed" });
  });

  it.each([
    ["simple", "approval-1"],
    ["uuid-like", "550e8400-e29b-41d4-a716-446655440000"],
    ["dotted", "owner.2026-07-15.001"],
    ["max length", "a".repeat(64)],
  ])("accepts a bounded safe approvalId: %s", (_label, approvalId) => {
    expect(validate(approval({ approvalId }))).toMatchObject({ ok: true });
  });
});

describe("RC5.5C approval registry — atomic single use", () => {
  it("consumeIfUnused grants exactly one success for an id", async () => {
    const registry = new InMemoryApprovalRegistry();
    expect(await registry.consumeIfUnused("approval-1")).toBe(true);
    expect(await registry.consumeIfUnused("approval-1")).toBe(false);
    expect(await registry.consumeIfUnused("approval-1")).toBe(false);
    expect(registry.isConsumed("approval-1")).toBe(true);
  });

  it("grants exactly one success across many concurrent attempts", async () => {
    const registry = new InMemoryApprovalRegistry();
    // Every attempt validates first (all pass — validation is pure), then all
    // race to consume: the atomic compare-and-set admits exactly one.
    const results = await Promise.all(
      Array.from({ length: 25 }, async () => {
        const validated = validateExecutionApproval(approval(), SCOPE, NOW);
        expect(validated.ok).toBe(true);
        await Promise.resolve(); // force interleaving between validate and consume
        return registry.consumeIfUnused("approval-1");
      }),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((granted) => !granted)).toHaveLength(24);
  });

  it("validation never consumes: an approval validated many times is still usable once", async () => {
    const registry = new InMemoryApprovalRegistry();
    for (let index = 0; index < 5; index += 1) {
      expect(validateExecutionApproval(approval(), SCOPE, NOW)).toMatchObject({ ok: true });
    }
    expect(registry.isConsumed("approval-1")).toBe(false);
    expect(await registry.consumeIfUnused("approval-1")).toBe(true);
  });
});
