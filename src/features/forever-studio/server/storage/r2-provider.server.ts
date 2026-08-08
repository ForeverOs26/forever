/**
 * Forever Studio — the Cloudflare R2 storage provider (SERVER ONLY).
 *
 * Everything R2 knows about Studio, and everything Studio knows about R2, meets
 * here. The pipeline above it addresses objects by logical bucket + path
 * exactly as it always has; this module maps that onto three private R2
 * buckets, presigns the browser's direct uploads, and drives the multipart
 * lifecycle.
 *
 * TWO TRANSPORTS, ONE CHOICE, MADE AT CONSTRUCTION
 *   - `runtime: "worker"` — every SERVER-SIDE object operation goes through the
 *     native R2 bucket bindings. This is production. The S3 client stays for
 *     the one thing a binding cannot do: presigning the BROWSER's direct
 *     upload. There is no automatic S3 fallback here, because on a Worker the
 *     S3 endpoint is not reachable at all — that is the defect that stranded
 *     the first real R2 pilot, and a "fallback" to it is just a slower failure.
 *   - `runtime: "node"` (default) — local development, tests and any non-Worker
 *     host keep the S3 object plane exactly as before.
 *
 * INVARIANTS THIS MODULE OWNS
 *   - the browser never receives a credential — only a short-lived presigned
 *     request for ONE object key and ONE method;
 *   - no presigned URL is logged, persisted, audited, or returned twice;
 *   - a private-source or archive key can never be reached through the public
 *     delivery URL builder (it refuses any non-public bucket kind);
 *   - there is NO fallback: an R2 failure throws, and nothing here knows how to
 *     reach Supabase Storage;
 *   - browser-presigned DELETE is never issued — deletion is server-side only,
 *     and only for job-scoped keys.
 *
 * THE ARCHIVE CONTROL PLANE — PARTS AS OBJECTS
 * (FOREVER-R2-BINDING-NATIVE-MULTIPART-ARCHIVE-001).
 *
 * A large archive is stored as many fixed-size PART OBJECTS under one
 * archive-scoped prefix, not as one multipart-assembled object. That single
 * choice is what makes the lane work on a Worker, because it replaces the one
 * operation a binding cannot perform — `ListParts` — with the one it performs
 * natively: a bounded prefix listing.
 *
 * The resume authority is therefore STRONGER than it was, not weaker:
 *   - the server still asks STORAGE what it holds; a browser's claimed receipts
 *     are still only ever cross-checked against that answer, never trusted;
 *   - part objects do not expire the way an abandoned multipart upload does, so
 *     the `upload_expired` loss mode disappears for new archives;
 *   - no server-side S3 request is made at all — presigning is pure local
 *     signing, and every server-side operation is a binding call — so the lane
 *     needs no new credential, no new binding and no new deployment component.
 *
 * LEGACY. An archive written before this carries `multipartUploadId` and keeps
 * resuming, completing and reading through the multipart lane exactly as it
 * did. Nothing migrates; the layout is inferred from the stored state.
 */

import type { StudioArchivePartTarget } from "../../studio-types";
import type { StudioObjectDigest, StudioObjectStat, StudioStorage } from "../contracts";
import { inStage, StudioStageError } from "../processing-stage";
import {
  isNoSuchUpload,
  normalizeEtag,
  R2Client,
  R2RequestError,
  type R2MultipartPart,
} from "./r2-client.server";
import { createR2BindingArchiveReader, createR2BindingObjects } from "./r2-binding-objects.server";
import type { StudioR2Bindings } from "./r2-bindings.server";
import { archivePartIndexFromName, r2ArchivePartFolder, r2ArchivePartPath } from "./archive-paths";
import { PartedArchiveReader, type PartedArchiveLayout } from "./parted-archive-reader";
// `r2ArchiveObjectPath` is deliberately NOT imported: a legacy multipart
// archive's object key is read from its stored state, never regenerated, and no
// new archive assembles into one.
import { bucketKindForLogicalBucket, LOGICAL_ARCHIVE_BUCKET, r2ObjectKey } from "./r2-layout";
import {
  archiveLayoutOf,
  StudioArchiveUploadLostError,
  type StudioAcceptedPart,
  type StudioAllocatedUpload,
  type StudioArchiveByteReader,
  type StudioArchiveGeometry,
  type StudioArchiveStorageState,
  type StudioObjectLocator,
  type StudioStorageProvider,
} from "./provider";

