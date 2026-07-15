import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { fingerprintCollisionReport, type CollisionInspectionReport } from "./collision-inspector";
import { ExecutionFailure } from "./execution-adapter";
import { computeApprovalDigest, InMemoryApprovalRegistry } from "./execution-approval";
import { logExecutionReceipt } from "./logger";
import {
  executeApprovedImportPlan,
  validateExecutionOrdering,
  type ExecuteApprovedImportInput,
} from "./transaction-executor";
import {
  buildingOperation,
  coralinaHermeticOperations,
  priceOperation,
  projectOperation,
  unitOperation,
} from "./test-fixtures/collision-fixtures";
import {
  absentCollisionReport,
  approvalFor,
  executionInput,
  FakeTransactionRunner,
  seededStore,
  type FakeRunnerConfig,
} from "./test-fixtures/execution-fixtures";
import type { ImportOperation } from "./types";

const SMALL_OPS: ImportOperation[] = [
  projectOperation(),
  buildingOperation("A"),
  unitOperation("A-1", { buildingCode: "A" }),
  priceOperation("A-1", { buildingCode: "A" }),
];

async function setup(operations: ImportOperation[], config: FakeRunnerConfig = {}) {
  const report = await absentCollisionReport(operations);
  const runner = new FakeTransactionRunner(config);
  const registry = new InMemoryApprovalRegistry();
  const approval = approvalFor(operations, report);
  const input = {
    ...executionInput(operations, report, runner),
    approval,
    approvalRegistry: registry,
  } as ExecuteApprovedImportInput;
  return { report, runner, registry, approval, input };
}

describe("RC5.5C transaction executor — happy path", () => {
  it("commits a small approved plan atomically with a deterministic receipt", async () => {
    const { runner, input } = await setup(SMALL_OPS);
    const receipt = await executeApprovedImportPlan(input);

    expect(receipt.outcome).toBe("committed");
    expect(receipt.commitConfirmed).toBe(true);
    expect(receipt.rollbackConfirmed).toBe(false);
    expect(receipt.totalOperationsAttempted).toBe(4);
    expect(receipt.totalOperationsApplied).toBe(4);
    expect(receipt.writesPerformed).toBe(4);
    expect(receipt.reasonCodes).toEqual([]);
    expect(receipt.approvalConsumed).toBe(true);
    expect(receipt.executeEnabled).toBe(false);

    expect(runner.committedStore.projects).toHaveLength(1);
    expect(runner.committedStore.buildings).toHaveLength(1);
    expect(runner.committedStore.units).toHaveLength(1);
    expect(runner.committedStore.priceHistory).toHaveLength(1);
    // The written unit is linked to the written building and project.
    const unit = runner.committedStore.units[0];
    expect(unit.project_id).toBe(runner.committedStore.projects[0].id);
    expect(unit.building_id).toBe(runner.committedStore.buildings[0].id);
  });

  it("commits the 405-operation Coralina-shaped plan and applies every operation", async () => {
    const operations = coralinaHermeticOperations();
    const { runner, input } = await setup(operations);
    const receipt = await executeApprovedImportPlan(input);

    expect(receipt.outcome).toBe("committed");
    expect(receipt.totalOperationsApplied).toBe(405);
    expect(runner.committedStore.projects).toHaveLength(1);
    expect(runner.committedStore.buildings).toHaveLength(8);
    expect(runner.committedStore.units).toHaveLength(198);
    expect(runner.committedStore.priceHistory).toHaveLength(198);
  });

  it("applies operations in canonical order: dependencies read first, then project, buildings, units, prices", async () => {
    const { runner, input } = await setup(SMALL_OPS);
    await executeApprovedImportPlan(input);

    const writes = runner.txCalls.filter((call) => call.startsWith("insert"));
    expect(writes).toEqual(["insertProject", "insertBuilding", "insertUnit", "insertPriceHistory"]);
    const firstWrite = runner.txCalls.indexOf("insertProject");
    expect(runner.txCalls.indexOf("readDeveloper")).toBeLessThan(firstWrite);
    expect(runner.txCalls.indexOf("readLocation")).toBeLessThan(firstWrite);
    expect(runner.txCalls.indexOf("readProject")).toBeLessThan(firstWrite);
  });

  it("produces byte-identical receipts for identical executions", async () => {
    const first = await setup(SMALL_OPS);
    const second = await setup(SMALL_OPS);
    const receiptA = await executeApprovedImportPlan(first.input);
    const receiptB = await executeApprovedImportPlan(second.input);
    expect(JSON.stringify(receiptA)).toBe(JSON.stringify(receiptB));
  });
});

