import { describe, expect, it, vi } from "vitest";

import { computeApprovalDigest } from "./execution-approval";
import { fingerprintCollisionReport } from "./collision-inspector";
import { createEnvExecutionCredentialProvider } from "./execution-credentials";
import {
  CANONICAL_SUPABASE_PROJECT_REF,
  ExecutionEndpointError,
  FOREVER_IMPORT_EXECUTOR_ROLE,
  parseSupabaseExecutionEndpoint,
  verifyExecutionDatabaseEndpoint,
  verifyExecutionEndpoint,
} from "./execution-endpoint";
import { createServerExecutionAdapter } from "./live-execution-adapter";
import {
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
} from "./test-fixtures/server-execution-fixtures";
import type { ImportOperation } from "./types";

const CANONICAL_URL = "https://abtvsrcnfwlbawvrjeed.supabase.co";

function endpointCode(rawUrl: string): string | null {
  try {
    parseSupabaseExecutionEndpoint(rawUrl);
    return null;
  } catch (error) {
    return error instanceof ExecutionEndpointError ? error.code : "unexpected";
  }
}

async function validRequest(
  overrides: { targetProjectId?: string } = {},
): Promise<ServerExecutionRequest> {
  const operations: ImportOperation[] = [
    projectOperation(),
    buildingOperation("A"),
    unitOperation("A-101", { buildingCode: "A" }),
    priceOperation("A-101", { buildingCode: "A" }),
  ];
  const fingerprint = fingerprintFor(operations);
  const report = await absentCollisionReport(operations);
  const built = buildServerExecutionRequest({
    manifest: MANIFEST,
    operations,
    operationCounts: fingerprint.operationCounts,
    planHash: fingerprint.hash,
    target: "local",
    targetProjectId: overrides.targetProjectId ?? HERMETIC_IDENTITY.projectId,
    approvalDigest: computeApprovalDigest("approval-test-0001"),
    collisionReportFingerprint: fingerprintCollisionReport(report),
  });
  if (!built.ok) throw new Error(`fixture request invalid: ${built.code}`);
  return built.request;
}

