/**
 * Forever Studio — the R2 object plane over NATIVE Cloudflare bindings
 * (SERVER ONLY).
 *
 * This is the Worker-side transport for every server-side object operation:
 * stat, read, ranged read, write, delete, existence checks and metadata reads.
 * It implements exactly the same `StudioStorage` contract the S3 object plane
 * does, addressed by the same LOGICAL bucket + path, so every byte-verification,
 * media-truth, derivative and cleanup rule in the pipeline runs unchanged.
 *
 * WHAT IS DIFFERENT FROM THE S3 PLANE, AND WHY
 * --------------------------------------------
 *   - the transport is the bucket binding, so no request leaves the isolate and
 *     nothing depends on a Worker being able to reach the S3 endpoint (it
 *     cannot: that is the production defect this module exists to correct);
 *   - the binding is chosen from the bucket KIND through a closed table, never
 *     from a caller-supplied bucket name;
 *   - every failure is raised as a STAGE-LABELLED error, so a transport failure
 *     is recorded as `object_stat_failed` or `object_read_failed` rather than
 *     collapsing into the generic `processing_failed` that hid the pilot's real
 *     cause for three investigations.
 *
 * Absence semantics are IDENTICAL to the S3 plane on purpose: a missing object
 * is `null`, a mid-stream read failure is `null`, and a transport failure
 * throws. A retry that changed which of those a caller saw would change which
 * files a job reports as missing.
 */

import type { StudioObjectDigest, StudioObjectStat, StudioStorage } from "../contracts";
import { inStage, StudioStageError } from "../processing-stage";
import type { StudioArchiveByteReader, StudioArchiveGeometry } from "./provider";
import { bindingForKind, type R2BucketBinding, type StudioR2Bindings } from "./r2-bindings.server";
import { bucketKindForLogicalBucket, r2ObjectKey } from "./r2-layout";

/**
 * Quotes and the weak-validator marker are transport, not identity.
 *
 * Deliberately local rather than imported from the S3 client: this module is
 * the BINDING transport and must not acquire a dependency on the S3 one.
 */