describe("RC5.5C transaction executor — rejected before transaction", () => {
  it("rejects an unsupported entity with zero runner and adapter calls", async () => {
    const developerOp: ImportOperation = {
      entity: "developer",
      action: "upsert",
      naturalKey: "rhom-bho-property",
      payload: { slug: "rhom-bho-property" },
    };
    const operations = [projectOperation(), developerOp];
    const { runner, registry, input } = await setup(SMALL_OPS);
    input.operations = operations;
    input.planFingerprint = {
      ...input.planFingerprint,
      operationCounts: { ...input.planFingerprint.operationCounts },
    };

    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["operation_set_invalid"]);
    expect(receipt.approvalConsumed).toBe(false);
    expect(runner.runs).toBe(0);
    expect(registry.isConsumed("approval-test-0001")).toBe(false);
  });

  it("rejects operations that violate canonical execution order", async () => {
    const outOfOrder = [
      projectOperation(),
      unitOperation("A-1", { buildingCode: "A" }),
      buildingOperation("A"),
      priceOperation("A-1", { buildingCode: "A" }),
    ];
    const { runner, input } = await setup(outOfOrder);
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["operation_order_invalid"]);
    expect(runner.runs).toBe(0);
  });

  it("rejects a failed preflight (production stays blocked) before any transaction", async () => {
    const { runner, registry, input } = await setup(SMALL_OPS);
    input.requestedTarget = "production";
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["preflight_failed:production_blocked"]);
    expect(runner.runs).toBe(0);
    expect(registry.isConsumed("approval-test-0001")).toBe(false);
  });

  it("rejects unconfigured staging before any transaction", async () => {
    const { runner, input } = await setup(SMALL_OPS);
    input.requestedTarget = "staging";
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["preflight_failed:staging_unconfigured"]);
    expect(runner.runs).toBe(0);
  });

  it("rejects a stale plan hash against the collision report", async () => {
    const { input, runner } = await setup(SMALL_OPS);
    input.collisionReport = { ...input.collisionReport, planHash: "b".repeat(64) };
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["collision_report_stale_plan"]);
    expect(runner.runs).toBe(0);
  });

  it("rejects a blocked collision report", async () => {
    const { input, runner } = await setup(SMALL_OPS);
    const blocked: CollisionInspectionReport = {
      ...input.collisionReport,
      status: "blocked",
      countsByClassification: {
        ...input.collisionReport.countsByClassification,
        absent: input.collisionReport.totalInspectedOperations - 1,
        inspection_error: 1,
      },
    };
    input.collisionReport = blocked;
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["collision_report_blocked"]);
    expect(runner.runs).toBe(0);
  });

  it.each([
    [
      "all exact_match target state",
      (report: CollisionInspectionReport) => ({
        ...report,
        countsByClassification: {
          ...report.countsByClassification,
          absent: 0,
          exact_match: report.totalInspectedOperations,
        },
      }),
    ],
    [
      "mixed absent/update_required target state",
      (report: CollisionInspectionReport) => ({
        ...report,
        countsByClassification: {
          ...report.countsByClassification,
          absent: report.totalInspectedOperations - 1,
          update_required: 1,
        },
      }),
    ],
  ])("fails closed on %s instead of silently updating", async (_label, mutate) => {
    const { input, runner } = await setup(SMALL_OPS);
    input.collisionReport = mutate(input.collisionReport) as CollisionInspectionReport;
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["target_state_not_fresh"]);
    expect(runner.runs).toBe(0);
  });

  it("rejects a stale collision fingerprint through the approval scope binding", async () => {
    const operations = SMALL_OPS;
    const report = await absentCollisionReport(operations);
    const otherReport = await absentCollisionReport([projectOperation(), buildingOperation("A")]);
    const runner = new FakeTransactionRunner();
    const registry = new InMemoryApprovalRegistry();
    // Approval was issued for a different (stale) collision report.
    const approval = approvalFor(operations, otherReport);
    const input = {
      ...executionInput(operations, report, runner),
      approval,
      approvalRegistry: registry,
    } as ExecuteApprovedImportInput;

    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["approval_scope_mismatch:collisionReportFingerprint"]);
    expect(runner.runs).toBe(0);
    expect(receipt.approvalConsumed).toBe(false);
  });

  it("rejects an expired approval before any transaction", async () => {
    const { input, runner } = await setup(SMALL_OPS);
    input.now = new Date("2026-07-15T13:00:01Z");
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["approval_expired"]);
    expect(runner.runs).toBe(0);
    expect(receipt.approvalConsumed).toBe(false);
  });

  it("rejects a reused approval and burns it after a rolled-back attempt", async () => {
    const failing = await setup(SMALL_OPS, {
      failures: [{ method: "insertUnit", error: new Error("boom") }],
    });
    const first = await executeApprovedImportPlan(failing.input);
    expect(first.outcome).toBe("rolled_back");
    expect(first.approvalConsumed).toBe(true);

    // Same approval, fresh runner: single-use is enforced by the registry.
    const retryRunner = new FakeTransactionRunner();
    const retryInput = {
      ...executionInput(SMALL_OPS, failing.report, retryRunner),
      approval: failing.approval,
      approvalRegistry: failing.registry,
    } as ExecuteApprovedImportInput;
    const second = await executeApprovedImportPlan(retryInput);
    expect(second.outcome).toBe("rejected_before_transaction");
    expect(second.reasonCodes).toEqual(["approval_reused"]);
    expect(retryRunner.runs).toBe(0);
  });
});

