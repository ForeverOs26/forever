import { describe, expect, it, vi } from "vitest";

import { computeApprovalDigest, InMemoryApprovalRegistry } from "./execution-approval";
import { fingerprintCollisionReport } from "./collision-inspector";
import {
  createEnvExecutionCredentialProvider,
  type ExecutionCredentialProvider,
} from "./execution-credentials";
import {
  createServerExecutionAdapter,
  LIVE_EXECUTION_CAPABILITY_DISABLED,
  type ApprovedImportServerExecutor,
} from "./live-execution-adapter";
import { canonicalJsonString } from "./persistence-projection";
import { executeApprovedImportPlanViaServer, type ServerExecutionInput } from "./server-execution";
import {
  buildServerExecutionRequest,
  validateServerExecutionRequest,
  type ServerExecutionRequest,
} from "./server-execution-request";
import {
  buildingOperation,
  coralinaHermeticOperations,
  HERMETIC_IDENTITY,
  MANIFEST,
  priceOperation,
  projectOperation,
  unitOperation,
} from "./test-fixtures/collision-fixtures";
import {
  absentCollisionReport,
  approvalFor,
  EXECUTION_NOW,
  fingerprintFor,
} from "./test-fixtures/execution-fixtures";
import {
  FakeImportExecutionServer,
  FakeApprovedImportDatabaseTransport,
  resignedRequestVariant,
  SERVER_DB_NOW,
  seededServerStore,
  type FakeServerConfig,
  type FakeServerStore,
  type RegisterApprovalOptions,
} from "./test-fixtures/server-execution-fixtures";
import type { ImportOperation } from "./types";

const HERMETIC_ENV = {
  FOREVER_IMPORT_EXECUTOR_DATABASE_URL:
    "postgresql://forever_import_executor:hermetic-not-a-real-password@db.abtvsrcnfwlbawvrjeed.supabase.co:5432/postgres",
};

function smallOperations(): ImportOperation[] {
  return [
    projectOperation(),
    buildingOperation("A"),
    unitOperation("A-101", { buildingCode: "A" }),
    priceOperation("A-101", { buildingCode: "A" }),
  ];
}

interface Harness {
  server: FakeImportExecutionServer;
  registry: InMemoryApprovalRegistry;
  executor: ApprovedImportServerExecutor;
  providerCalls: () => number;
  request: ServerExecutionRequest;
  input: ServerExecutionInput;
}

async function makeHarness(
  operations: ImportOperation[],
  options: {
    serverConfig?: FakeServerConfig;
    registerApproval?: boolean;
    approvalId?: string;
    approvalRegisterOptions?: RegisterApprovalOptions;
    /** Register the approval for a self-consistent VARIANT of the request. */
    approvalVariant?: (draft: ServerExecutionRequest) => void;
    capabilityDisabled?: boolean;
    registry?: InMemoryApprovalRegistry;
    server?: FakeImportExecutionServer;
    inputOverrides?: Partial<ServerExecutionInput>;
  } = {},
): Promise<Harness> {
  const approvalId = options.approvalId ?? "approval-test-0001";
  const fingerprint = fingerprintFor(operations);
  const report = await absentCollisionReport(operations);
  const approval = approvalFor(operations, report, { approvalId });

  const server = options.server ?? new FakeImportExecutionServer(options.serverConfig);
  const transport = new FakeApprovedImportDatabaseTransport(server);
  const baseProvider = createEnvExecutionCredentialProvider(HERMETIC_ENV);
  const resolveSpy = vi.fn(() => baseProvider.resolveExecutionCredentials());
  const provider: ExecutionCredentialProvider = { resolveExecutionCredentials: resolveSpy };
  const executor = createServerExecutionAdapter({
    capability: options.capabilityDisabled
      ? LIVE_EXECUTION_CAPABILITY_DISABLED
      : { liveExecutionAuthorized: true },
    credentialProvider: provider,
    transportFactory: () => transport,
    timeoutMs: 50,
  });

  const built = buildServerExecutionRequest({
    manifest: MANIFEST,
    operations,
    operationCounts: fingerprint.operationCounts,
    planHash: fingerprint.hash,
    target: "local",
    targetProjectId: HERMETIC_IDENTITY.projectId,
    approvalDigest: computeApprovalDigest(approvalId),
    collisionReportFingerprint: fingerprintCollisionReport(report),
  });
  if (!built.ok) throw new Error(`fixture request invalid: ${built.code}`);
  if (options.registerApproval !== false) {
    const approvedRequest = options.approvalVariant
      ? resignedRequestVariant(built.request, options.approvalVariant)
      : built.request;
    server.registerApproval(approvedRequest, options.approvalRegisterOptions);
  }

  const registry = options.registry ?? new InMemoryApprovalRegistry();
  const input: ServerExecutionInput = {
    executor,
    approval,
    approvalRegistry: registry,
    now: EXECUTION_NOW,
    requestedTarget: "local",
    targetIdentity: HERMETIC_IDENTITY,
    manifest: MANIFEST,
    sourceVersion: fingerprint.sourceVersion,
    planFingerprint: fingerprint,
    expectedPlanHash: fingerprint.hash,
    expectedOperationCounts: fingerprint.operationCounts,
    confirmation: `${MANIFEST.project_slug}:${fingerprint.shortHash}`,
    operations,
    collisionReport: report,
    ...options.inputOverrides,
  };

  return {
    server,
    registry,
    executor,
    providerCalls: () => resolveSpy.mock.calls.length,
    request: built.request,
    input,
  };
}

