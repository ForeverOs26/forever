/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — CLIENT ASSET COMPATIBILITY and
 * IMMUTABLE WORKER RELEASE IDENTITY are two different contracts.
 *
 * Closes narrow-re-review RR2-P1-1, which measured a different deployable
 * Worker shipping under an identical client asset identity while the release
 * runbook spent that identity as its gate in both directions.
 *
 * Everything here is about the SEPARATION. The client identity's own
 * completeness over the client graph is proved in `client-asset-identity.test.ts`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  INVALID_PRE_R2_WORKER_VERSION_PREFIX,
  RELEASE_PROVENANCE_FIELDS,
  WORKER_VERSION_ID_PATTERN,
  isLocalReleaseManifest,
  isWorkerVersionId,
  verifyReleaseProvenance,
  verifyRollbackTarget,
} from "./worker-release-identity";
import { FOREVER_CLIENT_ASSET_ID_PATTERN } from "./client-asset-id-contract";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Two real-shaped Cloudflare Worker version ids. Invented, never deployed. */
const CANDIDATE = "3f1b8c2e-4a7d-4e51-9c60-b2a19d47f0e8";
const PREVIOUS = "b7d40a19-2c88-4f36-8f21-5e0c9a1d3b77";
/** A 32-hex client asset identity, the exact shape the runbook used to spend. */
const CLIENT_ASSET_ID = "24834ab95d7b514e8fae653a5d18e4a8";

