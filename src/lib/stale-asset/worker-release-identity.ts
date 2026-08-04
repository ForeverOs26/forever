/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the IMMUTABLE WORKER RELEASE
 * IDENTITY, kept strictly apart from client asset compatibility.
 *
 * Closes narrow-re-review RR2-P1-1.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO REMOVE
 * ---------------------------------------------------------------------------
 *
 * The release runbook used to spend the client asset digest as its verification
 * gate in BOTH directions — "confirm the endpoint reports the new build id"
 * after the cutover, and "confirm it reports the previous build identity" after
 * the rollback. That was measured to be unfalsifiable for a server-only
 * release: appending one executable statement to a Nitro server plugin produced
 * a different deployable Worker under a byte-identical client graph and
 * therefore a byte-identical client identity. Both runbook steps were satisfied
 * before the change, by the change, and by its reversal. Neither could
 * distinguish the deployment it existed to verify.
 *
 * The fix is not to normalise arbitrary server bytes until they happen to hash
 * consistently. It is to stop conflating two contracts:
 *
 *   CLIENT ASSET COMPATIBILITY  — `client-asset-id-contract.ts`. Derived from
 *     the emitted client graph. Answers "can a page that is already running
 *     still fetch its own chunks?" and NOTHING else. May legitimately be
 *     unchanged by a server-only release.
 *
 *   WORKER RELEASE IDENTITY     — this module. The immutable Cloudflare Worker
 *     VERSION UUID that `wrangler versions upload` returns for the candidate.
 *     Answers "which Worker is deployed?" — which is the only question a
 *     release gate, a traffic allocation and a rollback target may be decided
 *     on.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE VALUE COMES FROM, AND WHERE IT MUST NOT COME FROM
 * ---------------------------------------------------------------------------
 *
 * AUTHORITATIVE SOURCE: the Cloudflare API. `wrangler versions upload` prints,
 * and the Workers API returns, a version id in RFC 4122 UUID form. Cloudflare
 * assigns it, Cloudflare guarantees it is unique per upload, and Cloudflare
 * guarantees the artefact behind it is immutable. Every uploaded candidate has
 * a NEW one, including a candidate whose client graph did not move.
 *
 * NEVER MANUFACTURED HERE. This repository cannot compute a Worker version id,
 * and a locally derived value that merely looked like one would be worse than
 * having none: it would restore exactly the false confidence RR2-P1-1 found.
 * `deriveWorkerReleaseId` does not exist and must not be added. The only way a
 * Worker version id enters the evidence is by being READ BACK from an
 * authorized upload or deployment listing.
 *
 * NEVER EXPOSED TO A BROWSER. No route serves it, no bundle inlines it, no
 * `define` carries it. A page has no use for it — a page's only question is
 * whether its own chunks still exist — and a deployment-plane identifier does
 * not belong in an anonymous public response. `client-secret-scan` and
 * `worker-config-contract.test.ts` keep it out of the emitted client graph.
 *
 * This module is deliberately dependency-free so the build scripts, the tests
 * and the release tooling can all import the same bytes.
 */

/**
 * RFC 4122 form, as returned by the Cloudflare Workers API.
 *
 * Deliberately strict. A prefix, a preview-URL subdomain, a short id or a
 * client asset identifier must all fail this, because each of them is a value
 * someone could paste into a release record believing it identified a Worker.
 */
export const WORKER_VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isWorkerVersionId(value: unknown): value is string {
  return typeof value === "string" && WORKER_VERSION_ID_PATTERN.test(value);
}

/**
 * The complete set of facts a release record must carry.
 *
 * Recorded TOGETHER on purpose: each answers a different question, and any one
 * of them alone has been shown to be capable of proving the wrong thing.
 */
export type ForeverReleaseProvenance = {
  /** Exact Git commit the candidate was built from. */
  readonly sourceCommit: string;
  /** Exact Git tree of that commit — moves for a server-only source change. */
  readonly sourceTree: string;
  /** Client asset compatibility identity. May repeat across releases. */
  readonly clientAssetId: string;
  /** Immutable Cloudflare Worker version UUID for the candidate. */
  readonly candidateWorkerVersionId: string;
  /** Immutable Worker version UUID that was live before the cutover. */
  readonly previousWorkerVersionId: string;
  /** The Worker's compatibility date, from the generated configuration. */
  readonly compatibilityDate: string;
  /** Canonical digest of the generated non-secret binding/config surface. */
  readonly configFingerprint: string;
  /** Migration ledger state at release time, as an opaque recorded string. */
  readonly migrationLedgerState: string;
};

export const RELEASE_PROVENANCE_FIELDS = [
  "sourceCommit",
  "sourceTree",
  "clientAssetId",
  "candidateWorkerVersionId",
  "previousWorkerVersionId",
  "compatibilityDate",
  "configFingerprint",
  "migrationLedgerState",
] as const satisfies ReadonlyArray<keyof ForeverReleaseProvenance>;

export type ReleaseProvenanceRefusal =
  | "missing_field"
  | "candidate_worker_version_not_a_uuid"
  | "previous_worker_version_not_a_uuid"
  | "candidate_worker_version_not_new"
  | "client_asset_id_used_as_worker_version";

export type ReleaseProvenanceVerdict =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly refusal: ReleaseProvenanceRefusal;
      readonly field?: string;
    };