describe("RC5.5D endpoint identity: strict URL parsing", () => {
  it("accepts exactly the canonical Supabase endpoint form", () => {
    expect(parseSupabaseExecutionEndpoint(CANONICAL_URL)).toEqual({
      projectRef: CANONICAL_SUPABASE_PROJECT_REF,
      origin: CANONICAL_URL,
    });
    expect(parseSupabaseExecutionEndpoint(`${CANONICAL_URL}/`)).toEqual({
      projectRef: CANONICAL_SUPABASE_PROJECT_REF,
      origin: CANONICAL_URL,
    });
  });

  it("rejects HTTP, arbitrary hosts, and deceptive hostname variants", () => {
    expect(endpointCode("http://abtvsrcnfwlbawvrjeed.supabase.co")).toBe(
      "execution_endpoint_invalid",
    );
    expect(endpointCode("https://example.com")).toBe("execution_endpoint_invalid");
    expect(endpointCode("https://abtvsrcnfwlbawvrjeed.supabase.co.evil.com")).toBe(
      "execution_endpoint_invalid",
    );
    expect(endpointCode("https://evil-abtvsrcnfwlbawvrjeed.supabase.co")).toBe(
      "execution_endpoint_invalid",
    );
    expect(endpointCode("https://xabtvsrcnfwlbawvrjeed.supabase.co")).toBe(
      "execution_endpoint_invalid",
    );
    expect(endpointCode("https://abtvsrcnfwlbawvrjeed.supabase.co.attacker.supabase.co")).toBe(
      "execution_endpoint_invalid",
    );
    expect(endpointCode("https://supabase.co")).toBe("execution_endpoint_invalid");
  });

  it("rejects userinfo, ports, paths, query strings, and fragments", () => {
    expect(endpointCode(`https://user:pass@abtvsrcnfwlbawvrjeed.supabase.co`)).toBe(
      "execution_endpoint_invalid",
    );
    expect(endpointCode(`https://user@abtvsrcnfwlbawvrjeed.supabase.co`)).toBe(
      "execution_endpoint_invalid",
    );
    expect(endpointCode(`${CANONICAL_URL}:8443`)).toBe("execution_endpoint_invalid");
    expect(endpointCode(`${CANONICAL_URL}/rest/v1`)).toBe("execution_endpoint_invalid");
    expect(endpointCode(`${CANONICAL_URL}?apikey=leak`)).toBe("execution_endpoint_invalid");
    expect(endpointCode(`${CANONICAL_URL}?`)).toBe("execution_endpoint_invalid");
    expect(endpointCode(`${CANONICAL_URL}#fragment`)).toBe("execution_endpoint_invalid");
    expect(endpointCode(`${CANONICAL_URL}#`)).toBe("execution_endpoint_invalid");
  });

  it("rejects malformed URLs and whitespace/quote/CRLF variants without normalizing", () => {
    for (const raw of [
      "",
      "not a url",
      "supabase",
      ` ${CANONICAL_URL}`,
      `${CANONICAL_URL} `,
      `${CANONICAL_URL}\n`,
      `${CANONICAL_URL}\r\n`,
      `"${CANONICAL_URL}"`,
      `'${CANONICAL_URL}'`,
      `${CANONICAL_URL}\t`,
      "https://abtvsrcnfwlbawvrjeed\u0000.supabase.co",
    ]) {
      expect(endpointCode(raw)).toBe("execution_endpoint_invalid");
    }
  });

  it("rejects a well-formed Supabase URL for a different (legacy/wrong) project ref", () => {
    expect(() =>
      verifyExecutionEndpoint({
        url: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
        requestTarget: "local",
        requestTargetProjectId: "forever-local",
      }),
    ).toThrowError(new ExecutionEndpointError("execution_endpoint_mismatch"));
  });

  it("binds the request target identity to the validated endpoint configuration", () => {
    expect(
      verifyExecutionEndpoint({
        url: CANONICAL_URL,
        requestTarget: "local",
        requestTargetProjectId: "forever-local",
      }),
    ).toEqual({
      projectRef: CANONICAL_SUPABASE_PROJECT_REF,
      origin: CANONICAL_URL,
      target: "local",
    });

    // Canonical endpoint but wrong request target identity.
    expect(() =>
      verifyExecutionEndpoint({
        url: CANONICAL_URL,
        requestTarget: "local",
        requestTargetProjectId: "some-other-identity",
      }),
    ).toThrowError(new ExecutionEndpointError("execution_target_mismatch"));

    // Canonical endpoint but an unconfigured target name (staging/production).
    for (const target of ["staging", "production"]) {
      expect(() =>
        verifyExecutionEndpoint({
          url: CANONICAL_URL,
          requestTarget: target,
          requestTargetProjectId: "forever-local",
        }),
      ).toThrowError(new ExecutionEndpointError("execution_target_mismatch"));
    }
  });

  it("never includes the raw URL or host in its failures", () => {
    for (const raw of ["https://evil.example.com", `https://user:pass@${CANONICAL_URL.slice(8)}`]) {
      try {
        parseSupabaseExecutionEndpoint(raw);
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toBe("execution_endpoint_invalid");
        expect(JSON.stringify(error)).not.toContain("evil");
        expect(JSON.stringify(error)).not.toContain("pass");
      }
    }
  });
});