describe("RC5.5C transaction executor — rollback", () => {
  it("rolls back on an adapter write error with zero partial writes", async () => {
    const { runner, input } = await setup(SMALL_OPS, {
      failures: [{ method: "insertUnit", error: new Error("raw provider explosion") }],
    });
    const receipt = await executeApprovedImportPlan(input);

    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.rollbackConfirmed).toBe(true);
    expect(receipt.commitConfirmed).toBe(false);
    expect(receipt.totalOperationsApplied).toBe(0);
    expect(receipt.writesPerformed).toBe(0);
    expect(receipt.reasonCodes).toEqual(["unit_write_failed"]);
    // Nothing persisted: the committed store is untouched.
    expect(runner.committedStore.projects).toHaveLength(0);
    expect(runner.committedStore.buildings).toHaveLength(0);
    expect(runner.committedStore.units).toHaveLength(0);
  });

  it("rolls back a 405-operation plan that fails mid-way with zero partial writes", async () => {
    const operations = coralinaHermeticOperations();
    const { runner, input } = await setup(operations, {
      failures: [{ method: "insertUnit", onCall: 100, error: new Error("mid-flight failure") }],
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.totalOperationsAttempted).toBeGreaterThan(100);
    expect(receipt.totalOperationsApplied).toBe(0);
    expect(runner.committedStore.projects).toHaveLength(0);
    expect(runner.committedStore.units).toHaveLength(0);
    expect(runner.committedStore.priceHistory).toHaveLength(0);
  });

  it("rolls back when the developer dependency is missing", async () => {
    const store = seededStore();
    store.developers = [];
    const { input } = await setup(SMALL_OPS, { store });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["dependency_developer_unresolved"]);
  });

  it("rolls back when the location dependency is duplicated", async () => {
    const store = seededStore();
    store.locations.push({ ...store.locations[0], id: "loc-2" });
    const { input } = await setup(SMALL_OPS, { store });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["dependency_location_unresolved"]);
  });

  it("rolls back when the target state changed after inspection (project now exists)", async () => {
    const store = seededStore();
    store.projects.push({ id: "pre-existing", slug: "coralina" });
    const { runner, input } = await setup(SMALL_OPS, { store });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["target_state_changed"]);
    // Only the pre-existing row remains; nothing was written.
    expect(runner.committedStore.projects).toHaveLength(1);
    expect(runner.committedStore.projects[0].id).toBe("pre-existing");
  });

  it("rejects an exact repeat of a committed plan (fresh inspection would not be absent; stale one is caught in-transaction)", async () => {
    const { runner, input, report } = await setup(SMALL_OPS);
    const first = await executeApprovedImportPlan(input);
    expect(first.outcome).toBe("committed");

    // Second attempt with a NEW approval but the stale all-absent report:
    // the in-transaction fresh-state check rolls back.
    const registry = new InMemoryApprovalRegistry();
    const secondInput = {
      ...executionInput(SMALL_OPS, report, runner),
      approval: approvalFor(SMALL_OPS, report, { approvalId: "approval-test-0002" }),
      approvalRegistry: registry,
    } as ExecuteApprovedImportInput;
    const second = await executeApprovedImportPlan(secondInput);
    expect(second.outcome).toBe("rolled_back");
    expect(second.reasonCodes).toEqual(["target_state_changed"]);
    // The committed data from the first run is untouched.
    expect(runner.committedStore.units).toHaveLength(1);
  });

  it("rolls back on verification row loss", async () => {
    const { input } = await setup(SMALL_OPS, {
      tamper: { readUnits: (rows) => rows.slice(1) },
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["verification_row_missing"]);
  });

  it("rolls back on unexpected extra rows during verification", async () => {
    const { input } = await setup(SMALL_OPS, {
      tamper: { readBuildings: (rows) => [...rows, { ...rows[0], id: "bldg-extra" }] },
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["verification_extra_rows"]);
  });

  it("rolls back on a stable-field mismatch during verification", async () => {
    const { input } = await setup(SMALL_OPS, {
      tamper: {
        readUnits: (rows) => rows.map((row) => ({ ...row, size_sqm: 999 })),
      },
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["verification_field_mismatch"]);
  });

  it("rolls back on a parent mismatch during verification", async () => {
    const { input } = await setup(SMALL_OPS, {
      tamper: {
        readUnits: (rows) => rows.map((row) => ({ ...row, building_id: "bldg-foreign" })),
      },
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["verification_parent_mismatch"]);
  });

  it("rolls back when the commit itself fails", async () => {
    const { runner, input } = await setup(SMALL_OPS, { commitFails: true });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["commit_failed"]);
    expect(runner.committedStore.projects).toHaveLength(0);
  });

  it("sanitizes raw provider errors: no URL, credential, or message leaks into the receipt", async () => {
    const { input } = await setup(SMALL_OPS, {
      failures: [
        {
          method: "readDeveloper",
          error: new Error("connect http://secret.supabase.co apikey=sb_secret_leak sql=INSERT"),
        },
      ],
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["dependency_read_failed"]);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("http");
    expect(serialized).not.toContain("sb_secret");
    expect(serialized).not.toContain("INSERT");
  });

  it("collapses an ExecutionFailure carrying a non-whitelisted code to adapter_failure", async () => {
    const { input } = await setup(SMALL_OPS, {
      failures: [
        {
          // Simulates a JS caller bypassing the type system with a hostile code.
          method: "insertProject",
          error: new ExecutionFailure("UNSAFE CODE WITH http://leak" as never),
        },
      ],
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["adapter_failure"]);
  });
});

describe("RC5.5C transaction executor — untrusted reason-code boundary", () => {
  it.each([
    ["credential-like string", "sb_secret_abcdef0123456789"],
    ["URL-like string", "http://leak.example/x"],
    ["SQL text", "INSERT INTO units VALUES (1)"],
    ["provider code", "PGRST301"],
    ["long identifier", "x".repeat(500)],
    ["regex-permitted lowercase string", "connect_refused_sb_secret_key.leak-1"],
  ])("collapses an untrusted runner reason code to adapter_failure: %s", async (_label, reason) => {
    const { input } = await setup(SMALL_OPS, {
      failures: [{ method: "insertUnit", error: new Error("boom") }],
      overrideRollbackReason: reason,
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["adapter_failure"]);
    expect(JSON.stringify(receipt)).not.toContain(reason);
  });

  it("passes through a runner reason code that is literally in the closed whitelist", async () => {
    const { input } = await setup(SMALL_OPS, {
      failures: [{ method: "insertUnit", error: new Error("boom") }],
      overrideRollbackReason: "commit_failed",
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["commit_failed"]);
  });

  it("never echoes an unsafe approvalId into a rejected receipt", async () => {
    const hostileId = "https://exfil.example/?secret=sb_secret_value";
    const { input } = await setup(SMALL_OPS);
    input.approval = { approvalId: hostileId };
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["approval_schema_unsupported"]);
    expect(receipt.approvalDigest).toBeNull();
    expect(JSON.stringify(receipt)).not.toContain("exfil");
    expect(JSON.stringify(receipt)).not.toContain("sb_secret");
  });

  it("rejects an over-long approvalId as approval_malformed without echoing it", async () => {
    const longId = "a".repeat(200);
    const { input, approval } = await setup(SMALL_OPS);
    input.approval = { ...approval, approvalId: longId };
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["approval_malformed"]);
    expect(receipt.approvalDigest).toBeNull();
    expect(JSON.stringify(receipt)).not.toContain(longId);
  });
});

describe("RC5.5C transaction executor — runner-level failures are rollback-unconfirmed", () => {
  function expectUnconfirmed(receipt: {
    outcome: string;
    reasonCodes: string[];
    commitConfirmed: boolean;
    rollbackConfirmed: boolean;
    writesPerformed: number | null;
    approvalConsumed: boolean;
  }) {
    expect(receipt.outcome).toBe("failed_rollback_unconfirmed");
    expect(receipt.reasonCodes).toEqual(["runner_failure"]);
    expect(receipt.commitConfirmed).toBe(false);
    expect(receipt.rollbackConfirmed).toBe(false);
    // Truthful unknown write state: never a false zero.
    expect(receipt.writesPerformed).toBeNull();
    expect(receipt.approvalConsumed).toBe(true);
  }

  it("is rollback-unconfirmed when the runner begins a transaction and throws before invoking work", async () => {
    const { runner, registry, input } = await setup(SMALL_OPS, {
      beginThenThrow: new Error("crash after BEGIN: postgres://user:pass@host/db"),
    });
    const receipt = await executeApprovedImportPlan(input);

    // Work never ran, but a transaction may have been begun — the executor
    // must NOT claim it was rejected before a transaction.
    expectUnconfirmed(receipt);
    expect(registry.isConsumed("approval-test-0001")).toBe(true);
    expect(runner.committedStore.projects).toHaveLength(0);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("pass");
  });

  it("is rollback-unconfirmed when the runner throws before work with no phase signal", async () => {
    const { input } = await setup(SMALL_OPS, {
      throwBeforeWork: new Error("unknown infrastructure failure http://leak.example"),
    });
    const receipt = await executeApprovedImportPlan(input);
    expectUnconfirmed(receipt);
    expect(JSON.stringify(receipt)).not.toContain("http");
  });

  it("is rollback-unconfirmed when the runner throws after work ran", async () => {
    const { runner, input } = await setup(SMALL_OPS, {
      throwAfterWork: new Error("commit machinery crashed: apikey=sb_secret_leak"),
    });
    const receipt = await executeApprovedImportPlan(input);
    expectUnconfirmed(receipt);
    expect(receipt.totalOperationsApplied).toBe(0);
    expect(runner.committedStore.projects).toHaveLength(0);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("sb_secret");
    expect(serialized).not.toContain("apikey");
  });

  it("is rollback-unconfirmed on a malformed outcome returned without invoking work", async () => {
    const { input } = await setup(SMALL_OPS, {
      skipWork: true,
      malformedOutcome: { phase: "begin?", details: "http://leak" },
    });
    const receipt = await executeApprovedImportPlan(input);
    expectUnconfirmed(receipt);
    expect(JSON.stringify(receipt)).not.toContain("http");
  });

  it("is rollback-unconfirmed on a malformed outcome after work ran", async () => {
    const { input } = await setup(SMALL_OPS, {
      malformedOutcome: { outcome: "who-knows", details: "http://leak" },
    });
    const receipt = await executeApprovedImportPlan(input);
    expectUnconfirmed(receipt);
    expect(JSON.stringify(receipt)).not.toContain("http");
  });

  it("keeps rejected_before_transaction exclusively for executor gates before the runner is invoked", async () => {
    const { runner, registry, input } = await setup(SMALL_OPS);
    input.requestedTarget = "production";
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(runner.runs).toBe(0);
    expect(receipt.approvalConsumed).toBe(false);
    expect(registry.isConsumed("approval-test-0001")).toBe(false);
  });
});

describe("RC5.5C transaction executor — atomic approval consumption", () => {
  it("admits exactly one of many concurrent executions sharing one approval", async () => {
    const operations = SMALL_OPS;
    const report = await absentCollisionReport(operations);
    const registry = new InMemoryApprovalRegistry();
    const approval = approvalFor(operations, report);

    const receipts = await Promise.all(
      Array.from({ length: 6 }, () => {
        const runner = new FakeTransactionRunner();
        const input = {
          ...executionInput(operations, report, runner),
          approval,
          approvalRegistry: registry,
        } as ExecuteApprovedImportInput;
        return executeApprovedImportPlan(input);
      }),
    );

    const committed = receipts.filter((receipt) => receipt.outcome === "committed");
    const reused = receipts.filter(
      (receipt) =>
        receipt.outcome === "rejected_before_transaction" &&
        receipt.reasonCodes.join(",") === "approval_reused",
    );
    expect(committed).toHaveLength(1);
    expect(reused).toHaveLength(5);
    // The winner consumed the approval; the losers did not.
    expect(committed[0].approvalConsumed).toBe(true);
    for (const receipt of reused) expect(receipt.approvalConsumed).toBe(false);
  });

  it("still admits exactly one when the winning attempt rolls back", async () => {
    const operations = SMALL_OPS;
    const report = await absentCollisionReport(operations);
    const registry = new InMemoryApprovalRegistry();
    const approval = approvalFor(operations, report);

    const receipts = await Promise.all(
      Array.from({ length: 4 }, () => {
        const runner = new FakeTransactionRunner({
          failures: [{ method: "insertUnit", error: new Error("boom") }],
        });
        const input = {
          ...executionInput(operations, report, runner),
          approval,
          approvalRegistry: registry,
        } as ExecuteApprovedImportInput;
        return executeApprovedImportPlan(input);
      }),
    );

    expect(receipts.filter((receipt) => receipt.outcome === "rolled_back")).toHaveLength(1);
    expect(
      receipts.filter((receipt) => receipt.reasonCodes.join(",") === "approval_reused"),
    ).toHaveLength(3);
  });
});

describe("RC5.5C execution ordering validator", () => {
  it("accepts the canonical planner order", () => {
    expect(validateExecutionOrdering(coralinaHermeticOperations())).toBeNull();
  });

  it("rejects a dependency that does not point at an earlier entity", () => {
    const cyclic: ImportOperation = {
      ...buildingOperation("A"),
      dependsOn: ["unit"],
    } as ImportOperation;
    expect(validateExecutionOrdering([projectOperation(), cyclic])).toBe("dependency_cycle");
  });

  it("rejects a unit whose building is not in the plan", () => {
    const operations = [projectOperation(), unitOperation("A-1", { buildingCode: "MISSING" })];
    expect(validateExecutionOrdering(operations)).toBe("missing_parent_reference");
  });

  it("rejects a price row whose unit is not in the plan", () => {
    const operations = [projectOperation(), priceOperation("GHOST-1")];
    expect(validateExecutionOrdering(operations)).toBe("missing_parent_reference");
  });
});

describe("RC5.5C transaction executor — approval digest boundary", () => {
  const SECRET_SHAPED_IDS = [
    "approval-normal-001",
    "sk_live_ABC123",
    "sb_secret_token",
    "eyJabc.def.ghi",
    "private_api_key_123",
    "Z".repeat(64),
  ];

  it.each(SECRET_SHAPED_IDS.map((id) => [id]))(
    "never exposes the raw approvalId %s in a committed receipt or logger output",
    async (approvalId) => {
      const report = await absentCollisionReport(SMALL_OPS);
      const runner = new FakeTransactionRunner();
      const registry = new InMemoryApprovalRegistry();
      const input = {
        ...executionInput(SMALL_OPS, report, runner),
        approval: approvalFor(SMALL_OPS, report, { approvalId }),
        approvalRegistry: registry,
      } as ExecuteApprovedImportInput;

      const receipt = await executeApprovedImportPlan(input);
      expect(receipt.outcome).toBe("committed");
      expect(receipt.approvalDigest).toBe(computeApprovalDigest(approvalId));

      const serialized = JSON.stringify(receipt);
      expect(serialized).not.toContain(approvalId);

      const lines: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.join(" "));
      });
      logExecutionReceipt(receipt);
      logSpy.mockRestore();
      expect(lines.join("\n")).not.toContain(approvalId);
      expect(lines.join("\n")).toContain(receipt.approvalDigest as string);

      // Registry single-use semantics still key on the raw internal id.
      expect(registry.isConsumed(approvalId)).toBe(true);
    },
  );

  it("digest is deterministic per id and distinct across ids", () => {
    expect(computeApprovalDigest("approval-1")).toBe(computeApprovalDigest("approval-1"));
    expect(computeApprovalDigest("approval-1")).not.toBe(computeApprovalDigest("approval-2"));
    expect(computeApprovalDigest("approval-1")).toMatch(/^[0-9a-f]{64}$/);
    // Domain separation: the digest is not a plain hash of the raw id.
    expect(computeApprovalDigest("approval-1")).not.toBe(
      createHash("sha256").update("approval-1").digest("hex"),
    );
  });

  it("returns a null digest when the artifact is rejected before structural validation", async () => {
    const { input } = await setup(SMALL_OPS);
    input.approval = null;
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.reasonCodes).toEqual(["approval_missing"]);
    expect(receipt.approvalDigest).toBeNull();
  });
});