function expectZeroDurableImportState(store: FakeServerStore): void {
  expect(store.projects).toHaveLength(0);
  expect(store.buildings).toHaveLength(0);
  expect(store.units).toHaveLength(0);
  expect(store.priceHistory).toHaveLength(0);
  expect(store.receipts).toHaveLength(0);
}

describe("RC5.5D server execution: hermetic commit", () => {
  it("commits the 405-operation Coralina-shaped plan atomically through one direct-PostgreSQL statement", async () => {
    const { server, input } = await makeHarness(coralinaHermeticOperations());
    const receipt = await executeApprovedImportPlanViaServer(input);

    expect(receipt.outcome).toBe("committed");
    expect(receipt.commitConfirmed).toBe(true);
    expect(receipt.writesPerformed).toBe(405);
    expect(receipt.totalOperationsApplied).toBe(405);
    expect(receipt.executionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(receipt.executeEnabled).toBe(false);
    expect(receipt.approvalConsumed).toBe(true);
    expect(receipt.reasonCodes).toEqual([]);
    expect(server.calls).toBe(1);

    const store = server.committedStore;
    expect(store.projects).toHaveLength(1);
    expect(store.buildings).toHaveLength(8);
    expect(store.units).toHaveLength(198);
    expect(store.priceHistory).toHaveLength(198);
    expect(store.receipts).toHaveLength(1);
    expect(store.receipts[0].writes_performed).toBe(405);
    expect(store.approvals[0].consumed_at).not.toBeNull();
    expect(store.approvals[0].execution_id).toBe(receipt.executionId);

    // Relationship integrity of the persisted graph.
    const projectId = store.projects[0].id;
    expect(store.buildings.every((row) => row.project_id === projectId)).toBe(true);
    expect(store.units.every((row) => row.project_id === projectId)).toBe(true);
    const unitIds = new Set(store.units.map((row) => row.id));
    expect(store.priceHistory.every((row) => unitIds.has(row.unit_id as string))).toBe(true);
  });

  it("keeps external surfaces free of raw approval ids, secrets, urls, and provider text", async () => {
    const { input } = await makeHarness(smallOperations());
    const receipt = await executeApprovedImportPlanViaServer(input);
    const serialized = canonicalJsonString(receipt);

    expect(receipt.outcome).toBe("committed");
    expect(serialized).not.toContain("approval-test-0001");
    expect(serialized).not.toContain("sb_secret");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("SELECT");
    expect(receipt.approvalDigest).toBe(computeApprovalDigest("approval-test-0001"));
  });
});

describe("RC5.5D server execution: fail-closed gates before any network", () => {
  it("rejects invalid preflight (production blocked / staging unconfigured) with zero calls", async () => {
    for (const [target, code] of [
      ["production", "preflight_failed:production_blocked"],
      ["staging", "preflight_failed:staging_unconfigured"],
    ] as const) {
      const { server, input, providerCalls } = await makeHarness(smallOperations(), {
        inputOverrides: { requestedTarget: target },
      });
      const receipt = await executeApprovedImportPlanViaServer(input);
      expect(receipt.outcome).toBe("rejected_before_transaction");
      expect(receipt.reasonCodes).toEqual([code]);
      expect(receipt.approvalConsumed).toBe(false);
      expect(server.calls).toBe(0);
      expect(providerCalls()).toBe(0);
    }
  });

  it("rejects a stale collision fingerprint before consuming anything", async () => {
    const operations = smallOperations();
    const staleReport = await absentCollisionReport(operations.slice(0, 2));
    const { server, input, registry } = await makeHarness(operations, {
      inputOverrides: { collisionReport: staleReport },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["collision_report_incomplete"]);
    expect(server.calls).toBe(0);
    expect(registry.isConsumed("approval-test-0001")).toBe(false);
  });

  it("rejects a changed plan hash before consuming anything", async () => {
    const { server, input } = await makeHarness(smallOperations(), {
      inputOverrides: { expectedPlanHash: "b".repeat(64) },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["preflight_failed:plan_hash_mismatch"]);
    expect(server.calls).toBe(0);
  });

  it("contains a registry infrastructure failure without any adapter call", async () => {
    const throwingRegistry = {
      consumeIfUnused: async () => {
        throw new Error("registry backend down: postgres://internal");
      },
    };
    const { server, input, providerCalls } = await makeHarness(smallOperations(), {
      inputOverrides: { approvalRegistry: throwingRegistry },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["approval_registry_unavailable"]);
    expect(receipt.approvalConsumed).toBe(false);
    expect(server.calls).toBe(0);
    expect(providerCalls()).toBe(0);
    expect(canonicalJsonString(receipt)).not.toContain("postgres://");
  });

  it("rejects a locally repeated approval before any adapter call", async () => {
    const { input, server, registry } = await makeHarness(smallOperations());
    const first = await executeApprovedImportPlanViaServer(input);
    expect(first.outcome).toBe("committed");
    expect(server.calls).toBe(1);

    const second = await executeApprovedImportPlanViaServer({
      ...input,
      approvalRegistry: registry,
    });
    expect(second.outcome).toBe("rejected_before_transaction");
    expect(second.reasonCodes).toEqual(["approval_reused"]);
    expect(server.calls).toBe(1);
  });

  it("stays disabled end to end: the default capability rejects after the local CAS", async () => {
    const { input, server, registry, providerCalls } = await makeHarness(smallOperations(), {
      capabilityDisabled: true,
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rejected_before_transaction");
    expect(receipt.reasonCodes).toEqual(["live_execution_disabled"]);
    expect(receipt.writesPerformed).toBe(0);
    expect(receipt.executeEnabled).toBe(false);
    // The local artifact is burned at the attempt boundary; nothing else moved.
    expect(receipt.approvalConsumed).toBe(true);
    expect(registry.isConsumed("approval-test-0001")).toBe(true);
    expect(server.calls).toBe(0);
    expect(providerCalls()).toBe(0);
    expectZeroDurableImportState(server.committedStore);
  });
});

describe("RC5.5D server execution: durable approval contract", () => {
  it("consumes the durable approval atomically with the import (CAS + expiry on db time)", async () => {
    const { input, server } = await makeHarness(smallOperations());
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("committed");
    const row = server.committedStore.approvals[0];
    expect(row.consumed_at).toBe(SERVER_DB_NOW.toISOString());
    expect(row.execution_id).toBe(receipt.executionId);
  });

  it("rejects an unknown durable approval and leaves zero durable state", async () => {
    const { input, server } = await makeHarness(smallOperations(), { registerApproval: false });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.rollbackConfirmed).toBe(true);
    expect(receipt.reasonCodes).toEqual(["approval_unknown"]);
    expect(receipt.writesPerformed).toBe(0);
    expectZeroDurableImportState(server.committedStore);
  });

  it("evaluates expiry against DATABASE time and never burns an expired approval", async () => {
    const { input, server } = await makeHarness(smallOperations(), {
      approvalRegisterOptions: {
        issuedAt: new Date(SERVER_DB_NOW.getTime() - 30 * 60_000).toISOString(),
        expiresAt: new Date(SERVER_DB_NOW.getTime() - 60_000).toISOString(),
      },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["approval_expired"]);
    expectZeroDurableImportState(server.committedStore);
    // Rolled back with everything else: the durable approval is NOT consumed.
    expect(server.committedStore.approvals[0].consumed_at).toBeNull();
  });

  it("rejects a durable approval that is not yet valid on database time", async () => {
    const { input, server } = await makeHarness(smallOperations(), {
      approvalRegisterOptions: {
        issuedAt: new Date(SERVER_DB_NOW.getTime() + 60_000).toISOString(),
        expiresAt: new Date(SERVER_DB_NOW.getTime() + 30 * 60_000).toISOString(),
      },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.reasonCodes).toEqual(["approval_not_yet_valid"]);
    expect(server.committedStore.approvals[0].consumed_at).toBeNull();
  });

  it("rejects a scope-mismatched durable approval (changed plan hash)", async () => {
    const { input, server } = await makeHarness(smallOperations(), {
      approvalVariant: (draft) => {
        (draft as { planHash: string }).planHash = "c".repeat(64);
      },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.reasonCodes).toEqual(["approval_scope_mismatch"]);
    expectZeroDurableImportState(server.committedStore);
  });

  it("rejects a scope-mismatched durable approval (stale collision fingerprint)", async () => {
    const { input, server } = await makeHarness(smallOperations(), {
      approvalVariant: (draft) => {
        (draft as { collisionReportFingerprint: string }).collisionReportFingerprint = "d".repeat(
          64,
        );
      },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.reasonCodes).toEqual(["approval_scope_mismatch"]);
    expectZeroDurableImportState(server.committedStore);
  });

  it("admits exactly one winner among concurrent attempts on the same approval", async () => {
    const server = new FakeImportExecutionServer();
    const first = await makeHarness(smallOperations(), { server });
    const second = await makeHarness(smallOperations(), {
      server,
      registerApproval: false,
      registry: new InMemoryApprovalRegistry(),
    });

    const [receiptA, receiptB] = await Promise.all([
      executeApprovedImportPlanViaServer(first.input),
      executeApprovedImportPlanViaServer(second.input),
    ]);
    const outcomes = [receiptA.outcome, receiptB.outcome].sort();
    expect(outcomes).toEqual(["committed", "rolled_back"]);
    const loser = receiptA.outcome === "committed" ? receiptB : receiptA;
    expect(loser.reasonCodes).toEqual(["approval_already_consumed"]);
    expect(server.committedStore.projects).toHaveLength(1);
    expect(server.committedStore.receipts).toHaveLength(1);
  });

  it("survives a client restart: the durable registry still rejects the burned approval", async () => {
    const { input, server } = await makeHarness(smallOperations());
    const first = await executeApprovedImportPlanViaServer(input);
    expect(first.outcome).toBe("committed");

    // Same durable server, brand-new client process (fresh local registry).
    const restarted = await makeHarness(smallOperations(), {
      server,
      registerApproval: false,
      registry: new InMemoryApprovalRegistry(),
    });
    const second = await executeApprovedImportPlanViaServer(restarted.input);
    expect(second.outcome).toBe("rolled_back");
    expect(second.reasonCodes).toEqual(["approval_already_consumed"]);
    expect(server.committedStore.receipts).toHaveLength(1);
    expect(server.committedStore.projects).toHaveLength(1);
  });

  it("permanently refuses a different approval for an already-imported plan", async () => {
    const { input, server } = await makeHarness(smallOperations());
    const first = await executeApprovedImportPlanViaServer(input);
    expect(first.outcome).toBe("committed");

    // The imported project rows are later removed, but the durable receipt
    // remains; a fresh, otherwise-valid approval must still be refused.
    server.committedStore.projects = [];
    server.committedStore.buildings = [];
    server.committedStore.units = [];
    server.committedStore.priceHistory = [];

    const secondApproval = await makeHarness(smallOperations(), {
      server,
      approvalId: "approval-test-0002",
      registry: new InMemoryApprovalRegistry(),
    });
    const second = await executeApprovedImportPlanViaServer(secondApproval.input);
    expect(second.outcome).toBe("rolled_back");
    expect(second.reasonCodes).toEqual(["plan_already_executed"]);
    // The rolled-back second approval is not durably consumed.
    const row = server.committedStore.approvals.find(
      (item) => item.approval_digest === computeApprovalDigest("approval-test-0002"),
    );
    expect(row?.consumed_at).toBeNull();
  });
});

describe("RC5.5D server execution: rollback leaves zero partial durable state", () => {
  it("rolls back on in-transaction state drift after inspection", async () => {
    const store = seededServerStore();
    store.projects.push({ id: "pre-existing", slug: "coralina" });
    const { input, server } = await makeHarness(smallOperations(), {
      serverConfig: { store },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["target_state_changed"]);
    expect(receipt.writesPerformed).toBe(0);
    expect(server.committedStore.projects).toHaveLength(1); // only the pre-existing row
    expect(server.committedStore.receipts).toHaveLength(0);
    expect(server.committedStore.approvals[0].consumed_at).toBeNull();
  });

  it.each([
    ["early (after the project write)", 1],
    ["middle (mid units)", 150],
    ["late (final price-history write)", 405],
  ])(
    "rolls back a 405-operation plan failing %s with zero partial writes",
    async (_label, writes) => {
      const { input, server } = await makeHarness(coralinaHermeticOperations(), {
        serverConfig: { raiseAfterWrites: { writes, code: "verification_count_mismatch" } },
      });
      const receipt = await executeApprovedImportPlanViaServer(input);
      expect(receipt.outcome).toBe("rolled_back");
      expect(receipt.rollbackConfirmed).toBe(true);
      expect(receipt.writesPerformed).toBe(0);
      expectZeroDurableImportState(server.committedStore);
      expect(server.committedStore.approvals[0].consumed_at).toBeNull();
    },
  );

  it("rolls back when in-transaction verification detects a tampered persisted row", async () => {
    const { input, server } = await makeHarness(coralinaHermeticOperations(), {
      serverConfig: {
        tamperBeforeVerification: (staged) => {
          staged.units[10].bedrooms = 99;
        },
      },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["verification_field_mismatch"]);
    expectZeroDurableImportState(server.committedStore);
  });

  it("rolls back when verification detects an unexpected extra write", async () => {
    const { input, server } = await makeHarness(smallOperations(), {
      serverConfig: {
        tamperBeforeVerification: (staged) => {
          staged.units.push({ ...staged.units[0], id: "srv-unit-extra", unit_code: "X-999" });
        },
      },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["verification_extra_rows"]);
    expectZeroDurableImportState(server.committedStore);
  });

  it("reports an unconfirmed outcome when the commit itself fails, with writesPerformed null", async () => {
    const { input, server } = await makeHarness(smallOperations(), {
      serverConfig: { commitFails: true },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("failed_rollback_unconfirmed");
    expect(receipt.commitConfirmed).toBe(false);
    expect(receipt.rollbackConfirmed).toBe(false);
    expect(receipt.writesPerformed).toBeNull();
    expect(receipt.reasonCodes).toEqual(["adapter_failure"]);
    expectZeroDurableImportState(server.committedStore);
  });

  it("reports an unconfirmed outcome on network timeout with no retry", async () => {
    const { input, server } = await makeHarness(smallOperations(), {
      serverConfig: { neverResolve: true },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("failed_rollback_unconfirmed");
    expect(receipt.reasonCodes).toEqual(["execution_outcome_unknown"]);
    expect(receipt.writesPerformed).toBeNull();
    expect(server.calls).toBe(1);
  });

  it("reports an unconfirmed outcome on a malformed transport response", async () => {
    const { input, server } = await makeHarness(smallOperations(), {
      serverConfig: { malformedData: { outcome: "committed" } },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("failed_rollback_unconfirmed");
    expect(receipt.reasonCodes).toEqual(["server_response_invalid"]);
    expect(receipt.writesPerformed).toBeNull();
    expect(server.calls).toBe(1);
  });

  it("repeating the exact same request after an unknown outcome stays fail-closed", async () => {
    const { input, server } = await makeHarness(smallOperations(), {
      serverConfig: { neverResolve: true },
    });
    const first = await executeApprovedImportPlanViaServer(input);
    expect(first.outcome).toBe("failed_rollback_unconfirmed");

    // No automatic retry happens; an identical manual repeat is rejected by
    // the local one-time registry without reaching the adapter again.
    const second = await executeApprovedImportPlanViaServer(input);
    expect(second.outcome).toBe("rejected_before_transaction");
    expect(second.reasonCodes).toEqual(["approval_reused"]);
    expect(server.calls).toBe(1);
  });
});

describe("RC5.5D approved-request binding: a self-consistent malicious client cannot alter the payload", () => {
  /**
   * Adversary model: the caller fully controls its own client code, so every
   * tamper below is applied AND the client-side request fingerprint is
   * recomputed (`resignedRequestVariant`) — the request is self-consistent
   * and passes every client-side check. The approval was registered for the
   * ORIGINAL request; the server must reject the variant purely from its own
   * stored immutable approved request, before any durable approval
   * consumption and before any entity write. The fake server is called
   * DIRECTLY (no client gates at all) to prove the rejection is server-side.
   */
  function twoBuildingOperations(): ImportOperation[] {
    return [
      projectOperation(),
      buildingOperation("A"),
      buildingOperation("B"),
      unitOperation("A-101", { buildingCode: "A" }),
      unitOperation("B-201", { buildingCode: "B" }),
      priceOperation("A-101", { buildingCode: "A" }),
      priceOperation("B-201", { buildingCode: "B" }),
    ];
  }

  // Expected code: `approval_scope_mismatch` when the tamper also changes the
  // approved operation counts (the scope gate fires first), otherwise
  // `approval_request_mismatch` from the immutable-body comparison. Both are
  // closed stable codes raised before consumption and before any write.
  const TAMPERS: Array<[string, (draft: ServerExecutionRequest) => void, string?]> = [
    [
      "project name",
      (draft) => {
        draft.entities.project.name = "Totally Different Project";
      },
    ],
    [
      "developer slug",
      (draft) => {
        draft.entities.project.developer_slug = "hostile-developer";
      },
    ],
    [
      "location slug",
      (draft) => {
        draft.entities.project.location_slug = "hostile-location";
      },
    ],
    [
      "project status",
      (draft) => {
        draft.entities.project.public_status = "draft";
      },
    ],
    [
      "building metadata",
      (draft) => {
        draft.entities.buildings[0].metadata = { injected: true };
      },
    ],
    [
      "unit price",
      (draft) => {
        draft.entities.units[0].base_price_thb = 1;
      },
    ],
    [
      "unit bedroom count",
      (draft) => {
        draft.entities.units[0].bedrooms = 99;
      },
    ],
    [
      "unit parent building",
      (draft) => {
        draft.entities.units[0].building_code = "B";
      },
    ],
    [
      "price-history amount",
      (draft) => {
        draft.entities.priceHistory[0].price = 1;
      },
    ],
    [
      "source identity",
      (draft) => {
        draft.entities.priceHistory[0].source_file = "different-source.pdf";
      },
    ],
    [
      "entity count (price-history row removed)",
      (draft) => {
        draft.entities.priceHistory.pop();
        draft.operationCounts.priceHistoryRows -= 1;
        draft.operationCounts.operations -= 1;
      },
      "approval_scope_mismatch",
    ],
    [
      "entity added (extra building)",
      (draft) => {
        draft.entities.buildings.push({ ...draft.entities.buildings[0], building_code: "Z" });
        draft.operationCounts.buildings += 1;
        draft.operationCounts.operations += 1;
      },
      "approval_scope_mismatch",
    ],
    [
      "significant array reordering",
      (draft) => {
        draft.entities.buildings.reverse();
      },
    ],
  ];

  it.each(TAMPERS)(
    "rejects a resigned request with altered %s before consumption and before any write",
    async (_label, mutate, expectedCode) => {
      const { server, request } = await makeHarness(twoBuildingOperations());
      const variant = resignedRequestVariant(request, mutate);
      // The variant is self-consistent: it passes full client-side validation.
      expect(validateServerExecutionRequest(variant)).toBeNull();

      const response = await server.call(variant);
      expect(response.result).toBeNull();
      expect((response.error as { message: string }).message).toBe(
        `forever_import_execution: ${expectedCode ?? "approval_request_mismatch"}`,
      );
      expectZeroDurableImportState(server.committedStore);
      expect(server.committedStore.approvals[0].consumed_at).toBeNull();
    },
  );

  it("rejects a change to the request fingerprint itself", async () => {
    const { server, request } = await makeHarness(smallOperations());
    const variant = structuredClone(request);
    variant.requestFingerprint = "0".repeat(64);

    const response = await server.call(variant);
    expect(response.result).toBeNull();
    expect((response.error as { message: string }).message).toBe(
      "forever_import_execution: approval_request_mismatch",
    );
    expect(server.committedStore.approvals[0].consumed_at).toBeNull();
    expectZeroDurableImportState(server.committedStore);
  });

  it("maps a server-side payload-binding rejection to a confirmed rollback receipt end to end", async () => {
    // Same attack through the full executor/adapter stack: the approval is
    // registered for a variant payload, so the honestly built request no
    // longer matches the stored approved request.
    const { input, server } = await makeHarness(smallOperations(), {
      approvalVariant: (draft) => {
        draft.entities.units[0].base_price_thb = 1;
      },
    });
    const receipt = await executeApprovedImportPlanViaServer(input);
    expect(receipt.outcome).toBe("rolled_back");
    expect(receipt.reasonCodes).toEqual(["approval_request_mismatch"]);
    expect(receipt.writesPerformed).toBe(0);
    expectZeroDurableImportState(server.committedStore);
  });
});

describe("RC5.5D approved-request binding: registration fails closed", () => {
  it("refuses malformed, tampered, oversized, unsafe, and credential-bearing payloads", async () => {
    const { server, request } = await makeHarness(smallOperations(), {
      registerApproval: false,
    });

    const attempts: Array<[unknown, string]> = [
      [{ not: "a request" }, "request_schema_unsupported"],
      [
        resignedRequestVariant(request, (draft) => {
          (draft as unknown as Record<string, unknown>).extra = true;
        }),
        "request_unsupported_property",
      ],
      [
        resignedRequestVariant(request, (draft) => {
          draft.operationCounts.units += 1;
          draft.operationCounts.operations += 1;
        }),
        "request_operation_counts_invalid",
      ],
      [
        resignedRequestVariant(request, (draft) => {
          draft.entities.buildings.push({ ...draft.entities.buildings[0] });
          draft.operationCounts.buildings += 1;
          draft.operationCounts.operations += 1;
        }),
        "request_duplicate_natural_key",
      ],
      [
        resignedRequestVariant(request, (draft) => {
          draft.entities.units[0].metadata = { blob: "x".repeat(4_000_001) };
        }),
        "request_too_large",
      ],
      [
        resignedRequestVariant(request, (draft) => {
          draft.entities.priceHistory[0].source_file = "/etc/passwd";
        }),
        "request_unsafe_path",
      ],
      [
        resignedRequestVariant(request, (draft) => {
          draft.entities.units[0].metadata = { note: "sb_secret_leaked" };
        }),
        "request_credential_material",
      ],
      [
        (() => {
          const draft = structuredClone(request);
          draft.entities.units[0].bedrooms = 99; // fingerprint NOT recomputed
          return draft;
        })(),
        "request_malformed", // fingerprint mismatch has no server code; fails closed
      ],
    ];

    for (const [candidate, code] of attempts) {
      expect(() => server.registerApproval(candidate as ServerExecutionRequest)).toThrowError(
        `forever_import_execution: ${code}`,
      );
    }
    expect(server.committedStore.approvals).toHaveLength(0);
  });

  it("refuses to register the same approval digest twice", async () => {
    const { server, request } = await makeHarness(smallOperations());
    expect(() => server.registerApproval(request)).toThrowError(
      "forever_import_execution: approval_already_registered",
    );
    expect(server.committedStore.approvals).toHaveLength(1);
  });
});