describe("RC5.5D database principal identity: least-privilege binding", () => {
  const base = {
    mode: "direct" as const,
    projectRef: CANONICAL_SUPABASE_PROJECT_REF,
    role: FOREVER_IMPORT_EXECUTOR_ROLE,
    region: null,
    requestTarget: "local",
    requestTargetProjectId: "forever-local",
  };

  it("accepts the canonical ref + dedicated executor role over the direct route", () => {
    expect(verifyExecutionDatabaseEndpoint(base)).toEqual({
      mode: "direct",
      projectRef: CANONICAL_SUPABASE_PROJECT_REF,
      role: FOREVER_IMPORT_EXECUTOR_ROLE,
      region: null,
      target: "local",
    });
  });

  it("accepts the canonical ref + executor role over the Supavisor session route", () => {
    expect(
      verifyExecutionDatabaseEndpoint({
        ...base,
        mode: "supavisor_session",
        region: "us-east-1",
      }),
    ).toEqual({
      mode: "supavisor_session",
      projectRef: CANONICAL_SUPABASE_PROJECT_REF,
      role: FOREVER_IMPORT_EXECUTOR_ROLE,
      region: "us-east-1",
      target: "local",
    });
  });

  it("rejects any principal that is not the dedicated least-privilege executor", () => {
    for (const role of ["service_role", "postgres", "authenticator", "anon", "authenticated"]) {
      expect(() => verifyExecutionDatabaseEndpoint({ ...base, role })).toThrowError(
        new ExecutionEndpointError("execution_principal_mismatch"),
      );
    }
  });

  it("rejects a non-canonical project ref even with the correct role", () => {
    expect(() =>
      verifyExecutionDatabaseEndpoint({ ...base, projectRef: "zzzzzzzzzzzzzzzzzzzz" }),
    ).toThrowError(new ExecutionEndpointError("execution_endpoint_mismatch"));
  });

  it("rejects a canonical ref+role when the request target identity disagrees", () => {
    expect(() =>
      verifyExecutionDatabaseEndpoint({
        ...base,
        requestTargetProjectId: "not-the-approved-identity",
      }),
    ).toThrowError(new ExecutionEndpointError("execution_target_mismatch"));
    for (const target of ["staging", "production"]) {
      expect(() =>
        verifyExecutionDatabaseEndpoint({ ...base, requestTarget: target }),
      ).toThrowError(new ExecutionEndpointError("execution_target_mismatch"));
    }
  });

  it("enforces a bound pooler region on the Supavisor route (and only then)", () => {
    // Committed config binds no region: any structurally valid region passes.
    expect(
      verifyExecutionDatabaseEndpoint({ ...base, mode: "supavisor_session", region: "eu-west-2" })
        .region,
    ).toBe("eu-west-2");

    // A configuration that DOES bind a region rejects a different region...
    const boundConfig = Object.freeze([
      Object.freeze({
        target: "local",
        targetProjectId: "forever-local",
        projectRef: CANONICAL_SUPABASE_PROJECT_REF,
        poolerRegion: "us-east-1",
      }),
    ]);
    expect(() =>
      verifyExecutionDatabaseEndpoint(
        { ...base, mode: "supavisor_session", region: "ap-southeast-1" },
        boundConfig,
      ),
    ).toThrowError(new ExecutionEndpointError("execution_region_mismatch"));
    // ...accepts the matching region...
    expect(
      verifyExecutionDatabaseEndpoint(
        { ...base, mode: "supavisor_session", region: "us-east-1" },
        boundConfig,
      ).region,
    ).toBe("us-east-1");
    // ...and the region binding never affects the direct route.
    expect(
      verifyExecutionDatabaseEndpoint({ ...base, mode: "direct", region: null }, boundConfig)
        .target,
    ).toBe("local");
  });
});

