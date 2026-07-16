import { describe, expect, it, vi } from "vitest";

import { computeApprovalDigest } from "./execution-approval";
import { fingerprintCollisionReport } from "./collision-inspector";
import {
  createEnvExecutionCredentialProvider,
  type ExecutionCredentialProvider,
} from "./execution-credentials";
import {
  createServerExecutionAdapter,
  disabledApprovedImportDatabaseTransportFactory,
  LIVE_EXECUTION_CAPABILITY_DISABLED,
  LIVE_SERVER_EXECUTION_ENABLED,
  parseServerCommittedResult,
  parseServerErrorReasonCode,
  type ApprovedImportDatabaseTransport,
  type LiveExecutionCapability,
} from "./live-execution-adapter";
import {
  APPROVED_IMPORT_EXECUTION_FUNCTION,
  APPROVED_IMPORT_EXECUTION_STATEMENT,
  buildServerExecutionRequest,
  type ServerExecutionRequest,
} from "./server-execution-request";
import {
  buildingOperation,
  HERMETIC_IDENTITY,
  MANIFEST,
  priceOperation,
  projectOperation,
  unitOperation,
} from "./test-fixtures/collision-fixtures";
import { absentCollisionReport, fingerprintFor } from "./test-fixtures/execution-fixtures";
import {
  FakeImportExecutionServer,
  FakeApprovedImportDatabaseTransport,
  resignedRequestVariant,
  type FakeServerConfig,
} from "./test-fixtures/server-execution-fixtures";
import type { ImportOperation } from "./types";

const CAPABILITY_ENABLED: LiveExecutionCapability = { liveExecutionAuthorized: true };
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

async function validRequest(): Promise<ServerExecutionRequest> {
  const operations = smallOperations();
  const fingerprint = fingerprintFor(operations);
  const report = await absentCollisionReport(operations);
  const built = buildServerExecutionRequest({
    manifest: MANIFEST,
    operations,
    operationCounts: fingerprint.operationCounts,
    planHash: fingerprint.hash,
    target: "local",
    targetProjectId: HERMETIC_IDENTITY.projectId,
    approvalDigest: computeApprovalDigest("approval-test-0001"),
    collisionReportFingerprint: fingerprintCollisionReport(report),
  });
  if (!built.ok) throw new Error(`fixture request invalid: ${built.code}`);
  return built.request;
}

interface Harness {
  server: FakeImportExecutionServer;
  transport: FakeApprovedImportDatabaseTransport;
  provider: ExecutionCredentialProvider;
  providerCalls: () => number;
  transportFactoryCalls: () => number;
  executor: ReturnType<typeof createServerExecutionAdapter>;
}

function harness(
  config: FakeServerConfig = {},
  options: { capability?: LiveExecutionCapability; timeoutMs?: number } = {},
): Harness {
  const server = new FakeImportExecutionServer(config);
  const transport = new FakeApprovedImportDatabaseTransport(server);
  const baseProvider = createEnvExecutionCredentialProvider(HERMETIC_ENV);
  const resolveSpy = vi.fn(() => baseProvider.resolveExecutionCredentials());
  const factorySpy = vi.fn((): ApprovedImportDatabaseTransport => transport);
  return {
    server,
    transport,
    provider: { resolveExecutionCredentials: resolveSpy },
    providerCalls: () => resolveSpy.mock.calls.length,
    transportFactoryCalls: () => factorySpy.mock.calls.length,
    executor: createServerExecutionAdapter({
      capability: options.capability ?? CAPABILITY_ENABLED,
      credentialProvider: { resolveExecutionCredentials: resolveSpy },
      transportFactory: factorySpy,
      timeoutMs: options.timeoutMs,
    }),
  };
}

describe("RC5.5D live adapter: disablement", () => {
  it("keeps the repository default disabled", () => {
    expect(LIVE_SERVER_EXECUTION_ENABLED).toBe(false);
    expect(LIVE_EXECUTION_CAPABILITY_DISABLED.liveExecutionAuthorized).toBe(false);
  });

  it("rejects with the default (disabled) capability before any credential read", async () => {
    const { executor, providerCalls, transportFactoryCalls, server } = harness(
      {},
      { capability: LIVE_EXECUTION_CAPABILITY_DISABLED },
    );
    const outcome = await executor.executeApprovedImportRequest(await validRequest());
    expect(outcome).toEqual({
      outcome: "rejected_before_transaction",
      reasonCode: "live_execution_disabled",
    });
    expect(providerCalls()).toBe(0);
    expect(transportFactoryCalls()).toBe(0);
    expect(server.calls).toBe(0);
  });

  it("fails closed with the default transport factory even when a capability exists", async () => {
    const request = await validRequest();
    const resolveSpy = vi.fn(() =>
      createEnvExecutionCredentialProvider(HERMETIC_ENV).resolveExecutionCredentials(),
    );
    const executor = createServerExecutionAdapter({
      capability: CAPABILITY_ENABLED,
      credentialProvider: { resolveExecutionCredentials: resolveSpy },
      // no transportFactory injected: repository default fails closed
    });
    const outcome = await executor.executeApprovedImportRequest(request);
    expect(outcome).toEqual({
      outcome: "rejected_before_transaction",
      reasonCode: "live_execution_disabled",
    });
  });
});