/**
 * Where the R2 parts lane keeps one archive's parts.
 *
 * The archive bucket, under the same archive-scoped prefix the assembled object
 * used, so one prefix still bounds everything one archive ever wrote.
 */
const R2_ARCHIVE_PARTS_LAYOUT: PartedArchiveLayout = {
  bucket: LOGICAL_ARCHIVE_BUCKET,
  pathFor: (geometry, index) => r2ArchivePartPath(geometry.jobId, geometry.archiveId, index),
};

/** Public derivatives are immutable, content-addressed objects. */
export const PUBLIC_MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Short by design: a presigned request is a bearer credential. */
export const DEFAULT_PRESIGN_TTL_SECONDS = 900; // 15 minutes

/** Only ever a job-scoped key may be deleted by the server. */
const JOB_SCOPED_PATH = /^(jobs|studio|archives)\/[0-9a-fA-F-]{36}\//;

/**
 * Which transport this process performs SERVER-SIDE object operations over.
 * `node` is the default so every existing non-Worker caller — the CLI, the
 * local harness, the whole test suite — keeps the behaviour it was written
 * against, and moving to bindings is an explicit, visible decision.
 */
export type StudioR2Runtime = "worker" | "node";

export interface R2ProviderConfig {
  /**
   * The S3 client. On a Worker its ONLY remaining job is presigning the
   * browser's direct uploads; it performs no server-side object operation.
   */
  client: R2Client;
  /** Server-side object transport. Defaults to `node` (the S3 object plane). */
  runtime?: StudioR2Runtime;
  /** Native bucket bindings. REQUIRED when `runtime` is `worker`. */
  bindings?: StudioR2Bindings | null;
  buckets: {
    privateSources: string;
    publicMedia: string;
    projectArchives: string;
  };
  /** Origin the public `/media/…` route is served from. Never an R2 host. */
  publicOrigin: string;
  presignTtlSeconds?: number;
}

function bucketNameFor(config: R2ProviderConfig, logicalBucket: string): string {
  const kind = bucketKindForLogicalBucket(logicalBucket);
  if (kind === "private_source") return config.buckets.privateSources;
  if (kind === "public_media") return config.buckets.publicMedia;
  if (kind === "project_archives") return config.buckets.projectArchives;
  throw new Error("studio_unknown_logical_bucket");
}

function keyFor(logicalBucket: string, path: string): string {
  return r2ObjectKey(logicalBucket, path);
}

async function consumeStream(
  body: ReadableStream<Uint8Array> | null,
  onChunk: (chunk: Buffer) => void | Promise<void>,
): Promise<number> {
  if (!body) return 0;
  const reader = body.getReader();
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = Buffer.from(value);
    size += chunk.length;
    await onChunk(chunk);
  }
  return size;
}

function expectedPartSize(geometry: StudioArchiveGeometry, index: number): number {
  if (index < geometry.partCount - 1) return geometry.partSize;
  return geometry.declaredSize - geometry.partSize * (geometry.partCount - 1);
}

/** The multipart identity must exist before any part can be addressed. */
function requireMultipart(state: StudioArchiveStorageState): {
  objectKey: string;
  uploadId: string;
} {
  if (!state.objectKey) throw new StudioArchiveUploadLostError("upload_unknown");
  if (!state.multipartUploadId) throw new StudioArchiveUploadLostError("upload_unknown");
  return { objectKey: state.objectKey, uploadId: state.multipartUploadId };
}

/**
 * Ranged reader over ONE assembled archive object. Caches at most one logical
 * part, so the ZIP directory walk and per-entry reads keep exactly the bounded
 * memory profile the Supabase parted reader has.
 */
class R2ArchiveReader implements StudioArchiveByteReader {
  private cache: { index: number; data: Buffer } | null = null;

  constructor(
    private readonly config: R2ProviderConfig,
    private readonly bucket: string,
    private readonly key: string,
    private readonly geometry: StudioArchiveGeometry,
    private readonly totalSize: number,
  ) {}

