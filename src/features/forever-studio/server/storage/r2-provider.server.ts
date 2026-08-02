/**
 * Forever Studio — the Cloudflare R2 storage provider (SERVER ONLY).
 *
 * Everything R2 knows about Studio, and everything Studio knows about R2, meets
 * here. The pipeline above it addresses objects by logical bucket + path
 * exactly as it always has; this module maps that onto three private R2
 * buckets, presigns the browser's direct uploads, and drives the multipart
 * lifecycle.
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
 */

import type { StudioArchivePartTarget } from "../../studio-types";
import type { StudioObjectDigest, StudioObjectStat, StudioStorage } from "../contracts";
import {
  isNoSuchUpload,
  normalizeEtag,
  R2Client,
  R2RequestError,
  type R2MultipartPart,
} from "./r2-client.server";
import {
  bucketKindForLogicalBucket,
  LOGICAL_ARCHIVE_BUCKET,
  r2ArchiveObjectPath,
  r2ObjectKey,
} from "./r2-layout";
import {
  StudioArchiveUploadLostError,
  type StudioAcceptedPart,
  type StudioAllocatedUpload,
  type StudioArchiveByteReader,
  type StudioArchiveGeometry,
  type StudioArchiveStorageState,
  type StudioObjectLocator,
  type StudioStorageProvider,
} from "./provider";

/** Public derivatives are immutable, content-addressed objects. */
export const PUBLIC_MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Short by design: a presigned request is a bearer credential. */
export const DEFAULT_PRESIGN_TTL_SECONDS = 900; // 15 minutes

/** Only ever a job-scoped key may be deleted by the server. */
const JOB_SCOPED_PATH = /^(jobs|studio|archives)\/[0-9a-fA-F-]{36}\//;

export interface R2ProviderConfig {
  client: R2Client;
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
      }));
    },

    async statObject(bucket, path): Promise<StudioObjectStat | null> {
      const head = await client.head(bucketNameFor(config, bucket), keyFor(bucket, path));
      return head ? { size: head.size } : null;
    },

    async hashObject(bucket, path, headBytes) {
      const response = await client.get(bucketNameFor(config, bucket), keyFor(bucket, path));
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
      const response = await client.get(bucketNameFor(config, bucket), keyFor(bucket, path));
      if (!response) return null;
      try {
        return await consumeStream(response.body, onChunk);
      } catch {
        return null;
      }
    },

    async downloadWithin(bucket, path, maxBytes) {
      const head = await client.head(bucketNameFor(config, bucket), keyFor(bucket, path));
      if (!head) return null;
      if (head.size > maxBytes) return null;
      const response = await client.get(bucketNameFor(config, bucket), keyFor(bucket, path));
      if (!response) return null;
      const chunks: Buffer[] = [];
      await consumeStream(response.body, (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      return Buffer.concat(chunks);
    },

    async upload(bucket, path, data, contentType) {
      const kind = bucketKindForLogicalBucket(bucket);
      await client.put(
        bucketNameFor(config, bucket),
        keyFor(bucket, path),
        new Uint8Array(data),
        contentType,
        // Public objects are immutable and content-addressed; private ones get
        // no caching hint at all because nothing ever caches them.
        kind === "public_media" ? PUBLIC_MEDIA_CACHE_CONTROL : undefined,
      );
    },

    async remove(bucket, paths) {
      for (const path of paths) {
        // Deletion is only ever job hygiene. A key outside a job prefix is a
        // bug in the caller, and refusing it here keeps that bug from becoming
        // data loss.
        if (!JOB_SCOPED_PATH.test(path)) throw new Error("r2_delete_outside_job_scope");
        await client.delete(bucketNameFor(config, bucket), keyFor(bucket, path));
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

export function createR2StorageProvider(config: R2ProviderConfig): StudioStorageProvider {
  const objects = createR2Objects(config);
  const client = config.client;
  const ttl = config.presignTtlSeconds ?? DEFAULT_PRESIGN_TTL_SECONDS;
  const archiveBucket = () => bucketNameFor(config, LOGICAL_ARCHIVE_BUCKET);

  const partTargets = async (
    geometry: StudioArchiveGeometry,
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

  return {
    id: "r2",
    objects,

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

    async beginArchiveUpload(geometry): Promise<StudioArchiveStorageState> {
      const objectKey = r2ArchiveObjectPath(geometry.jobId, geometry.archiveId);
      const uploadId = await client.createMultipartUpload(
        archiveBucket(),
        keyFor(LOGICAL_ARCHIVE_BUCKET, objectKey),
        "application/zip",
      );
      return {
        provider: "r2",
        bucket: LOGICAL_ARCHIVE_BUCKET,
        objectKey,
        multipartUploadId: uploadId,
        completed: false,
      };
    },

    async archivePartTargets({ geometry, state, indexes }) {
      if (state.completed) return [];
      try {
        return await partTargets(geometry, state, indexes);
      } catch (error) {
        if (isNoSuchUpload(error)) throw new StudioArchiveUploadLostError("upload_expired");
        throw error;
      }
    },

    async listAcceptedArchiveParts({ geometry, state }) {
      const accepted = new Map<number, StudioAcceptedPart>();
      if (state.completed && state.objectKey) {
        // Completed: the object is the truth. Every planned part is present by
        // construction, at its planned size.
        const head = await client.head(
          archiveBucket(),
          keyFor(LOGICAL_ARCHIVE_BUCKET, state.objectKey),
        );
        if (!head || head.size !== geometry.declaredSize) return accepted;
        for (let index = 0; index < geometry.partCount; index += 1) {
          accepted.set(index, { size: expectedPartSize(geometry, index) });
        }
        return accepted;
      }
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
      if (state.completed || !state.objectKey || !state.multipartUploadId) return;
      await client
        .abortMultipartUpload(
          archiveBucket(),
          keyFor(LOGICAL_ARCHIVE_BUCKET, state.objectKey),
          state.multipartUploadId,
        )
        .catch(() => undefined);
    },

    async discardArchiveParts() {
      // A multipart part is not an object: re-uploading the same part number
      // replaces it atomically, so there is nothing to delete first.
    },

    archiveReader({ geometry, state, totalSize }) {
      if (!state.objectKey) throw new StudioArchiveUploadLostError("upload_unknown");
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