describe("RC5.5D endpoint identity: adapter binding before transport and network", () => {
  const CANONICAL_DB_HOST = "db.abtvsrcnfwlbawvrjeed.supabase.co";
  const CANONICAL_POOLER_HOST = "aws-0-us-east-1.pooler.supabase.com";
  function directUrl(host: string, role: string = FOREVER_IMPORT_EXECUTOR_ROLE): string {
    return `postgresql://${role}:hermetic-not-a-real-password@${host}:5432/postgres`;
  }
  function poolerUrl(user: string, host = CANONICAL_POOLER_HOST, port = "5432"): string {
    return `postgresql://${user}:hermetic-not-a-real-password@${host}:${port}/postgres`;
  }
  const CANONICAL_POOLER_USER = `${FOREVER_IMPORT_EXECUTOR_ROLE}.abtvsrcnfwlbawvrjeed`;

  function adapterWith(url: string) {
    const server = new FakeImportExecutionServer();
    const transport = new FakeApprovedImportDatabaseTransport(server);
    const factorySpy = vi.fn(() => transport);
    const executor = createServerExecutionAdapter({
      capability: { liveExecutionAuthorized: true },
      credentialProvider: createEnvExecutionCredentialProvider({
        FOREVER_IMPORT_EXECUTOR_DATABASE_URL: url,
      }),
      transportFactory: factorySpy,
    });
    return { server, executor, factorySpy };
  }

  it("rejects every non-canonical or non-executor credential before any transport or network call", async () => {
    const request = await validRequest();
    for (const [url, code] of [
      // service-role/publishable API keys are not DB URLs
      ["sb_secret_not_a_database_url", "execution_credentials_invalid"],
      // HTTPS is not a DB connection
      [`https://${CANONICAL_DB_HOST}`, "execution_credentials_invalid"],
      // deceptive host / non-canonical DB host form
      [directUrl("db.abtvsrcnfwlbawvrjeed.supabase.co.evil.com"), "execution_credentials_invalid"],
      // wrong principal role -> rejected at the credential boundary
      [directUrl(CANONICAL_DB_HOST, "service_role"), "execution_credentials_invalid"],
      [directUrl(CANONICAL_DB_HOST, "postgres"), "execution_credentials_invalid"],
      // well-formed executor URL for a DIFFERENT project ref -> endpoint mismatch
      [directUrl("db.zzzzzzzzzzzzzzzzzzzz.supabase.co"), "execution_endpoint_mismatch"],
      // Supavisor TRANSACTION mode (6543) -> rejected at the credential boundary
      [
        poolerUrl(CANONICAL_POOLER_USER, CANONICAL_POOLER_HOST, "6543"),
        "execution_credentials_invalid",
      ],
      // deceptive pooler host
      [
        poolerUrl(CANONICAL_POOLER_USER, "aws-0-us-east-1.pooler.supabase.com.evil.com"),
        "execution_credentials_invalid",
      ],
      // pooler for a DIFFERENT project ref (username suffix) -> endpoint mismatch
      [
        poolerUrl(`${FOREVER_IMPORT_EXECUTOR_ROLE}.zzzzzzzzzzzzzzzzzzzz`),
        "execution_endpoint_mismatch",
      ],
      // pooler with a foreign role in the username -> credential boundary
      [poolerUrl("service_role.abtvsrcnfwlbawvrjeed"), "execution_credentials_invalid"],
      // whitespace variant
      [`${directUrl(CANONICAL_DB_HOST)}\n`, "execution_credentials_invalid"],
    ] as const) {
      const { server, executor, factorySpy } = adapterWith(url);
      const outcome = await executor.executeApprovedImportRequest(request);
      expect(outcome).toEqual({ outcome: "rejected_before_transaction", reasonCode: code });
      expect(factorySpy).not.toHaveBeenCalled();
      expect(server.calls).toBe(0);
      expect(JSON.stringify(outcome)).not.toContain("supabase.co");
      expect(JSON.stringify(outcome)).not.toContain("pooler.supabase.com");
      expect(JSON.stringify(outcome)).not.toContain("hermetic-not-a-real-password");
    }
  });

  it("rejects a correct canonical executor endpoint when the request target identity is wrong", async () => {
    const request = await validRequest({ targetProjectId: "not-the-approved-identity" });
    for (const url of [directUrl(CANONICAL_DB_HOST), poolerUrl(CANONICAL_POOLER_USER)]) {
      const { server, executor, factorySpy } = adapterWith(url);
      const outcome = await executor.executeApprovedImportRequest(request);
      expect(outcome).toEqual({
        outcome: "rejected_before_transaction",
        reasonCode: "execution_target_mismatch",
      });
      expect(factorySpy).not.toHaveBeenCalled();
      expect(server.calls).toBe(0);
    }
  });

  it("commits over the direct route with exactly one transport creation", async () => {
    const request = await validRequest();
    const { server, executor, factorySpy } = adapterWith(directUrl(CANONICAL_DB_HOST));
    server.registerApproval(request);
    const outcome = await executor.executeApprovedImportRequest(request);
    expect(outcome.outcome).toBe("committed");
    expect(factorySpy).toHaveBeenCalledTimes(1);
    expect(server.calls).toBe(1);
  });

  it("commits over the IPv4 Supavisor session route with exactly one transport creation", async () => {
    const request = await validRequest();
    const { server, executor, factorySpy } = adapterWith(poolerUrl(CANONICAL_POOLER_USER));
    server.registerApproval(request);
    const outcome = await executor.executeApprovedImportRequest(request);
    expect(outcome.outcome).toBe("committed");
    expect(factorySpy).toHaveBeenCalledTimes(1);
    expect(server.calls).toBe(1);
  });
});