  size(): number {
    return this.totalSize;
  }

  private partRange(index: number): { start: number; endExclusive: number } {
    const start = index * this.geometry.partSize;
    return { start, endExclusive: Math.min(this.totalSize, start + this.geometry.partSize) };
  }

  private async part(index: number): Promise<Buffer> {
    if (this.cache?.index === index) return this.cache.data;
    const chunks: Buffer[] = [];
    const size = await this.streamPart(index, (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    if (size !== expectedPartSize(this.geometry, index)) {
      throw new Error("studio_archive_part_unreadable");
    }
    const data = Buffer.concat(chunks);
    this.cache = { index, data };
    return data;
  }

  async read(start: number, endExclusive: number): Promise<Buffer> {
    if (start < 0 || endExclusive > this.totalSize || endExclusive < start) {
      throw new Error("studio_archive_range_invalid");
    }
    const firstPart = Math.floor(start / this.geometry.partSize);
    const lastPart = Math.floor((endExclusive - 1) / this.geometry.partSize);
    const chunks: Buffer[] = [];
    for (let index = firstPart; index <= lastPart; index += 1) {
      const data = await this.part(index);
      const partStart = index * this.geometry.partSize;
      chunks.push(
        data.subarray(
          Math.max(0, start - partStart),
          Math.min(data.length, endExclusive - partStart),
        ),
      );
    }
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  }

  async hashPart(index: number, headBytes: number): Promise<StudioObjectDigest | null> {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    const headChunks: Buffer[] = [];
    let headLength = 0;
    let size = 0;
    const observed = await this.streamPart(index, (chunk) => {
      hash.update(chunk);
      size += chunk.length;
      if (headLength < headBytes) {
        const take = chunk.subarray(0, Math.min(chunk.length, headBytes - headLength));
        headChunks.push(Buffer.from(take));
        headLength += take.length;
      }
    });
    if (observed === null) return null;
    return { sha256: hash.digest("hex"), size, head: Buffer.concat(headChunks) };
  }

  async streamPart(
    index: number,
    onChunk: (chunk: Buffer) => void | Promise<void>,
  ): Promise<number | null> {
    const range = this.partRange(index);
    if (range.endExclusive <= range.start) return null;
    const response = await this.config.client.get(this.bucket, this.key, range);
    if (!response) return null;
    return consumeStream(response.body, onChunk);
  }
}

/**
 * The object plane over R2. Deliberately implements the SAME `StudioStorage`
 * contract the Supabase adapter does, so every byte-verification, media-truth
 * and cleanup rule in the pipeline runs unchanged on either provider.
 */
function createR2Objects(config: R2ProviderConfig): StudioStorage {
  const client = config.client;

  return {
    async createSignedUpload(): Promise<{ token: string }> {
      // The Supabase signed-upload token has no R2 equivalent, and inventing a
      // "compatible" one would hide a wiring mistake. Fail closed instead.
      throw new Error("r2_signed_upload_unsupported");
    },

    async listNames(bucket, prefix) {
      const listed = await client.list(bucketNameFor(config, bucket), `${keyFor(bucket, prefix)}/`);
      const names = new Set<string>();
      const base = `${keyFor(bucket, prefix)}/`;
      for (const object of listed.objects) names.add(object.key.slice(base.length));
      for (const child of listed.prefixes) {
        const rest = child.slice(base.length).replace(/\/$/, "");
        if (rest) names.add(rest);
      }
      return names;
    },

    async listObjects(bucket, prefix) {
      const base = `${keyFor(bucket, prefix)}/`;
      const listed = await client.list(bucketNameFor(config, bucket), base);
      return listed.objects.map((object) => ({
        name: object.key.slice(base.length),
        size: object.size,
        ...(object.etag ? { etag: object.etag } : {}),
      }));
    },

    async statObject(bucket, path): Promise<StudioObjectStat | null> {
      const head = await inStage("object_stat", () =>
        client.head(bucketNameFor(config, bucket), keyFor(bucket, path)),
      );
      return head ? { size: head.size } : null;
    },

    async hashObject(bucket, path, headBytes) {
      const response = await inStage("object_read", () =>
        client.get(bucketNameFor(config, bucket), keyFor(bucket, path)),
      );
      if (!response) return null;
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256");
      const headChunks: Buffer[] = [];
      let headLength = 0;
      let size = 0;
      try {
        await consumeStream(response.body, (chunk) => {
          hash.update(chunk);
          size += chunk.length;
          if (headLength < headBytes) {
            const take = chunk.subarray(0, Math.min(chunk.length, headBytes - headLength));
            headChunks.push(Buffer.from(take));
            headLength += take.length;
          }
        });
      } catch {
        return null;
      }
      return { sha256: hash.digest("hex"), size, head: Buffer.concat(headChunks) };
    },

    async readObjectStream(bucket, path, onChunk) {
      const response = await inStage("object_read", () =>
        client.get(bucketNameFor(config, bucket), keyFor(bucket, path)),
      );
      if (!response) return null;
      try {
        return await consumeStream(response.body, onChunk);
      } catch {
        return null;
      }
    },

    async downloadWithin(bucket, path, maxBytes) {
      const head = await inStage("object_stat", () =>
        client.head(bucketNameFor(config, bucket), keyFor(bucket, path)),
      );
      if (!head) return null;
      if (head.size > maxBytes) return null;
      const response = await inStage("object_read", () =>
        client.get(bucketNameFor(config, bucket), keyFor(bucket, path)),
      );
      if (!response) return null;
      const chunks: Buffer[] = [];
      await consumeStream(response.body, (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      return Buffer.concat(chunks);
    },

    async upload(bucket, path, data, contentType) {
      const kind = bucketKindForLogicalBucket(bucket);
      await inStage(kind === "public_media" ? "public_object_write" : "object_write", () =>
        client.put(
          bucketNameFor(config, bucket),
          keyFor(bucket, path),
          new Uint8Array(data),
          contentType,
          // Public objects are immutable and content-addressed; private ones get
          // no caching hint at all because nothing ever caches them.
          kind === "public_media" ? PUBLIC_MEDIA_CACHE_CONTROL : undefined,
        ),
      );
    },

    async remove(bucket, paths) {
      for (const path of paths) {
        // Deletion is only ever job hygiene. A key outside a job prefix is a
        // bug in the caller, and refusing it here keeps that bug from becoming
        // data loss.
        if (!JOB_SCOPED_PATH.test(path)) throw new Error("r2_delete_outside_job_scope");
        await inStage("object_delete", () =>
          client.delete(bucketNameFor(config, bucket), keyFor(bucket, path)),
        );
      }
    },

    publicUrl(bucket, path) {
      if (bucketKindForLogicalBucket(bucket) !== "public_media") {
        throw new Error("studio_public_url_forbidden_bucket");
      }
      return `${config.publicOrigin.replace(/\/$/, "")}/${r2ObjectKey(bucket, path)}`;
    },
  };
}

/**
 * The bindings a Worker-runtime provider must have been given.
 *
 * Constructed once, at provider construction, so a misconfigured deployment is
 * refused BEFORE a job is claimed rather than halfway through one — and so no
 * per-operation code path has to remember to check.
 */
function requireBindings(config: R2ProviderConfig): StudioR2Bindings {
  if (config.bindings) return config.bindings;
  throw new StudioStageError("provider_resolution", {
    retryable: false,
    message:
      "Cloudflare R2 is selected but this Worker has no usable bucket binding. Nothing was changed.",
  });
}

/**
 * A LEGACY multipart archive can only be driven from a host that can make
 * server-side S3 requests, because `ListParts` is its resume authority and no
 * binding provides it. New archives never reach this — they are parts-as-
 * objects, which a binding lists natively — so this refusal now guards exactly
 * one case: an archive created before the parts lane, resumed on a Worker.
 *
 * Refusing is deliberate and LOUD: it raises a specific, sanitized,
 * stage-labelled code rather than pretending, and it never invents a part
 * listing from what the browser claims.
 */
function refuseLegacyMultipartOnWorker(): never {
  throw new StudioStageError("archive_control_plane", { retryable: false });
}

export function createR2StorageProvider(config: R2ProviderConfig): StudioStorageProvider {
  const runtime: StudioR2Runtime = config.runtime ?? "node";
  const onWorker = runtime === "worker";
  const bindings = onWorker ? requireBindings(config) : null;
  const objects = bindings
    ? createR2BindingObjects({ bindings, publicOrigin: config.publicOrigin })
    : createR2Objects(config);
  const client = config.client;
  const ttl = config.presignTtlSeconds ?? DEFAULT_PRESIGN_TTL_SECONDS;
  const archiveBucket = () => bucketNameFor(config, LOGICAL_ARCHIVE_BUCKET);

  const legacyMultipartTargets = async (
    state: StudioArchiveStorageState,
    indexes: number[],
  ): Promise<StudioArchivePartTarget[]> => {
    const { objectKey, uploadId } = requireMultipart(state);
    const targets: StudioArchivePartTarget[] = [];
    for (const index of indexes) {
      const url = await client.presignUploadPart({
        bucket: archiveBucket(),
        key: keyFor(LOGICAL_ARCHIVE_BUCKET, objectKey),
        uploadId,
        // S3 part numbers are 1-based; Studio's part indexes are 0-based.
        partNumber: index + 1,
        expiresInSeconds: ttl,
        contentType: "application/octet-stream",
      });
      targets.push({
        index,
        bucket: LOGICAL_ARCHIVE_BUCKET,
        path: objectKey,
        transport: {
          kind: "r2_presigned_put",
          url,
          headers: { "content-type": "application/octet-stream" },
        },
      });
    }
    return targets;
  };

  /**
   * One short-lived presigned PUT per PART OBJECT.
   *
   * Presigning is local signing, not a request, so this is the same work on
   * every host — which is precisely why the parts lane runs on a Worker.
   */
  const partObjectTargets = async (
    geometry: StudioArchiveGeometry,
    indexes: number[],
  ): Promise<StudioArchivePartTarget[]> => {
    const targets: StudioArchivePartTarget[] = [];
    for (const index of indexes) {
      const path = r2ArchivePartPath(geometry.jobId, geometry.archiveId, index);
      const url = await client.presignPut({
        bucket: archiveBucket(),
        key: keyFor(LOGICAL_ARCHIVE_BUCKET, path),
        expiresInSeconds: ttl,
        contentType: "application/octet-stream",
      });
      targets.push({
        index,
        bucket: LOGICAL_ARCHIVE_BUCKET,
        path,
        transport: {
          kind: "r2_presigned_put",
          url,
          headers: { "content-type": "application/octet-stream" },
        },
      });
    }
    return targets;
  };

  /** The parts this archive's prefix durably holds, keyed by part index. */
  const listPartObjects = async (
    geometry: StudioArchiveGeometry,
  ): Promise<Map<number, StudioAcceptedPart>> => {
    const listed = await objects.listObjects(
      LOGICAL_ARCHIVE_BUCKET,
      r2ArchivePartFolder(geometry.jobId, geometry.archiveId),
    );
    const accepted = new Map<number, StudioAcceptedPart>();
    for (const object of listed) {
      const index = archivePartIndexFromName(object.name);
      // A part index outside the plan is not addressable by any target this
      // server issued; ignoring it keeps acceptance strictly plan-shaped.
      if (index === null || index < 0 || index >= geometry.partCount) continue;
      // The receipt travels with the listing, so a browser claiming a DIFFERENT
      // receipt for a correctly-sized part is still caught — the parts lane is
      // no weaker here than the multipart lane it replaces.
      accepted.set(index, { size: object.size, ...(object.etag ? { etag: object.etag } : {}) });
    }
    return accepted;
  };

  return {
    id: "r2",
    objects,

    // Parts-as-objects: the resume authority is a bounded prefix listing, which
    // every host performs — the binding natively on a Worker, the S3 object
    // plane off one. The lane is therefore available on both.
    archiveControlPlane: "available",

    async allocateOrdinaryUpload(input): Promise<StudioAllocatedUpload> {
      const contentType = input.contentType?.trim() || "application/octet-stream";
      const url = await client.presignPut({
        bucket: bucketNameFor(config, input.bucket),
        key: keyFor(input.bucket, input.path),
        expiresInSeconds: ttl,
        // Signing the content-type binds the declaration: a browser that sends
        // different bytes under a different type is refused by R2 itself.
        contentType,
      });
      return {
        bucket: input.bucket,
        path: input.path,
        transport: {
          kind: "r2_presigned_put",
          url,
          headers: { "content-type": contentType },
        },
      };
    },

    async beginArchiveUpload(): Promise<StudioArchiveStorageState> {
      // Parts are addressed deterministically from (job, archive, index), so
      // there is nothing to remember and nothing to allocate: no multipart
      // upload is created, and therefore none can expire. The prefix is the
      // whole durable identity.
      return {
        provider: "r2",
        layout: "parts",
        bucket: LOGICAL_ARCHIVE_BUCKET,
        completed: false,
      };
    },

    async archivePartTargets({ geometry, state, indexes }) {
      if (state.completed) return [];
      if (archiveLayoutOf(state) === "parts") {
        return partObjectTargets(geometry, indexes);
      }
      if (onWorker) refuseLegacyMultipartOnWorker();
      try {
        return await legacyMultipartTargets(state, indexes);
      } catch (error) {
        if (isNoSuchUpload(error)) throw new StudioArchiveUploadLostError("upload_expired");
        throw error;
      }
    },

    async listAcceptedArchiveParts({ geometry, state }) {
      if (archiveLayoutOf(state) === "parts") {
        // The prefix listing is the authority, before AND after completion:
        // it reports the sizes storage actually holds rather than the sizes the
        // plan expected, so a short or missing part can never pass as accepted.
        return listPartObjects(geometry);
      }
      const accepted = new Map<number, StudioAcceptedPart>();
      if (state.completed && state.objectKey) {
        // Completed: the object is the truth. Every planned part is present by
        // construction, at its planned size. Verifying a COMPLETED object is an
        // ordinary object-plane stat, so it runs natively on a Worker.
        const head = await objects.statObject(LOGICAL_ARCHIVE_BUCKET, state.objectKey);
        if (!head || head.size !== geometry.declaredSize) return accepted;
        for (let index = 0; index < geometry.partCount; index += 1) {
          accepted.set(index, { size: expectedPartSize(geometry, index) });
        }
        return accepted;
      }
      // Everything below enumerates an IN-PROGRESS LEGACY multipart upload.
      // That is its resume authority, and it has no binding equivalent.
      if (onWorker) refuseLegacyMultipartOnWorker();
      const { objectKey, uploadId } = requireMultipart(state);
      let parts: R2MultipartPart[];
      try {
        parts = await client.listParts(
          archiveBucket(),
          keyFor(LOGICAL_ARCHIVE_BUCKET, objectKey),
          uploadId,
        );
      } catch (error) {
        if (isNoSuchUpload(error) || (error instanceof R2RequestError && error.status === 404)) {
          throw new StudioArchiveUploadLostError("upload_expired");
        }
        throw error;
      }
      for (const part of parts) {
        // A part number outside the plan is not addressable by any target this
        // server issued; ignoring it keeps completion strictly plan-shaped.
        if (part.index < 0 || part.index >= geometry.partCount) continue;
        // Last write wins per part number, exactly as S3 defines it, so a
        // duplicated part upload can never produce two entries.
        accepted.set(part.index, { size: part.size, etag: part.etag });
      }
      return accepted;
    },

    async completeArchiveUpload({ geometry, state, parts }) {
      if (state.completed) return state;
      if (archiveLayoutOf(state) === "parts") {
        // Acceptance IS completion on this lane: the parts are already durable
        // objects and the ranged reader assembles them on demand. Nothing is
        // copied, so a 300 MiB archive costs no assembly pass at all.
        //
        // Idempotent by construction — the early return above already answers a
        // retried confirm, and this branch performs no external effect.
        return { ...state, completed: true };
      }
      if (onWorker) refuseLegacyMultipartOnWorker();
      const { objectKey, uploadId } = requireMultipart(state);
      const ordered: R2MultipartPart[] = [];
      for (let index = 0; index < geometry.partCount; index += 1) {
        const part = parts.get(index);
        if (!part?.etag) throw new Error("r2_multipart_incomplete");
        ordered.push({ index, size: part.size, etag: part.etag });
      }
      try {
        await client.completeMultipartUpload(
          archiveBucket(),
          keyFor(LOGICAL_ARCHIVE_BUCKET, objectKey),
          uploadId,
          ordered,
        );
      } catch (error) {
        if (isNoSuchUpload(error)) {
          // Either the upload expired, or a concurrent caller already completed
          // it. A completed object of exactly the planned size is a WIN for
          // both of them; anything else is a genuine loss.
          const head = await client
            .head(archiveBucket(), keyFor(LOGICAL_ARCHIVE_BUCKET, objectKey))
            .catch(() => null);
          if (head && head.size === geometry.declaredSize) {
            return { ...state, completed: true };
          }
          throw new StudioArchiveUploadLostError("upload_expired");
        }
        throw error;
      }
      return {
        ...state,
        completed: true,
        parts: ordered.map((part) => ({ index: part.index, etag: part.etag })),
      };
    },

    async abortArchiveUpload({ state }) {
      // NEVER destructive on the parts lane, for two independent reasons.
      //
      // There is nothing to release: the ONLY caller is `planArchiveUpload`'s
      // `createArchive` failure path, which runs before any part target has
      // been issued, so no part object can exist yet. The multipart lane had
      // something to release there — an upload the platform would otherwise
      // hold — and that is what this method was for.
      //
      // And if that ever changes, deleting would be wrong anyway: those part
      // objects ARE the privately retained original archive, exactly as on the
      // Supabase lane, whose abort is a no-op for the same reason.
      if (archiveLayoutOf(state) === "parts") return;
      if (state.completed || !state.objectKey || !state.multipartUploadId) return;
      // Best-effort and never fatal, by contract. On a Worker there is nothing
      // to abort — no multipart upload can have been created there — so this
      // stays a no-op rather than turning hygiene into a job failure.
      if (onWorker) return;
      await client
        .abortMultipartUpload(
          archiveBucket(),
          keyFor(LOGICAL_ARCHIVE_BUCKET, state.objectKey),
          state.multipartUploadId,
        )
        .catch(() => undefined);
    },

    async discardArchiveParts({ geometry, state, indexes }) {
      // A LEGACY multipart part is not an object: re-uploading the same part
      // number replaces it atomically, so there is nothing to delete first.
      if (archiveLayoutOf(state) !== "parts") return;
      if (!indexes.length) return;
      // A part object at the wrong size WOULD otherwise persist and be listed
      // as accepted, so on this lane the discard is a real delete. Every path
      // is job-scoped, which the object plane independently enforces.
      await objects.remove(
        LOGICAL_ARCHIVE_BUCKET,
        indexes.map((index) => r2ArchivePartPath(geometry.jobId, geometry.archiveId, index)),
      );
    },

    archiveReader({ geometry, state, totalSize }) {
      if (archiveLayoutOf(state) === "parts") {
        // Identical reader, identical bounded-memory profile, on both hosts:
        // the object plane underneath is the binding on a Worker and the S3
        // adapter off one.
        return new PartedArchiveReader(objects, R2_ARCHIVE_PARTS_LAYOUT, geometry, totalSize);
      }
      if (!state.objectKey) throw new StudioArchiveUploadLostError("upload_unknown");
      // Reading a COMPLETED archive is ranged object access, which the binding
      // does natively — so the scheduled processing lane reads archives the
      // same Worker-safe way it reads every other object.
      if (bindings) {
        return createR2BindingArchiveReader({
          bindings,
          logicalBucket: LOGICAL_ARCHIVE_BUCKET,
          objectPath: state.objectKey,
          geometry,
          totalSize,
        });
      }
      return new R2ArchiveReader(
        config,
        archiveBucket(),
        keyFor(LOGICAL_ARCHIVE_BUCKET, state.objectKey),
        geometry,
        totalSize,
      );
    },

    buildPublicUrl(bucket, path) {
      return objects.publicUrl(bucket, path);
    },

    locatorFor(bucket, path): StudioObjectLocator {
      const bucketKind = bucketKindForLogicalBucket(bucket);
      if (!bucketKind) throw new Error("studio_unknown_logical_bucket");
      return { storageProvider: "r2", bucketKind, bucket, objectKey: path };
    },
  };
}
