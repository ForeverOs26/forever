import { describe, expect, it } from "vitest";

import { computeApprovalDigest } from "./execution-approval";
import { fingerprintCollisionReport } from "./collision-inspector";
import {
  buildServerExecutionRequest,
  canonicalServerExecutionRequest,
  fingerprintServerExecutionRequest,
  isSafeSourceFileName,
  MAX_SERVER_EXECUTION_OPERATIONS,
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
import { absentCollisionReport, fingerprintFor } from "./test-fixtures/execution-fixtures";
import type { ImportOperation } from "./types";

const APPROVAL_DIGEST = computeApprovalDigest("approval-test-0001");

async function buildRequestFor(operations: ImportOperation[]): Promise<ServerExecutionRequest> {
  const fingerprint = fingerprintFor(operations);
  const report = await absentCollisionReport(operations);
  const built = buildServerExecutionRequest({
    manifest: MANIFEST,
    operations,
    operationCounts: fingerprint.operationCounts,
    planHash: fingerprint.hash,
    target: "local",
    targetProjectId: HERMETIC_IDENTITY.projectId,
    approvalDigest: APPROVAL_DIGEST,
    collisionReportFingerprint: fingerprintCollisionReport(report),
  });
  if (!built.ok) throw new Error(`expected a valid request, got ${built.code}`);
  return built.request;
}

function smallOperations(): ImportOperation[] {
  return [
    projectOperation(),
    buildingOperation("A"),
    unitOperation("A-101", { buildingCode: "A" }),
    priceOperation("A-101", { buildingCode: "A" }),
  ];
}

/** Deep-cloned tampered copy; the fingerprint is NOT recomputed. */
function tampered(
  request: ServerExecutionRequest,
  mutate: (draft: ServerExecutionRequest) => void,
): ServerExecutionRequest {
  const draft = structuredClone(request);
  mutate(draft);
  return draft;
}

/** Tampered copy with the fingerprint recomputed, to reach later checks. */
function tamperedResigned(
  request: ServerExecutionRequest,
  mutate: (draft: ServerExecutionRequest) => void,
): ServerExecutionRequest {
  const draft = structuredClone(request);
  mutate(draft);
  draft.requestFingerprint = fingerprintServerExecutionRequest(
    draft as unknown as Record<string, unknown>,
  );
  return draft;
}

describe("RC5.5D server request: construction", () => {
  it("builds the 405-operation Coralina-shaped request from the shared projections", async () => {
    const request = await buildRequestFor(coralinaHermeticOperations());

    expect(request.schemaVersion).toBe("1");
    expect(request.projectSlug).toBe("coralina");
    expect(request.operationCounts).toEqual({
      projects: 1,
      buildings: 8,
      units: 198,
      priceHistoryRows: 198,
      operations: 405,
    });
    expect(request.entities.buildings).toHaveLength(8);
    expect(request.entities.units).toHaveLength(198);
    expect(request.entities.priceHistory).toHaveLength(198);
    expect(request.entities.project.developer_slug).toBe("rhom-bho-property");
    expect(request.entities.project.location_slug).toBe("kamala");
    expect(validateServerExecutionRequest(request)).toBeNull();
  });

  it("is deterministic: identical inputs produce identical canonical bytes and fingerprints", async () => {
    const first = await buildRequestFor(coralinaHermeticOperations());
    const second = await buildRequestFor(coralinaHermeticOperations());

    expect(canonicalServerExecutionRequest(first)).toBe(canonicalServerExecutionRequest(second));
    expect(first.requestFingerprint).toBe(second.requestFingerprint);
    expect(first.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("contains no volatile runtime fields: the canonical form has no timestamps or random ids", async () => {
    const request = await buildRequestFor(smallOperations());
    const canonical = canonicalServerExecutionRequest(request);
    // recorded_at / price_list_date are stable source dates, not runtime time.
    expect(canonical).not.toContain(
      new Date().getFullYear() === 2026 ? "generatedAt" : "generatedAt",
    );
    expect(canonical).not.toMatch(/"issuedAt"|"expiresAt"|"createdAt"|"now"/);
  });

  it("fails closed on an invalid operation set instead of building a request", async () => {
    const operations = smallOperations();
    const fingerprint = fingerprintFor(operations);
    const report = await absentCollisionReport(operations);
    const built = buildServerExecutionRequest({
      manifest: MANIFEST,
      operations: [...operations, buildingOperation("A")],
      operationCounts: fingerprint.operationCounts,
      planHash: fingerprint.hash,
      target: "local",
      targetProjectId: HERMETIC_IDENTITY.projectId,
      approvalDigest: APPROVAL_DIGEST,
      collisionReportFingerprint: fingerprintCollisionReport(report),
    });
    expect(built).toEqual({ ok: false, code: "operation_set_invalid" });
  });

  it("fails closed when a price payload violates the server contract (null price)", async () => {
    const operations = [
      projectOperation(),
      buildingOperation("A"),
      unitOperation("A-101", { buildingCode: "A" }),
      priceOperation("A-101", { buildingCode: "A", price: null }),
    ];
    const fingerprint = fingerprintFor(operations);
    const report = await absentCollisionReport(operations);
    const built = buildServerExecutionRequest({
      manifest: MANIFEST,
      operations,
      operationCounts: fingerprint.operationCounts,
      planHash: fingerprint.hash,
      target: "local",
      targetProjectId: HERMETIC_IDENTITY.projectId,
      approvalDigest: APPROVAL_DIGEST,
      collisionReportFingerprint: fingerprintCollisionReport(report),
    });
    expect(built).toEqual({ ok: false, code: "request_invalid_field" });
  });
});

describe("RC5.5D server request: validation fails closed", () => {
  it("rejects non-objects and unsupported schema versions", async () => {
    const request = await buildRequestFor(smallOperations());
    expect(validateServerExecutionRequest(null)).toBe("request_malformed");
    expect(validateServerExecutionRequest([request])).toBe("request_malformed");
    expect(validateServerExecutionRequest("{}")).toBe("request_malformed");
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          (draft as { schemaVersion: string }).schemaVersion = "2";
        }),
      ),
    ).toBe("request_schema_unsupported");
  });

  it("rejects unknown top-level, entity, and nested properties", async () => {
    const request = await buildRequestFor(smallOperations());
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          (draft as unknown as Record<string, unknown>).extra = true;
        }),
      ),
    ).toBe("request_unsupported_property");
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          (draft.entities as unknown as Record<string, unknown>).sql = "DROP TABLE";
        }),
      ),
    ).toBe("request_unsupported_property");
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          (draft.entities.units[0] as unknown as Record<string, unknown>).view_type = "sea";
        }),
      ),
    ).toBe("request_unsupported_property");
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          delete (draft.entities.priceHistory[0] as unknown as Record<string, unknown>).currency;
        }),
      ),
    ).toBe("request_unsupported_property");
  });

  it("rejects malformed identifiers and digests", async () => {
    const request = await buildRequestFor(smallOperations());
    for (const mutate of [
      (draft: ServerExecutionRequest) =>
        void ((draft as { projectSlug: string }).projectSlug = "Bad Slug"),
      (draft: ServerExecutionRequest) => void ((draft as { planHash: string }).planHash = "xyz"),
      (draft: ServerExecutionRequest) =>
        void ((draft as { approvalDigest: string }).approvalDigest = "raw-approval-id-0001"),
      (draft: ServerExecutionRequest) =>
        void ((draft as { targetProjectId: string }).targetProjectId = ""),
    ]) {
      expect(validateServerExecutionRequest(tampered(request, mutate))).toBe(
        "request_invalid_field",
      );
    }
  });

  it("rejects inconsistent, negative, or non-integer operation counts", async () => {
    const request = await buildRequestFor(smallOperations());
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          draft.operationCounts.units = 2;
        }),
      ),
    ).toBe("request_operation_counts_invalid");
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          draft.operationCounts.projects = 0;
          draft.operationCounts.operations = 3;
        }),
      ),
    ).toBe("request_operation_counts_invalid");
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          draft.operationCounts.buildings = 0.5;
        }),
      ),
    ).toBe("request_operation_counts_invalid");
  });

  it("rejects a plan above the operation ceiling", async () => {
    const buildingCodes = ["A"];
    const operations: ImportOperation[] = [projectOperation(), buildingOperation("A")];
    const unitOps: ImportOperation[] = [];
    const priceOps: ImportOperation[] = [];
    for (let index = 0; index < 500; index += 1) {
      const unitNumber = `A-${String(index + 1).padStart(3, "0")}`;
      unitOps.push(unitOperation(unitNumber, { buildingCode: buildingCodes[0] }));
      priceOps.push(priceOperation(unitNumber, { buildingCode: buildingCodes[0] }));
    }
    operations.push(...unitOps, ...priceOps);
    expect(operations.length).toBeGreaterThan(MAX_SERVER_EXECUTION_OPERATIONS);

    const fingerprint = fingerprintFor(operations);
    const report = await absentCollisionReport(operations);
    const built = buildServerExecutionRequest({
      manifest: MANIFEST,
      operations,
      operationCounts: fingerprint.operationCounts,
      planHash: fingerprint.hash,
      target: "local",
      targetProjectId: HERMETIC_IDENTITY.projectId,
      approvalDigest: APPROVAL_DIGEST,
      collisionReportFingerprint: fingerprintCollisionReport(report),
    });
    expect(built).toEqual({ ok: false, code: "request_operation_count_exceeded" });
  });

  it("rejects oversized payloads", async () => {
    const request = await buildRequestFor(smallOperations());
    const oversized = tamperedResigned(request, (draft) => {
      draft.entities.units[0].metadata = { blob: "x".repeat(4_000_001) };
    });
    expect(validateServerExecutionRequest(oversized)).toBe("request_too_large");
  });

  it("rejects duplicate natural keys and duplicate persistence keys", async () => {
    const request = await buildRequestFor(smallOperations());
    expect(
      validateServerExecutionRequest(
        tamperedResigned(request, (draft) => {
          draft.entities.buildings.push({ ...draft.entities.buildings[0] });
          draft.operationCounts.buildings += 1;
          draft.operationCounts.operations += 1;
        }),
      ),
    ).toBe("request_duplicate_natural_key");
    expect(
      validateServerExecutionRequest(
        tamperedResigned(request, (draft) => {
          draft.entities.priceHistory.push({
            ...draft.entities.priceHistory[0],
            metadata: { different: true },
          });
          draft.operationCounts.priceHistoryRows += 1;
          draft.operationCounts.operations += 1;
        }),
      ),
    ).toBe("request_duplicate_persistence_key");
  });

  it("rejects unresolved parent references", async () => {
    const request = await buildRequestFor(smallOperations());
    expect(
      validateServerExecutionRequest(
        tamperedResigned(request, (draft) => {
          draft.entities.units[0].building_code = "ZZ";
        }),
      ),
    ).toBe("request_missing_parent_reference");
    expect(
      validateServerExecutionRequest(
        tamperedResigned(request, (draft) => {
          draft.entities.priceHistory[0].unit_code = "Z-999";
        }),
      ),
    ).toBe("request_missing_parent_reference");
  });

  it("rejects raw local paths anywhere a source_file appears", async () => {
    expect(isSafeSourceFileName("price-list.pdf")).toBe(true);
    expect(isSafeSourceFileName("/home/owner/price-list.pdf")).toBe(false);
    expect(isSafeSourceFileName("C:\\data\\price-list.pdf")).toBe(false);

    const request = await buildRequestFor(smallOperations());
    expect(
      validateServerExecutionRequest(
        tamperedResigned(request, (draft) => {
          draft.entities.priceHistory[0].source_file = "/tmp/leaked/price-list.pdf";
        }),
      ),
    ).toBe("request_unsafe_path");
    expect(
      validateServerExecutionRequest(
        tamperedResigned(request, (draft) => {
          draft.entities.units[0].metadata = { source_file: "C:\\Users\\owner\\a.pdf" };
        }),
      ),
    ).toBe("request_unsafe_path");
  });

  it("rejects credential material anywhere in the request", async () => {
    const request = await buildRequestFor(smallOperations());
    for (const value of [
      "sb_secret_abc123",
      "sb_publishable_abc123",
      "eyJhbGciOiJIUzI1NiJ9.payload.sig",
      "postgres://user:pass@host/db",
      "Bearer abc.def.ghi",
      "SUPABASE_SERVICE_ROLE_KEY=x",
    ]) {
      expect(
        validateServerExecutionRequest(
          tamperedResigned(request, (draft) => {
            draft.entities.units[0].metadata = { note: value };
          }),
        ),
      ).toBe("request_credential_material");
    }
  });

  it("rejects any tamper that breaks the fingerprint binding", async () => {
    const request = await buildRequestFor(smallOperations());
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          draft.entities.units[0].bedrooms = 99;
        }),
      ),
    ).toBe("request_fingerprint_mismatch");
    expect(
      validateServerExecutionRequest(
        tampered(request, (draft) => {
          (draft as { requestFingerprint: string }).requestFingerprint = "0".repeat(64);
        }),
      ),
    ).toBe("request_fingerprint_mismatch");
  });
});
