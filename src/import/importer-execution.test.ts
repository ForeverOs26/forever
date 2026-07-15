import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseImportInvocation } from "./cli-args";
import { InMemoryApprovalRegistry } from "./execution-approval";
import { fingerprintCollisionReport } from "./collision-inspector";
import { importProject } from "./importer";
import { FakeCollisionReader } from "./test-fixtures/collision-fixtures";
import {
  EXECUTION_NOW,
  FakeTransactionRunner,
  type FakeExecutionStore,
} from "./test-fixtures/execution-fixtures";

/** Dependency rows matching the synthetic modeva-currency fixture manifest. */
function fixtureStore(): FakeExecutionStore {
  return {
    developers: [{ id: "dev-fixture", slug: "synthetic-test-developer" }],
    locations: [{ id: "loc-fixture", slug: "test-location" }],
    projects: [],
    buildings: [],
    units: [],
    priceHistory: [],
  };
}

const readerFactoryCalled = vi.hoisted(() => ({ value: false }));
const liveRunnerRequested = vi.hoisted(() => ({ value: false }));

vi.mock("./collision-reader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collision-reader")>();
  return {
    ...actual,
    createCollisionInspectionReader: vi.fn(() => {
      readerFactoryCalled.value = true;
      throw new Error("read-only reader must not be created in hermetic tests");
    }),
  };
});

vi.mock("./execution-adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./execution-adapter")>();
  return {
    ...actual,
    createLiveTransactionRunner: vi.fn(() => {
      liveRunnerRequested.value = true;
      return actual.createLiveTransactionRunner();
    }),
  };
});

const FIXTURE_ROOT = resolve(process.cwd(), "src/import/test-fixtures");
const FIXTURE_SLUG = "modeva-currency";

async function fixtureFingerprint() {
  const dryRun = await importProject({
    projectSlug: FIXTURE_SLUG,
    dryRun: true,
    projectsRoot: FIXTURE_ROOT,
  });
  return dryRun.planFingerprint!;
}

function baseExecutionOptions(
  fingerprint: Awaited<ReturnType<typeof fixtureFingerprint>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    projectSlug: FIXTURE_SLUG,
    projectsRoot: FIXTURE_ROOT,
    executeApprovedImport: true,
    target: "local",
    expectedPlanHash: fingerprint.hash,
    expectedOperationCounts: fingerprint.operationCounts,
    confirmation: `${fingerprint.projectSlug}:${fingerprint.shortHash}`,
    targetIdentity: { projectId: "forever-local" },
    collisionReader: new FakeCollisionReader({ projects: [] }),
    approvalRegistry: new InMemoryApprovalRegistry(),
    executionNow: EXECUTION_NOW,
    ...overrides,
  };
}

