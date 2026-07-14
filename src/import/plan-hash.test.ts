import { describe, expect, it } from "vitest";

import { createDryRunReceipt, fingerprintImportPlan } from "./plan-hash";
import type { ImportOperation, ImportPlan } from "./types";

function makePlan(
  operations: ImportOperation[] = [
    {
      entity: "project",
      action: "upsert",
      naturalKey: "example",
      payload: { slug: "example", nested: { beta: 2, alpha: 1 } },
    },
    {
      entity: "building",
      action: "upsert",
      naturalKey: "example:A",
      dependsOn: ["project"],
      payload: { buildingCode: "A", name: "Building A" },
    },
  ],
  mode: ImportPlan["mode"] = "dry-run",
): ImportPlan {
  return {
    projectSlug: "example",
    mode,
    manifest: { source_version: "1.2.3" },
    buildings: [{ buildingCode: "A", name: "Building A" }],
    units: [],
    priceHistoryRows: [],
    operations,
    rollback: {
      supported: mode === "execute",
      strategy: mode === "execute" ? "compensating_actions" : "not_required",
      steps: [],
      notes: [mode, new Date().toISOString()],
    },
  } as unknown as ImportPlan;
}

describe("import plan fingerprint", () => {
  it("is stable for repeated identical plans", () => {
    const plan = makePlan();
    expect(fingerprintImportPlan(plan)).toEqual(fingerprintImportPlan(plan));
  });

  it("is identical for dry-run and execute plans with the same operations", () => {
    expect(fingerprintImportPlan(makePlan()).hash).toBe(
      fingerprintImportPlan(makePlan(undefined, "execute")).hash,
    );
  });

  it("canonicalizes object key order recursively", () => {
    const reversed = makePlan([
      {
        entity: "project",
        action: "upsert",
        naturalKey: "example",
        payload: { nested: { alpha: 1, beta: 2 }, slug: "example" },
      },
      makePlan().operations[1],
    ]);
    expect(fingerprintImportPlan(reversed).hash).toBe(fingerprintImportPlan(makePlan()).hash);
  });

  it("changes when operation order changes", () => {
    const plan = makePlan();
    expect(fingerprintImportPlan(makePlan([...plan.operations].reverse())).hash).not.toBe(
      fingerprintImportPlan(plan).hash,
    );
  });

  it("changes when one payload field changes", () => {
    const changed = makePlan();
    changed.operations[0] = {
      ...changed.operations[0],
      payload: { slug: "example", nested: { beta: 3, alpha: 1 } },
    };
    expect(fingerprintImportPlan(changed).hash).not.toBe(fingerprintImportPlan(makePlan()).hash);
  });

  it("changes when source version changes", () => {
    const changed = makePlan();
    changed.manifest.source_version = "1.2.4";
    expect(fingerprintImportPlan(changed).hash).not.toBe(fingerprintImportPlan(makePlan()).hash);
  });

  it("changes when canonical operation counts change", () => {
    const changed = makePlan();
    changed.buildings = [];
    expect(fingerprintImportPlan(changed).hash).not.toBe(fingerprintImportPlan(makePlan()).hash);
  });

  it("keeps generated receipt timestamps outside the plan hash", () => {
    const fingerprint = fingerprintImportPlan(makePlan());
    const first = createDryRunReceipt(fingerprint, new Date("2026-07-13T00:00:00.000Z"));
    const second = createDryRunReceipt(fingerprint, new Date("2026-07-13T01:00:00.000Z"));
    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.planSha256).toBe(second.planSha256);
  });
});