describe("RC5.5D live adapter: pre-network gates", () => {
  it("never invokes the credential provider or transport for an invalid request", async () => {
    const { executor, providerCalls, transportFactoryCalls, server } = harness();
    const outcome = await executor.executeApprovedImportRequest({ not: "a request" });
    expect(outcome.outcome).toBe("rejected_before_transaction");
    expect(providerCalls()).toBe(0);
    expect(transportFactoryCalls()).toBe(0);
    expect(server.calls).toBe(0);
  });

  it("fails closed offline when execution credentials are absent", async () => {
    const request = await validRequest();
    const factorySpy = vi.fn();
    const executor = createServerExecutionAdapter({
      capability: CAPABILITY_ENABLED,
      credentialProvider: createEnvExecutionCredentialProvider({}),
      transportFactory: factorySpy as never,
    });
    const outcome = await executor.executeApprovedImportRequest(request);
    expect(outcome).toEqual({
      outcome: "rejected_before_transaction",
      reasonCode: "execution_credentials_missing",
    });
    expect(factorySpy).not.toHaveBeenCalled();
  });

  it("fails closed offline when a service-role key is supplied instead of a DB URL", async () => {
    const request = await validRequest();
    const executor = createServerExecutionAdapter({
      capability: CAPABILITY_ENABLED,
      credentialProvider: createEnvExecutionCredentialProvider({
        FOREVER_IMPORT_EXECUTOR_DATABASE_URL: "sb_secret_service_role_key_not_a_db_url",
      }),
    });
    const outcome = await executor.executeApprovedImportRequest(request);
    expect(outcome).toEqual({
      outcome: "rejected_before_transaction",
      reasonCode: "execution_credentials_invalid",
    });
  });
});

describe("RC5.5D live adapter: single-invocation execution", () => {
  it("commits through exactly one direct-PostgreSQL statement invoking the boundary function", async () => {
    const { executor, server, transport } = harness();
    const request = await validRequest();
    server.registerApproval(request);

    const outcome = await executor.executeApprovedImportRequest(request);
    expect(outcome.outcome).toBe("committed");
    if (outcome.outcome !== "committed") return;
    expect(outcome.result.writesPerformed).toBe(4);
    expect(outcome.result.executionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.calls).toBe(1);
    expect(transport.invocations).toBe(1);
  });

  it("never retries: one failure response means exactly one call", async () => {
    const { executor, server } = harness({ rawError: { message: "raw provider failure" } });
    const request = await validRequest();
    server.registerApproval(request);

    const outcome = await executor.executeApprovedImportRequest(request);
    expect(outcome).toEqual({
      outcome: "failed_rollback_unconfirmed",
      reasonCode: "adapter_failure",
    });
    expect(server.calls).toBe(1);
  });

  it("maps a recognized server raise to a confirmed rollback with only the stable code", async () => {
    const { executor, server } = harness();
    const request = await validRequest();
    // No approval registered: the server raises approval_unknown.
    const outcome = await executor.executeApprovedImportRequest(request);
    expect(outcome).toEqual({ outcome: "rolled_back", reasonCode: "approval_unknown" });
    expect(server.calls).toBe(1);
    expect(JSON.stringify(outcome)).not.toContain("must never surface");
  });

  it("discards raw provider errors, including code-shaped and secret-shaped ones", async () => {
    for (const error of [
      { message: "connection to https://db.internal:5432 failed, apikey sb_secret_leak" },
      { message: "forever_import_execution: DROP TABLE" },
      { message: "forever_import_execution: not_a_known_code" },
      "string error",
      { code: "P0001" },
    ]) {
      const { executor, server } = harness({ rawError: error });
      const request = await validRequest();
      server.registerApproval(request);
      const outcome = await executor.executeApprovedImportRequest(request);
      expect(outcome).toEqual({
        outcome: "failed_rollback_unconfirmed",
        reasonCode: "adapter_failure",
      });
      expect(JSON.stringify(outcome)).not.toContain("sb_secret");
      expect(JSON.stringify(outcome)).not.toContain("https://");
    }
  });

  it("maps timeouts and transport throws to failed_rollback_unconfirmed", async () => {
    const timeoutHarness = harness({ neverResolve: true }, { timeoutMs: 20 });
    const request = await validRequest();
    timeoutHarness.server.registerApproval(request);
    await expect(timeoutHarness.executor.executeApprovedImportRequest(request)).resolves.toEqual({
      outcome: "failed_rollback_unconfirmed",
      reasonCode: "execution_outcome_unknown",
    });

    const throwHarness = harness({ throwOnCall: new Error("socket hang up") });
    throwHarness.server.registerApproval(request);
    await expect(throwHarness.executor.executeApprovedImportRequest(request)).resolves.toEqual({
      outcome: "failed_rollback_unconfirmed",
      reasonCode: "execution_outcome_unknown",
    });
    expect(throwHarness.server.calls).toBe(1);
  });

  it("fails closed on malformed, partial, or mismatched committed responses", async () => {
    const request = await validRequest();
    const committedShape = {
      schemaVersion: "1",
      outcome: "committed",
      executionId: "00000000-0000-4000-8000-000000000001",
      approvalDigest: request.approvalDigest,
      requestFingerprint: request.requestFingerprint,
      projectSlug: request.projectSlug,
      target: request.target,
      targetProjectId: request.targetProjectId,
      planHash: request.planHash,
      collisionReportFingerprint: request.collisionReportFingerprint,
      operationCounts: { ...request.operationCounts },
      writesPerformed: request.operationCounts.operations,
      commitConfirmed: true,
    };

    for (const data of [
      null,
      {},
      "committed",
      { ...committedShape, extra: true },
      (() => {
        const { commitConfirmed: _c, ...partial } = committedShape;
        return partial;
      })(),
      { ...committedShape, writesPerformed: committedShape.writesPerformed - 1 },
      { ...committedShape, approvalDigest: "0".repeat(64) },
      { ...committedShape, executionId: "not-a-uuid" },
      { ...committedShape, outcome: "unknown" },
    ]) {
      const { executor, server } = harness({ malformedData: data });
      server.registerApproval(request);
      const outcome = await executor.executeApprovedImportRequest(request);
      expect(outcome).toEqual({
        outcome: "failed_rollback_unconfirmed",
        reasonCode: "server_response_invalid",
      });
    }
  });
});