function provenance(overrides: Record<string, unknown> = {}) {
  return {
    sourceCommit: "80af5fa29d1f8e6af2dc9423c6df650b1245fcf0",
    sourceTree: "a9554e19a9f8ba5830e318c24ad3fe73cd7c471e",
    clientAssetId: CLIENT_ASSET_ID,
    candidateWorkerVersionId: CANDIDATE,
    previousWorkerVersionId: PREVIOUS,
    compatibilityDate: "2026-07-30",
    configFingerprint: "a84f49b175733709ea09f4f5197913cb",
    migrationLedgerState: "applied:20260728120000",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The two identifiers cannot be mistaken for one another
// ---------------------------------------------------------------------------

describe("the two identity shapes are disjoint", () => {
  it("a Worker version is a UUID and a client asset identity never is", () => {
    expect(isWorkerVersionId(CANDIDATE)).toBe(true);
    expect(isWorkerVersionId(PREVIOUS)).toBe(true);
    expect(isWorkerVersionId(CLIENT_ASSET_ID)).toBe(false);
    expect(FOREVER_CLIENT_ASSET_ID_PATTERN.test(CANDIDATE)).toBe(false);
    expect(FOREVER_CLIENT_ASSET_ID_PATTERN.test(CLIENT_ASSET_ID)).toBe(true);
  });

  it("refuses every near-miss someone might paste into a release record", () => {
    for (const bad of [
      "",
      "3f1b8c2e",
      "3f1b8c2e-4a7d-4e51-9c60-b2a19d47f0e",
      "3F1B8C2E-4A7D-4E51-9C60-B2A19D47F0E8",
      "3f1b8c2e4a7d4e519c60b2a19d47f0e8",
      "https://3f1b8c2e-forever.example.workers.dev",
      "v42",
      "latest",
      CLIENT_ASSET_ID,
      42,
      null,
      undefined,
      {},
    ]) {
      expect(isWorkerVersionId(bad), String(bad)).toBe(false);
    }
    expect(WORKER_VERSION_ID_PATTERN.source).toContain("[0-9a-f]{12}");
  });
});

// ---------------------------------------------------------------------------
// A Worker release identity is never manufactured in this repository
// ---------------------------------------------------------------------------

describe("nothing local invents a Worker version", () => {
  it("the module exposes no derive function and hashes nothing", () => {
    const source = read("src/lib/stale-asset/worker-release-identity.ts");
    expect(source).not.toContain("createHash");
    expect(source).not.toContain("randomUUID");
    expect(source).not.toContain("Date.now");
    expect(source).not.toMatch(/export function deriveWorkerReleaseId/);
    expect(source).toContain("NEVER MANUFACTURED HERE");
  });

  it("the build orchestrator writes a null Worker version and says why", () => {
    const orchestrator = read("scripts/build/build-forever.mjs");
    expect(orchestrator).toContain("workerVersionId: null");
    expect(orchestrator).toContain("isNotAWorkerReleaseIdentity: true");
    expect(orchestrator).toContain('workerVersionIdSource: "cloudflare-versions-upload"');
    expect(orchestrator).not.toContain("randomUUID");
  });

  it("no Worker version identifier is ever exposed to the browser", () => {
    // The client half imports the client asset contract and nothing else. It
    // may NAME the Worker module in prose — it must not depend on it, and it
    // must carry no Worker version value.
    const browser = read("src/lib/stale-asset/client-asset-identity.ts");
    expect(browser).not.toMatch(/^import .*worker-release-identity/m);
    expect(browser).not.toContain("workerVersionId");
    expect(browser).not.toMatch(WORKER_VERSION_ID_PATTERN);
    const route = read("src/routes/forever-client-assets[.]json.ts");
    expect(route).not.toContain("workerVersion");
    expect(route).toContain("JSON.stringify({ clientAssetId: FOREVER_CLIENT_ASSET_ID })");
  });

  it("the public endpoint exposes ONLY the bounded client identity", () => {
    const route = read("src/routes/forever-client-assets[.]json.ts");
    const body = route.slice(route.indexOf("GET: () =>"));
    // Exactly one interpolated value in the response body.
    expect(body.match(/FOREVER_CLIENT_ASSET_ID/g)).toHaveLength(1);
    for (const forbidden of [
      "process.env",
      "R2_",
      "SUPABASE",
      "wrangler",
      "version_id",
      "account_id",
      "sourceCommit",
      "sourceTree",
      "configFingerprint",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// The release provenance record
// ---------------------------------------------------------------------------

describe("release provenance records all eight facts together", () => {
  it("accepts a complete, well-formed record", () => {
    expect(verifyReleaseProvenance(provenance())).toEqual({ accepted: true });
    expect([...RELEASE_PROVENANCE_FIELDS]).toHaveLength(8);
  });

  it("refuses a record missing any single fact, naming it", () => {
    for (const field of RELEASE_PROVENANCE_FIELDS) {
      const incomplete = provenance();
      delete (incomplete as Record<string, unknown>)[field];
      expect(verifyReleaseProvenance(incomplete), field).toEqual({
        accepted: false,
        refusal: "missing_field",
        field,
      });
    }
  });

  it("REFUSES a candidate Worker version equal to the previous one", () => {
    // A server-only release that was never uploaded looks exactly like this.
    expect(verifyReleaseProvenance(provenance({ candidateWorkerVersionId: PREVIOUS }))).toEqual({
      accepted: false,
      refusal: "candidate_worker_version_not_new",
    });
  });

  it("REFUSES a client asset identity standing in for a Worker version", () => {
    expect(
      verifyReleaseProvenance(provenance({ candidateWorkerVersionId: CLIENT_ASSET_ID })),
    ).toEqual({ accepted: false, refusal: "client_asset_id_used_as_worker_version" });
    expect(
      verifyReleaseProvenance(provenance({ previousWorkerVersionId: CLIENT_ASSET_ID })),
    ).toEqual({ accepted: false, refusal: "client_asset_id_used_as_worker_version" });
  });

  it("REFUSES anything that is not a Worker version UUID in either slot", () => {
    expect(verifyReleaseProvenance(provenance({ candidateWorkerVersionId: "3f1b8c2e" }))).toEqual({
      accepted: false,
      refusal: "candidate_worker_version_not_a_uuid",
    });
    expect(verifyReleaseProvenance(provenance({ previousWorkerVersionId: "previous" }))).toEqual({
      accepted: false,
      refusal: "previous_worker_version_not_a_uuid",
    });
  });

  it("ACCEPTS a server-only release: identical client assets, different Worker", () => {
    // The exact case RR2-P1-1 measured. The client identity repeating is not a
    // fault; the release is verifiable because the tree and the Worker moved.
    const first = provenance();
    const serverOnly = provenance({
      sourceCommit: "1111111111111111111111111111111111111111",
      sourceTree: "2222222222222222222222222222222222222222",
      candidateWorkerVersionId: "c8e19a04-77b3-4d92-9a15-6f3e2b0d81ca",
      previousWorkerVersionId: CANDIDATE,
    });
    expect(verifyReleaseProvenance(serverOnly)).toEqual({ accepted: true });
    expect(serverOnly.clientAssetId).toBe(first.clientAssetId);
    expect(serverOnly.sourceTree).not.toBe(first.sourceTree);
    expect(serverOnly.candidateWorkerVersionId).not.toBe(first.candidateWorkerVersionId);
  });

  it("refuses nothing at all", () => {
    expect(verifyReleaseProvenance(null)).toEqual({ accepted: false, refusal: "missing_field" });
    expect(verifyReleaseProvenance(undefined)).toEqual({
      accepted: false,
      refusal: "missing_field",
    });
  });
});

// ---------------------------------------------------------------------------
// The rollback target
// ---------------------------------------------------------------------------

describe("a rollback target is a retained Worker version UUID and nothing else", () => {
  it("accepts the exact retained previous version", () => {
    expect(
      verifyRollbackTarget({ target: PREVIOUS, retainedPreviousWorkerVersionId: PREVIOUS }),
    ).toEqual({ accepted: true });
  });

  it("REFUSES a client asset identity as the rollback target", () => {
    expect(
      verifyRollbackTarget({
        target: CLIENT_ASSET_ID,
        retainedPreviousWorkerVersionId: PREVIOUS,
        clientAssetId: CLIENT_ASSET_ID,
      }),
    ).toEqual({ accepted: false, refusal: "target_is_a_client_asset_id" });
  });

  it("REFUSES a version that is not the retained one", () => {
    expect(
      verifyRollbackTarget({ target: CANDIDATE, retainedPreviousWorkerVersionId: PREVIOUS }),
    ).toEqual({ accepted: false, refusal: "target_not_the_retained_previous_version" });
  });

  it("REFUSES a rollback when no previous version was retained", () => {
    for (const missing of [null, undefined, "", "unknown"]) {
      expect(
        verifyRollbackTarget({ target: PREVIOUS, retainedPreviousWorkerVersionId: missing }),
        String(missing),
      ).toEqual({ accepted: false, refusal: "target_not_the_retained_previous_version" });
    }
  });

  it("REFUSES the known invalid pre-R2 Worker", () => {
    const preR2 = `${INVALID_PRE_R2_WORKER_VERSION_PREFIX}-1111-4111-8111-111111111111`;
    expect(verifyRollbackTarget({ target: preR2, retainedPreviousWorkerVersionId: preR2 })).toEqual(
      { accepted: false, refusal: "target_is_the_known_invalid_pre_r2_worker" },
    );
  });

  it("REFUSES anything that is not a UUID at all", () => {
    for (const bad of [null, undefined, "", "previous", "latest", "v3"]) {
      expect(
        verifyRollbackTarget({ target: bad, retainedPreviousWorkerVersionId: PREVIOUS }),
        String(bad),
      ).toEqual({ accepted: false, refusal: "target_not_a_worker_version_uuid" });
    }
  });
});

// ---------------------------------------------------------------------------
// The local release manifest
// ---------------------------------------------------------------------------

describe("the local release manifest never claims to be a Worker identity", () => {
  const manifest = {
    kind: "forever-local-release-manifest" as const,
    sourceCommit: "80af5fa29d1f8e6af2dc9423c6df650b1245fcf0",
    sourceTree: "a9554e19a9f8ba5830e318c24ad3fe73cd7c471e",
    clientAssetId: CLIENT_ASSET_ID,
    compatibilityDate: "2026-07-30",
    configFingerprint: "a84f49b175733709ea09f4f5197913cb",
    workerVersionId: null,
    isNotAWorkerReleaseIdentity: true as const,
    workerVersionIdSource: "cloudflare-versions-upload" as const,
  };

  it("recognises a well-formed manifest", () => {
    expect(isLocalReleaseManifest(manifest)).toBe(true);
  });

  it("refuses a manifest that carries a Worker version", () => {
    expect(isLocalReleaseManifest({ ...manifest, workerVersionId: CANDIDATE })).toBe(false);
    expect(isLocalReleaseManifest({ ...manifest, isNotAWorkerReleaseIdentity: false })).toBe(false);
  });

  it("is NOT a release provenance record — two facts are still missing", () => {
    // The distinction that matters: a manifest cannot be promoted into a
    // release record by wishing, because the two Worker version fields are the
    // only ones a local build cannot fill.
    expect(verifyReleaseProvenance(manifest as never)).toEqual({
      accepted: false,
      refusal: "missing_field",
      field: "candidateWorkerVersionId",
    });
  });

  it("carries no secret, credential, binding value or environment variable", () => {
    for (const [, value] of Object.entries(manifest)) {
      const text = String(value);
      for (const forbidden of ["sb_", "eyJ", "SERVICE_ROLE", "R2_", "http://", "https://"]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    }
  });
});