function unquoteEtag(value: string): string {
  return value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

/** Public derivatives are immutable, content-addressed objects. */
export const PUBLIC_MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Only ever a job-scoped key may be deleted by the server. */
const JOB_SCOPED_PATH = /^(jobs|studio|archives)\/[0-9a-fA-F-]{36}\//;

/** Pages of a delimited listing one sweep may walk (matches the S3 plane). */
const MAX_LIST_PAGES = 20;

/**
 * Logical bucket → binding. The ONLY route from a name to a transport.
 *
 * `bucketKindForLogicalBucket` is a closed lookup that returns null for
 * anything it does not know, so an unrecognized bucket name cannot reach any
 * binding — it fails here, before a key is even built.
 */
function bindingFor(bindings: StudioR2Bindings, logicalBucket: string): R2BucketBinding {
  const kind = bucketKindForLogicalBucket(logicalBucket);
  if (!kind) throw new Error("studio_unknown_logical_bucket");
  return bindingForKind(bindings, kind);
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

/**
 * Ranged reader over ONE assembled archive object, over the archive binding.
 *
 * Caches at most one logical part, so the ZIP directory walk and per-entry
 * reads keep exactly the bounded memory profile every other reader has.
 */
class R2BindingArchiveReader implements StudioArchiveByteReader {
  private cache: { index: number; data: Buffer } | null = null;

  constructor(
    private readonly binding: R2BucketBinding,
    private readonly key: string,
    private readonly geometry: StudioArchiveGeometry,
    private readonly totalSize: number,
  ) {}

  size(): number {
    return this.totalSize;
  }

  private expectedPartSize(index: number): number {
    if (index < this.geometry.partCount - 1) return this.geometry.partSize;
    return this.geometry.declaredSize - this.geometry.partSize * (this.geometry.partCount - 1);
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
    if (size !== this.expectedPartSize(index)) {
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
    const object = await inStage("object_read", () =>
      this.binding.get(this.key, {
        range: { offset: range.start, length: range.endExclusive - range.start },
      }),
    );
    if (!object) return null;
    return consumeStream(object.body, onChunk);
  }
}

export function createR2BindingArchiveReader(input: {
  bindings: StudioR2Bindings;
  logicalBucket: string;
  objectPath: string;
  geometry: StudioArchiveGeometry;
  totalSize: number;
}): StudioArchiveByteReader {
  return new R2BindingArchiveReader(
    bindingFor(input.bindings, input.logicalBucket),
    r2ObjectKey(input.logicalBucket, input.objectPath),
    input.geometry,
    input.totalSize,
  );
}

/**
 * The Worker-native object plane.
 *
 * Every method here is server-side and reached only through the provider. The
 * one `StudioStorage` capability with no binding equivalent —
 * `createSignedUpload`, a Supabase-shaped upload token — fails closed exactly
 * as it does on the S3 plane rather than inventing a "compatible" answer.
 */
export function createR2BindingObjects(input: {
  bindings: StudioR2Bindings;
  publicOrigin: string;
}): StudioStorage {
  const { bindings, publicOrigin } = input;

  return {
    async createSignedUpload(): Promise<{ token: string }> {
      throw new Error("r2_signed_upload_unsupported");
    },

    async listNames(bucket, prefix) {
      const binding = bindingFor(bindings, bucket);
      const base = `${r2ObjectKey(bucket, prefix)}/`;
      const names = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const listed = await inStage("object_stat", () =>
          binding.list({ prefix: base, delimiter: "/", ...(cursor ? { cursor } : {}) }),
        );
        for (const object of listed.objects ?? []) names.add(object.key.slice(base.length));
        for (const child of listed.delimitedPrefixes ?? []) {
          const rest = child.slice(base.length).replace(/\/$/, "");
          if (rest) names.add(rest);
        }
        if (!listed.truncated || !listed.cursor) break;
        cursor = listed.cursor;
      }
      return names;
    },

    async listObjects(bucket, prefix) {
      const binding = bindingFor(bindings, bucket);
      const base = `${r2ObjectKey(bucket, prefix)}/`;
      const found: Array<{ name: string; size: number; etag?: string }> = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const listed = await inStage("object_stat", () =>
          binding.list({ prefix: base, delimiter: "/", ...(cursor ? { cursor } : {}) }),
        );
        for (const object of listed.objects ?? []) {
          found.push({
            name: object.key.slice(base.length),
            size: object.size,
            ...(object.etag ? { etag: unquoteEtag(object.etag) } : {}),
          });
        }
        if (!listed.truncated || !listed.cursor) break;
        cursor = listed.cursor;
      }
      return found;
    },

    /**
     * The operation the production pilot died on, seven times, without ever
     * reaching R2. It is now a binding call and it is labelled `object_stat`.
     */
    async statObject(bucket, path): Promise<StudioObjectStat | null> {
      const binding = bindingFor(bindings, bucket);
      const object = await inStage("object_stat", () => binding.head(r2ObjectKey(bucket, path)));
      return object ? { size: object.size } : null;
    },

    async hashObject(bucket, path, headBytes) {
      const binding = bindingFor(bindings, bucket);
      const object = await inStage("object_read", () => binding.get(r2ObjectKey(bucket, path)));
      if (!object) return null;
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256");
      const headChunks: Buffer[] = [];
      let headLength = 0;
      let size = 0;
      try {
        await consumeStream(object.body, (chunk) => {
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
      const binding = bindingFor(bindings, bucket);
      const object = await inStage("object_read", () => binding.get(r2ObjectKey(bucket, path)));
      if (!object) return null;
      try {
        return await consumeStream(object.body, onChunk);
      } catch {
        return null;
      }
    },

    async downloadWithin(bucket, path, maxBytes) {
      const binding = bindingFor(bindings, bucket);
      const key = r2ObjectKey(bucket, path);
      const head = await inStage("object_stat", () => binding.head(key));
      if (!head) return null;
      if (head.size > maxBytes) return null;
      const object = await inStage("object_read", () => binding.get(key));
      if (!object) return null;
      const chunks: Buffer[] = [];
      await consumeStream(object.body, (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      return Buffer.concat(chunks);
    },

    async upload(bucket, path, data, contentType) {
      const kind = bucketKindForLogicalBucket(bucket);
      if (!kind) throw new Error("studio_unknown_logical_bucket");
      const binding = bindingForKind(bindings, kind);
      const isPublic = kind === "public_media";
      await inStage(isPublic ? "public_object_write" : "object_write", () =>
        binding.put(r2ObjectKey(bucket, path), new Uint8Array(data), {
          httpMetadata: {
            ...(contentType ? { contentType } : {}),
            // Public objects are immutable and content-addressed; private ones
            // get no caching hint at all because nothing ever caches them.
            ...(isPublic ? { cacheControl: PUBLIC_MEDIA_CACHE_CONTROL } : {}),
          },
        }),
      );
    },

    async remove(bucket, paths) {
      const binding = bindingFor(bindings, bucket);
      for (const path of paths) {
        // Deletion is only ever job hygiene. A key outside a job prefix is a
        // bug in the caller, and refusing it here keeps that bug from becoming
        // data loss.
        if (!JOB_SCOPED_PATH.test(path)) throw new Error("r2_delete_outside_job_scope");
        await inStage("object_delete", () => binding.delete(r2ObjectKey(bucket, path)));
      }
    },

    publicUrl(bucket, path) {
      if (bucketKindForLogicalBucket(bucket) !== "public_media") {
        throw new Error("studio_public_url_forbidden_bucket");
      }
      return `${publicOrigin.replace(/\/$/, "")}/${r2ObjectKey(bucket, path)}`;
    },
  };
}

/** Re-exported so the provider can raise the same refusal shape. */
export { StudioStageError };
