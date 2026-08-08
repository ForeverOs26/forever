/**
 * Forever Studio — the storage provider contract
 * (FOREVER-R2-MEDIA-STORAGE-CUTOVER-001).
 *
 * ONE narrow, server-only seam between Studio and whatever actually holds the
 * heavy bytes. Studio's orchestration, extraction, media-truth and
 * large-archive code call THIS; none of them contains an R2 call, an S3
 * endpoint, a bucket name, or a credential.
 *
 * The contract has two planes:
 *
 *   OBJECT PLANE  (`objects`) — the existing `StudioStorage` shape: stat, hash,
 *                 stream, bounded download, put, remove, public URL, addressed
 *                 by a LOGICAL bucket name plus a path. Both providers
 *                 implement it, so every byte-verification and derivative rule
 *                 in the pipeline is provider-agnostic by construction.
 *
 *   CONTROL PLANE (everything else) — allocating an upload the BROWSER
 *                 performs, and the resumable multipart lifecycle. These differ
 *                 fundamentally between providers (a Supabase signed-upload
 *                 token vs an R2 presigned request; many permanent part objects
 *                 vs one multipart upload), so they are explicit capabilities
 *                 rather than something the object plane pretends to cover.
 *
 * NO FALLBACK. A provider method that fails throws. Nothing in this file, and
 * nothing that implements it, may substitute another provider for a failing
 * one: a job created on R2 either succeeds on R2 or fails closed.
 */

import type { StudioArchiveUploadCapability } from "../../archive-capability";
import type {
  StudioArchivePartReceipt,
  StudioArchivePartTarget,
  StudioBucketKind,
  StudioStorageProviderId,
  StudioUploadTransport,
} from "../../studio-types";
import type { StudioObjectDigest, StudioStorage } from "../contracts";

/**
 * The server-private locator of one stored object.
 *
 * Persisted ALONGSIDE — never instead of — a public URL, so a later delete or
 * re-verification addresses the object directly. A public URL is a delivery
 * address, not an identity: deriving a destructive object key by parsing one is
 * forbidden, and this type is what makes that unnecessary.
 *
 * It carries no endpoint, no signed URL, no credential and no real bucket name:
 * `bucket` is Studio's LOGICAL name, which the provider maps.
 */
export interface StudioObjectLocator {
  storageProvider: StudioStorageProviderId;
  bucketKind: StudioBucketKind;
  /** Logical bucket name as stored in Studio manifests. */
  bucket: string;
  objectKey: string;
}

/** One allocated ordinary-file upload target, before any byte is sent. */
export interface StudioAllocatedUpload {
  /** Logical bucket + path recorded on the job manifest. */
  bucket: string;
  path: string;
  /** How the browser sends the bytes. Short-lived; never persisted or logged. */
  transport: StudioUploadTransport;
}

/**
 * How one archive's bytes are laid out in storage.
 *
 * `parts`     — many fixed-size part objects under one deterministic prefix.
 *               "Which parts does storage hold" is then an ordinary bounded
 *               listing, which every host can answer, and the reader assembles
 *               ranges on demand. Both lanes write this today.
 * `multipart` — ONE object assembled by an S3 multipart upload, whose resume
 *               authority is `ListParts`. LEGACY: only archives written before
 *               FOREVER-R2-BINDING-NATIVE-MULTIPART-ARCHIVE-001 carry it, and
 *               they keep resuming and reading through the lane they were
 *               created on.
 */
export type StudioArchiveLayout = "parts" | "multipart";

/**
 * Durable identity of one archive's upload, stored on the archive row.
 *
 * SUPABASE: the archive is many fixed-size part objects under a deterministic
 * folder; there is no extra identity to keep, so only `provider` is set.
 *
 * R2: new archives are parts-as-objects under one archive-scoped prefix, so the
 * prefix (derived from the geometry) is the whole identity. An archive written
 * before that carries `multipartUploadId` and is read through the multipart
 * lane forever — which is what makes this change migration-free.
 */
export interface StudioArchiveStorageState {
  provider: StudioStorageProviderId;
  /**
   * How these bytes are laid out, recorded so a row is self-describing.
   *
   * DIAGNOSTIC, never authoritative: it is absent on every row written before
   * the parts lane existed, so `archiveLayoutOf` derives the answer from the
   * legacy markers instead and a stored value can never override them.
   */
  layout?: StudioArchiveLayout;
  /** R2: logical bucket holding the archive's objects. */
  bucket?: string;
  /** R2 (multipart, LEGACY): logical object path of the assembled archive. */
  objectKey?: string;
  /** R2 (multipart, LEGACY): the upload id. NOT a credential; useless alone. */
  multipartUploadId?: string;
  /** R2 (multipart, LEGACY): part receipts observed at completion time. */
  parts?: StudioArchivePartReceipt[];
  /** True once the archive's bytes are final and readable. */
  completed?: boolean;
}

/**
 * The layout a stored state denotes.
 *
 * Total, and safe for a row written before `layout` existed. The rule is driven
 * by the two fields ONLY the multipart lane ever wrote — the assembled object
 * key and the upload id — because their presence is durable evidence of where
 * the bytes actually are. The parts lane writes neither, so their joint absence
 * is what makes a state a parts state.
 *
 * Deliberately NOT `state.layout`: trusting a stored label over that evidence
 * would let one wrong or hand-edited field send an assembled archive down a
 * prefix listing, which would read an empty archive as legitimately empty.
 * Fail toward the layout the bytes are in.
 */
export function archiveLayoutOf(state: StudioArchiveStorageState): StudioArchiveLayout {
  if (state.multipartUploadId || state.objectKey) return "multipart";
  return "parts";
}