describe("RC5.5C importer execution integration", () => {
  beforeEach(() => {
    readerFactoryCalled.value = false;
    liveRunnerRequested.value = false;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("keeps dry-run unchanged: no reader, no runner, no network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const summary = await importProject({
      projectSlug: FIXTURE_SLUG,
      dryRun: true,
      projectsRoot: FIXTURE_ROOT,
    });
    expect(summary.status).toBe("dry_run_completed");
    expect(summary.receipt?.executeEnabled).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readerFactoryCalled.value).toBe(false);
    expect(liveRunnerRequested.value).toBe(false);
  });

  it("keeps collision inspection unchanged and never requests a runner", async () => {
    const fingerprint = await fixtureFingerprint();
    const summary = await importProject({
      projectSlug: FIXTURE_SLUG,
      projectsRoot: FIXTURE_ROOT,
      inspectCollisions: true,
      target: "local",
      expectedPlanHash: fingerprint.hash,
      expectedOperationCounts: fingerprint.operationCounts,
      confirmation: `${fingerprint.projectSlug}:${fingerprint.shortHash}`,
      targetIdentity: { projectId: "forever-local" },
      collisionReader: new FakeCollisionReader({ projects: [] }),
    });
    expect(summary.status).toBe("collision_inspected");
    expect(liveRunnerRequested.value).toBe(false);
  });

  it("fails closed at the live-runner boundary without consuming the approval or creating a reader", async () => {
    const fingerprint = await fixtureFingerprint();
    const registry = new InMemoryApprovalRegistry();
    const reader = new FakeCollisionReader({ projects: [] });

    await expect(
      importProject(
        baseExecutionOptions(fingerprint, {
          approvalRegistry: registry,
          collisionReader: reader,
          approval: { approvalId: "approval-live" },
          // no transactionRunner injected -> live factory must fail closed
        }),
      ),
    ).rejects.toThrow("live_execution_disabled");

    expect(liveRunnerRequested.value).toBe(true);
    expect(registry.isConsumed("approval-live")).toBe(false);
    expect(reader.calls).toEqual([]);
    expect(readerFactoryCalled.value).toBe(false);
  });

  it("keeps the legacy execute request at the execute-disabled boundary", async () => {
    const fingerprint = await fixtureFingerprint();
    await expect(
      importProject({
        projectSlug: FIXTURE_SLUG,
        projectsRoot: FIXTURE_ROOT,
        target: "local",
        expectedPlanHash: fingerprint.hash,
        expectedOperationCounts: fingerprint.operationCounts,
        confirmation: `${fingerprint.projectSlug}:${fingerprint.shortHash}`,
        targetIdentity: { projectId: "forever-local" },
      }),
    ).rejects.toThrow("execute mode is not enabled yet");
  });

  it("stops a production execution request at preflight before inspection or runner use", async () => {
    const fingerprint = await fixtureFingerprint();
    const reader = new FakeCollisionReader({ projects: [] });
    await expect(
      importProject(
        baseExecutionOptions(fingerprint, {
          target: "production",
          collisionReader: reader,
          transactionRunner: new FakeTransactionRunner(),
        }),
      ),
    ).rejects.toThrow("production_blocked");
    expect(reader.calls).toEqual([]);
  });

  it("runs a full hermetic execution attempt and reports a deterministic rejection for a mismatched approval", async () => {
    const fingerprint = await fixtureFingerprint();
    const runner = new FakeTransactionRunner();
    const summary = await importProject(
      baseExecutionOptions(fingerprint, {
        transactionRunner: runner,
        approval: { approvalId: "approval-wrong" },
      }),
    );
    expect(summary.status).toBe("execution_rejected");
    expect(summary.executionReceipt?.outcome).toBe("rejected_before_transaction");
    expect(summary.executionReceipt?.reasonCodes).toEqual(["approval_schema_unsupported"]);
    expect(summary.executionReceipt?.writesPerformed).toBe(0);
    expect(runner.runs).toBe(0);
  });

  it("commits hermetically when the approval matches the fresh inspection exactly", async () => {
    const fingerprint = await fixtureFingerprint();
    const runner = new FakeTransactionRunner({ store: fixtureStore() });
    const registry = new InMemoryApprovalRegistry();
    const reader = new FakeCollisionReader({ projects: [] });

    // First pass: obtain the exact collision-report fingerprint the importer
    // will compute, via a rejected probe with a placeholder approval.
    const probe = await importProject(
      baseExecutionOptions(fingerprint, {
        transactionRunner: new FakeTransactionRunner(),
        collisionReader: new FakeCollisionReader({ projects: [] }),
        approvalRegistry: new InMemoryApprovalRegistry(),
        approval: null,
      }),
    );
    expect(probe.status).toBe("execution_rejected");
    const reportFingerprint = fingerprintCollisionReport(probe.collisionReport!);

    const summary = await importProject(
      baseExecutionOptions(fingerprint, {
        transactionRunner: runner,
        approvalRegistry: registry,
        collisionReader: reader,
        approval: {
          schemaVersion: "1",
          approvalId: "approval-hermetic-commit",
          projectSlug: FIXTURE_SLUG,
          target: "local",
          targetProjectId: "forever-local",
          planHash: fingerprint.hash,
          operationCount: fingerprint.operationCounts.operations,
          collisionReportFingerprint: reportFingerprint,
          issuedAt: new Date(EXECUTION_NOW.getTime() - 60_000).toISOString(),
          expiresAt: new Date(EXECUTION_NOW.getTime() + 30 * 60_000).toISOString(),
        },
      }),
    );

    expect(summary.status).toBe("execution_committed");
    expect(summary.executionReceipt?.commitConfirmed).toBe(true);
    expect(summary.executionReceipt?.totalOperationsApplied).toBe(
      fingerprint.operationCounts.operations,
    );
    expect(registry.isConsumed("approval-hermetic-commit")).toBe(true);
    expect(runner.committedStore.projects).toHaveLength(1);
    expect(liveRunnerRequested.value).toBe(false);
  });
});

describe("RC5.5C CLI mode combinations", () => {
  const FULL = [
    "coralina",
    "--execute-approved-import",
    "--target=local",
    "--plan-hash=" + "a".repeat(64),
    "--confirm=coralina:aaaaaaaaaaaa",
    "--target-project-id=forever-local",
    "--approval-file=approval.json",
  ];

  it("accepts a fully specified execution invocation", () => {
    const result = parseImportInvocation(FULL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.executeApprovedImport).toBe(true);
      expect(result.approvalFile).toBe("approval.json");
    }
  });

  it("rejects --execute-approved-import combined with --dry-run", () => {
    const result = parseImportInvocation([...FULL, "--dry-run"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("mutually exclusive");
  });

  it("rejects --execute-approved-import combined with --inspect-collisions", () => {
    const result = parseImportInvocation([...FULL, "--inspect-collisions"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("mutually exclusive");
  });

  it.each([
    ["target", "--target=local"],
    ["plan hash", "--plan-hash=" + "a".repeat(64)],
    ["confirmation", "--confirm=coralina:aaaaaaaaaaaa"],
    ["target project id", "--target-project-id=forever-local"],
    ["approval file", "--approval-file=approval.json"],
  ])("rejects execution without the %s", (_label, flag) => {
    const result = parseImportInvocation(FULL.filter((arg) => arg !== flag));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Approved execution requires");
  });

  it("never infers execution from the absence of --dry-run", () => {
    const result = parseImportInvocation([
      "coralina",
      "--target=local",
      "--plan-hash=" + "a".repeat(64),
      "--confirm=coralina:aaaaaaaaaaaa",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.executeApprovedImport).toBe(false);
  });
});