describe("RC5.5D live adapter: parsers", () => {
  it("parses only exact whitelisted server error codes", () => {
    expect(
      parseServerErrorReasonCode({ message: "forever_import_execution: approval_expired" }),
    ).toBe("approval_expired");
    expect(
      parseServerErrorReasonCode({ message: "forever_import_execution: made_up_code" }),
    ).toBeNull();
    expect(
      parseServerErrorReasonCode({
        message: "prefix forever_import_execution: approval_expired",
      }),
    ).toBeNull();
    expect(parseServerErrorReasonCode({ message: 42 })).toBeNull();
    expect(parseServerErrorReasonCode(null)).toBeNull();
  });

  it("cross-checks every committed-result field against the request", async () => {
    const request = await validRequest();
    const server = new FakeImportExecutionServer();
    server.registerApproval(request);
    const response = await server.call(request);
    expect(response.error).toBeNull();
    expect(parseServerCommittedResult(response.result, request)).not.toBeNull();
    expect(
      parseServerCommittedResult(response.result, { ...request, planHash: "0".repeat(64) }),
    ).toBeNull();
  });
});

describe("RC5.5D direct-PostgreSQL transport contract", () => {
  it("targets one fixed schema-qualified statement in forever_execution, not public/PostgREST", () => {
    expect(APPROVED_IMPORT_EXECUTION_FUNCTION).toBe(
      "forever_execution.forever_execute_approved_import",
    );
    expect(APPROVED_IMPORT_EXECUTION_STATEMENT).toBe(
      "SELECT forever_execution.forever_execute_approved_import($1::jsonb)",
    );
    // Exactly one bound parameter ($1); no caller-supplied schema/table/SQL.
    expect((APPROVED_IMPORT_EXECUTION_STATEMENT.match(/\$/g) ?? []).length).toBe(1);
    expect(APPROVED_IMPORT_EXECUTION_STATEMENT).not.toMatch(/\bpublic\./);
  });

  it("exposes exactly one transport method that takes only the request", () => {
    // The fake transport implements ApprovedImportDatabaseTransport; its single
    // method is executeApprovedImport(request) — no function-name/SQL argument.
    const transport: ApprovedImportDatabaseTransport = new FakeApprovedImportDatabaseTransport(
      new FakeImportExecutionServer(),
    );
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(transport)).filter(
      (name) => name !== "constructor" && typeof (transport as never)[name] === "function",
    );
    expect(methods).toEqual(["executeApprovedImport"]);
    expect(transport.executeApprovedImport.length).toBe(1);
  });

  it("has a repository-default transport factory that fails closed", () => {
    expect(() => disabledApprovedImportDatabaseTransportFactory()).toThrow();
  });
});