/**
 * Checks a release record against the separation this module exists to enforce.
 *
 * The three refusals that matter, and why each is a refusal rather than a
 * warning:
 *
 *   - a candidate Worker version equal to the previous one means NO NEW WORKER
 *     WAS UPLOADED. Every authorized upload produces a new immutable version,
 *     so an equal pair means the record describes a deployment that did not
 *     happen — the exact server-only blind spot RR2-P1-1 measured;
 *   - a client asset identifier in a Worker version field is the original
 *     conflation, written down. Rejected explicitly rather than merely failing
 *     the UUID shape, so the error names the mistake;
 *   - a missing field is refused because the record's value is that all eight
 *     facts are present together.
 */
export function verifyReleaseProvenance(
  record: Partial<ForeverReleaseProvenance> | null | undefined,
): ReleaseProvenanceVerdict {
  if (!record || typeof record !== "object") {
    return { accepted: false, refusal: "missing_field" };
  }
  for (const field of RELEASE_PROVENANCE_FIELDS) {
    const value = record[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      return { accepted: false, refusal: "missing_field", field };
    }
  }
  const candidate = record.candidateWorkerVersionId as string;
  const previous = record.previousWorkerVersionId as string;
  const clientAssetId = record.clientAssetId as string;

  if (candidate === clientAssetId || previous === clientAssetId) {
    return { accepted: false, refusal: "client_asset_id_used_as_worker_version" };
  }
  if (!isWorkerVersionId(candidate)) {
    return { accepted: false, refusal: "candidate_worker_version_not_a_uuid" };
  }
  if (!isWorkerVersionId(previous)) {
    return { accepted: false, refusal: "previous_worker_version_not_a_uuid" };
  }
  if (candidate === previous) {
    return { accepted: false, refusal: "candidate_worker_version_not_new" };
  }
  return { accepted: true };
}

export type RollbackTargetRefusal =
  | "target_not_a_worker_version_uuid"
  | "target_is_a_client_asset_id"
  | "target_not_the_retained_previous_version"
  | "target_is_the_known_invalid_pre_r2_worker";

export type RollbackTargetVerdict =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly refusal: RollbackTargetRefusal };

/**
 * The pre-R2 Worker that is not a valid rollback target once an R2 job exists.
 *
 * Recorded by `FOREVER-PR134-*` and by `docs/FOREVER_STUDIO_OWNER_RUNBOOK.md`.
 * Kept as a prefix because that is how it is written down operationally; any
 * target whose id starts with it is refused.
 */
export const INVALID_PRE_R2_WORKER_VERSION_PREFIX = "9919f28c";

/**
 * A rollback target is the retained PREVIOUS WORKER VERSION UUID, and nothing
 * else is accepted as a substitute.
 *
 * Selecting a rollback target by client asset identity is the failure mode
 * RR2-P1-1 named: for a server-only release the previous and current client
 * identities are equal, so "roll back to the version whose client identity is
 * X" does not identify a version at all.
 */
export function verifyRollbackTarget(input: {
  readonly target: string | null | undefined;
  readonly retainedPreviousWorkerVersionId: string | null | undefined;
  readonly clientAssetId?: string | null;
}): RollbackTargetVerdict {
  const target = typeof input.target === "string" ? input.target.trim() : "";
  if (input.clientAssetId && target === input.clientAssetId) {
    return { accepted: false, refusal: "target_is_a_client_asset_id" };
  }
  if (!isWorkerVersionId(target)) {
    return { accepted: false, refusal: "target_not_a_worker_version_uuid" };
  }
  if (target.startsWith(INVALID_PRE_R2_WORKER_VERSION_PREFIX)) {
    return { accepted: false, refusal: "target_is_the_known_invalid_pre_r2_worker" };
  }
  if (!isWorkerVersionId(input.retainedPreviousWorkerVersionId)) {
    return { accepted: false, refusal: "target_not_the_retained_previous_version" };
  }
  if (target !== input.retainedPreviousWorkerVersionId) {
    return { accepted: false, refusal: "target_not_the_retained_previous_version" };
  }
  return { accepted: true };
}

/**
 * The LOCAL release manifest a build may produce, and its hard limits.
 *
 * A build can honestly state what it built: the source commit, the source tree,
 * the client asset identity, the compatibility date and a canonical non-secret
 * config digest. It CANNOT state which Worker version will exist, because that
 * value does not exist until an authorized upload has happened.
 *
 * `workerVersionId` is therefore always `null` here, and the manifest carries
 * an explicit statement to that effect so a reader cannot mistake it for a
 * release record. `verifyReleaseProvenance` refuses a manifest as a release
 * record for the same reason: two of its required fields are absent.
 */
export type ForeverLocalReleaseManifest = {
  readonly kind: "forever-local-release-manifest";
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly clientAssetId: string;
  readonly compatibilityDate: string;
  readonly configFingerprint: string;
  /** Always null. A local build cannot know the Worker version. */
  readonly workerVersionId: null;
  /** Always true. Present so the limitation travels with the document. */
  readonly isNotAWorkerReleaseIdentity: true;
  readonly workerVersionIdSource: "cloudflare-versions-upload";
};

export function isLocalReleaseManifest(value: unknown): value is ForeverLocalReleaseManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<ForeverLocalReleaseManifest>;
  return (
    manifest.kind === "forever-local-release-manifest" &&
    manifest.workerVersionId === null &&
    manifest.isNotAWorkerReleaseIdentity === true &&
    manifest.workerVersionIdSource === "cloudflare-versions-upload" &&
    typeof manifest.sourceCommit === "string" &&
    typeof manifest.sourceTree === "string" &&
    typeof manifest.clientAssetId === "string" &&
    typeof manifest.compatibilityDate === "string" &&
    typeof manifest.configFingerprint === "string"
  );
}