/** What the storage system actually holds for one archive part. */
export interface StudioAcceptedPart {
  size: number;
  /** R2 multipart only. */
  etag?: string;
}

/**
 * Why a multipart upload can no longer be continued. Each is a SAFE state: the
 * affected archive restarts under a fresh id and a fresh immutable object key,
 * and no other archive and no other job is disturbed.
 */
export type StudioArchiveUploadLoss = "upload_expired" | "upload_aborted" | "upload_unknown";

export class StudioArchiveUploadLostError extends Error {
  readonly retryable = true;
  constructor(readonly reason: StudioArchiveUploadLoss) {
    super(`archive_upload_lost:${reason}`);
    this.name = "archive_upload_lost";
  }
}

/** Bounded reader over ONE archive's stored bytes, whatever their layout. */
export interface StudioArchiveByteReader {
  /** Total assembled byte size the reader will serve. */
  size(): number;
  /** Bounded random access for the ranged ZIP reader. */
  read(start: number, endExclusive: number): Promise<Buffer>;
  /**
   * Streamed digest + exact size + leading bytes of ONE logical part. This is
   * what proves the stored bytes against the plan-time per-part claims, and it
   * is identical work on both providers: a whole part object on Supabase, a
   * byte range of the assembled object on R2.
   */
  hashPart(index: number, headBytes: number): Promise<StudioObjectDigest | null>;
  /** Stream ONE logical part for whole-archive hashing (never buffered). */
  streamPart(
    index: number,
    onChunk: (chunk: Buffer) => void | Promise<void>,
  ): Promise<number | null>;
}

export interface StudioArchiveGeometry {
  jobId: string;
  archiveId: string;
  declaredSize: number;
  partSize: number;
  partCount: number;
}

/**
 * The provider capability set. Every method is server-only.
 *
 * Implementations MUST NOT fall back to another provider, MUST NOT log or
 * persist a presigned URL, and MUST fail closed when they are not configured.
 */
export interface StudioStorageProvider {
  readonly id: StudioStorageProviderId;
  /** Object-plane adapter used by the whole verification/derivative pipeline. */
  readonly objects: StudioStorage;

  /**
   * Whether THIS provider, as constructed for THIS process, can drive the
   * resumable multipart archive lane.
   *
   * Declared by the provider rather than derived by the caller, so the answer
   * and the refusal can never disagree: the object that would have to do the
   * work is the object that says whether it can. A caller reads this to refuse
   * BEFORE allocating anything; the control-plane methods below still refuse
   * on their own, because a capability flag is a signal and not a boundary.
   */
  readonly archiveControlPlane: StudioArchiveUploadCapability;

  /** Allocate the browser's upload target for one declared ordinary file. */
  allocateOrdinaryUpload(input: {
    jobId: string;
    fileIndex: number;
    /** Logical bucket + path already recorded on the manifest. */
    bucket: string;
    path: string;
    /** Declared content type; signed into the request when the provider can. */
    contentType?: string | null;
  }): Promise<StudioAllocatedUpload>;

  /** Create the durable upload identity for a brand-new archive. */
  beginArchiveUpload(geometry: StudioArchiveGeometry): Promise<StudioArchiveStorageState>;

  /** Fresh short-lived upload targets for exactly these part indexes. */
  archivePartTargets(input: {
    geometry: StudioArchiveGeometry;
    state: StudioArchiveStorageState;
    indexes: number[];
  }): Promise<StudioArchivePartTarget[]>;

  /**
   * The parts the storage system durably holds. Authoritative: a browser's
   * claim about what it uploaded is only ever cross-checked against this.
   */
  listAcceptedArchiveParts(input: {
    geometry: StudioArchiveGeometry;
    state: StudioArchiveStorageState;
  }): Promise<Map<number, StudioAcceptedPart>>;

  /**
   * Finalize the archive into ONE readable object. Idempotent: completing an
   * already-completed archive returns the same state rather than failing.
   */
  completeArchiveUpload(input: {
    geometry: StudioArchiveGeometry;
    state: StudioArchiveStorageState;
    parts: Map<number, StudioAcceptedPart>;
  }): Promise<StudioArchiveStorageState>;

  /** Release an abandoned upload. Best-effort and never fatal. */
  abortArchiveUpload(input: {
    geometry: StudioArchiveGeometry;
    state: StudioArchiveStorageState;
  }): Promise<void>;

  /** Discard parts the storage system holds at the wrong size (pre-acceptance). */
  discardArchiveParts(input: {
    geometry: StudioArchiveGeometry;
    state: StudioArchiveStorageState;
    indexes: number[];
  }): Promise<void>;

  /** Bounded reader over the accepted archive bytes. */
  archiveReader(input: {
    geometry: StudioArchiveGeometry;
    state: StudioArchiveStorageState;
    totalSize: number;
  }): StudioArchiveByteReader;

  /** Public delivery URL for one PUBLIC object. Throws for any other kind. */
  buildPublicUrl(bucket: string, path: string): string;

  /** The server-private locator recorded next to a public URL. */
  locatorFor(bucket: string, path: string): StudioObjectLocator;
}

/**
 * The provider set one server process offers.
 *
 * `writeProviderId` is consulted ONLY when a job is created. Everything after
 * that — processing, retry, resume, scheduled continuation, cleanup — resolves
 * the provider the job itself recorded, so flipping the deployment setting can
 * never move an in-flight job.
 */
export interface StudioStorageProviderSet {
  readonly writeProviderId: StudioStorageProviderId;
  get(id: StudioStorageProviderId): StudioStorageProvider;
}