describe("RC5.5C transaction executor — exact writesPerformed semantics", () => {
  it("committed → exact applied operation count", async () => {
    const { input } = await setup(SMALL_OPS);
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("committed");
    expect(receipt.writesPerformed).toBe(4);
  });

  it("confirmed rollback → 0", async () => {
    const { input } = await setup(SMALL_OPS, {
      failures: [{ method: "insertUnit", error: new Error("boom") }],
    });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.writesPerformed).toBe(0);
  });

  it("executor gate rejection → 0", async () => {
    const { input } = await setup(SMALL_OPS);
    input.requestedTarget = "production";
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.writesPerformed).toBe(0);
  });

  it("runner throw before work → null (unknown, never a false zero)", async () => {
    const { input } = await setup(SMALL_OPS, { throwBeforeWork: new Error("x") });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("failed_rollback_unconfirmed");
    expect(receipt.writesPerformed).toBeNull();
  });

  it("runner throw after work → null", async () => {
    const { input } = await setup(SMALL_OPS, { throwAfterWork: new Error("x") });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("failed_rollback_unconfirmed");
    expect(receipt.writesPerformed).toBeNull();
  });

  it("malformed runner outcome → null", async () => {
    const { input } = await setup(SMALL_OPS, { malformedOutcome: { outcome: "?" } });
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("failed_rollback_unconfirmed");
    expect(receipt.writesPerformed).toBeNull();
  });

  it("the logger prints the unknown state as the stable word unconfirmed", async () => {
    const { input } = await setup(SMALL_OPS, { throwAfterWork: new Error("x") });
    const receipt = await executeApprovedImportPlan(input);
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
    logExecutionReceipt(receipt);
    logSpy.mockRestore();
    expect(lines.join("\n")).toContain("Writes performed: unconfirmed");
  });
});

