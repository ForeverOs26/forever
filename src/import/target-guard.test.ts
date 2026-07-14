import { describe, expect, it } from "vitest";

import type { PlanFingerprint } from "./plan-hash";
import { runImportPreflight, type ImportPreflightInput } from "./target-guard";

const fingerprint: PlanFingerprint = {
  algorithm: "sha256",
  schemaVersion: "1",
  hash: "a".repeat(64),
  shortHash: "a".repeat(12),
  projectSlug: "coralina",
  sourceVersion: "2.0.0",
  operationCounts: {
    projects: 1,
    buildings: 8,
    units: 198,
    priceHistoryRows: 198,
    operations: 405,
  },
};

function validInput(overrides: Partial<ImportPreflightInput> = {}): ImportPreflightInput {
  return {
    requestedTarget: "local",
    requestedProjectSlug: "coralina",
    actualPlanFingerprint: fingerprint,
    expectedFullPlanHash: fingerprint.hash,
    expectedOperationCounts: fingerprint.operationCounts,
    manifestSourceVersion: fingerprint.sourceVersion,
    confirmation: `coralina:${fingerprint.shortHash}`,
    targetIdentity: { projectId: "forever-local" },
    ...overrides,
  };
}

describe("import target preflight", () => {
  it.each([
    ["missing target", { requestedTarget: undefined }, "target_missing"],
    ["unknown target", { requestedTarget: "preview" }, "target_unknown"],
    ["production", { requestedTarget: "production" }, "production_blocked"],
    ["unconfigured staging", { requestedTarget: "staging" }, "staging_unconfigured"],
    [
      "invalid local identity",
      { targetIdentity: { projectId: "remote" } },
      "local_identity_invalid",
    ],
    ["slug mismatch", { requestedProjectSlug: "modeva" }, "project_slug_mismatch"],
    ["full hash mismatch", { expectedFullPlanHash: "b".repeat(64) }, "plan_hash_mismatch"],
    ["confirmation mismatch", { confirmation: "coralina:wrong" }, "confirmation_mismatch"],
  ])("blocks %s", (_label, overrides, code) => {
    expect(runImportPreflight(validInput(overrides))).toMatchObject({ ok: false, code });
  });

  it("blocks an operation-count mismatch", () => {
    expect(
      runImportPreflight(
        validInput({
          expectedOperationCounts: { ...fingerprint.operationCounts, operations: 404 },
        }),
      ),
    ).toMatchObject({ ok: false, code: "operation_counts_mismatch" });
  });

  it("passes a valid local-only preflight", () => {
    expect(runImportPreflight(validInput())).toEqual({ ok: true, target: "local" });
  });
});