describe("RC5.5C transaction executor — asynchronous durable-ready approval registry", () => {
  class DelayedApprovalRegistry extends InMemoryApprovalRegistry {
    async consumeIfUnused(approvalId: string): Promise<boolean> {
      // Models network latency to a durable store whose CAS itself is atomic.
      await new Promise((resolve) => setTimeout(resolve, 2));
      return super.consumeIfUnused(approvalId);
    }
  }

  class ThrowingApprovalRegistry {
    async consumeIfUnused(): Promise<boolean> {
      throw new Error(
        "registry down: postgres://svc:sb_secret_pw@registry-host/approvals SELECT 1",
      );
    }
  }

  class FalseApprovalRegistry {
    async consumeIfUnused(): Promise<boolean> {
      return false;
    }
  }

  it("commits through a delayed asynchronous registry", async () => {
    const { input } = await setup(SMALL_OPS);
    input.approvalRegistry = new DelayedApprovalRegistry();
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("committed");
    expect(receipt.approvalConsumed).toBe(true);
  });

  it("admits exactly one winner across concurrent executions on a delayed registry", async () => {
    const operations = SMALL_OPS;
    const report = await absentCollisionReport(operations);
    const registry = new DelayedApprovalRegistry();
    const approval = approvalFor(operations, report);

    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => {
        const runner = new FakeTransactionRunner();
        const input = {
          ...executionInput(operations, report, runner),
          approval,
          approvalRegistry: registry,
        } as ExecuteApprovedImportInput;
        return executeApprovedImportPlan(input);
      }),
    );

    expect(receipts.filter((receipt) => receipt.outcome === "committed")).toHaveLength(1);
    expect(
      receipts.filter((receipt) => receipt.reasonCodes.join(",") === "approval_reused"),
    ).toHaveLength(7);
  });

  it("rejects approval_reused when the registry CAS resolves false", async () => {
    const { runner, input } = await setup(SMALL_OPS);
    input.approvalRegistry = new FalseApprovalRegistry();
    const receipt = await executeApprovedImportPlan(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["approval_reused"]);
    expect(receipt.approvalConsumed).toBe(false);
    expect(runner.runs).toBe(0);
  });

  it("contains a registry infrastructure throw: sanitized code, no runner call, approval unconsumed", async () => {
    const { runner, input, approval } = await setup(SMALL_OPS);
    input.approvalRegistry = new ThrowingApprovalRegistry();
    const receipt = await executeApprovedImportPlan(input);

    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["approval_registry_unavailable"]);
    expect(receipt.approvalConsumed).toBe(false);
    expect(receipt.writesPerformed).toBe(0);
    expect(runner.runs).toBe(0);

    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("sb_secret");
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain(approval.approvalId);

    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
    logExecutionReceipt(receipt);
    logSpy.mockRestore();
    const output = lines.join("\n");
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("sb_secret");
    expect(output).not.toContain(approval.approvalId);
  });
});
