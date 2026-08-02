/**
 * Forever Studio — the LEGACY Supabase Storage provider.
 *
 * It is the same behaviour production runs today, expressed through the
 * provider contract: signed-upload tokens for ordinary files, many fixed-size
 * part objects in the private staging bucket for a large archive, and public
 * derivatives in the Supabase public buckets served from their Supabase URLs.
 *
 * It exists for exactly one reason after the cutover: jobs and manifests
 * created BEFORE the cutover must keep resuming, retrying and reading through
 * the path they were created on. It is never selected as a fallback for a
 * failing R2 operation — only for a job that genuinely records `supabase` (or
 * records no provider at all, which is the same thing).
 *
 * This module contains no R2 concept whatsoever.
 */

import type { StudioArchivePartTarget } from "../../studio-types";
import type { StudioObjectDigest, StudioStorage } from "../contracts";
import { archivePartFolder, archivePartPath } from "./archive-paths";
import type {
  StudioAcceptedPart,
  StudioAllocatedUpload,
  StudioArchiveByteReader,
  StudioArchiveGeometry,
  StudioArchiveStorageState,
  StudioObjectLocator,
  StudioStorageProvider,
} from "./provider";
import { bucketKindForLogicalBucket, LOGICAL_PRIVATE_SOURCE_BUCKET } from "./r2-layout";

/** Exact stored size of one part (the last one may be short). */
function expectedPartSize(geometry: StudioArchiveGeometry, index: number): number {
  if (index < geometry.partCount - 1) return geometry.partSize;
  return geometry.declaredSize - geometry.partSize * (geometry.partCount - 1);
}

/**
 * Bounded random access across the stored part objects. At most one part is
 * cached, so sequential small reads inside a part hit storage once while peak
 * memory stays ≈ one part. Moved verbatim from large-archive.ts.
 */
class SupabasePartedReader implements StudioArchiveByteReader {
  private cache: { index: number; data: Buffer } | null = null;

  constructor(
    private readonly storage: StudioStorage,
    private readonly geometry: StudioArchiveGeometry,
    private readonly totalSize: number,
  ) {}

  size(): number {
    return this.totalSize;
  }

  private async part(index: number): Promise<Buffer> {
    if (this.cache?.index === index) return this.cache.data;
    const data = await this.storage.downloadWithin(
      LOGICAL_PRIVATE_SOURCE_BUCKET,
      archivePartPath(this.geometry.jobId, this.geometry.archiveId, index),
      this.geometry.partSize,
    );
    if (!data || data.length !== expectedPartSize(this.geometry, index)) {
      throw new Error("studio_archive_part_unreadable");
    }
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
      const from = Math.max(0, start - partStart);
      const to = Math.min(data.length, endExclusive - partStart);
      chunks.push(data.subarray(from, to));
    }
    // A single-part read returns a READ-ONLY view of the cached part rather
    // than an up-to-8-MiB copy; every consumer treats source bytes as
    // immutable and a retained view pins at most one part-sized buffer.
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  }

  hashPart(index: number, headBytes: number): Promise<StudioObjectDigest | null> {
    return this.storage.hashObject(
      LOGICAL_PRIVATE_SOURCE_BUCKET,
      archivePartPath(this.geometry.jobId, this.geometry.archiveId, index),
      headBytes,
    );
  }

  streamPart(
    index: number,
    onChunk: (chunk: Buffer) => void | Promise<void>,
  ): Promise<number | null> {
    return this.storage.readObjectStream(
      LOGICAL_PRIVATE_SOURCE_BUCKET,
      archivePartPath(this.geometry.jobId, this.geometry.archiveId, index),
      onChunk,
    );
  }
}

export function createSupabaseStorageProvider(storage: StudioStorage): StudioStorageProvider {
  const partTarget = async (
    geometry: StudioArchiveGeometry,
    index: number,
  ): Promise<StudioArchivePartTarget> => {
    const path = archivePartPath(geometry.jobId, geometry.archiveId, index);
    const { token } = await storage.createSignedUpload(LOGICAL_PRIVATE_SOURCE_BUCKET, path);
    return {
      index,
      bucket: LOGICAL_PRIVATE_SOURCE_BUCKET,
      path,
      token,
      transport: { kind: "supabase_signed", bucket: LOGICAL_PRIVATE_SOURCE_BUCKET, path, token },
    };
  };

  return {
    id: "supabase",
    objects: storage,

    // The Supabase lane keeps an archive as many permanent part objects, so
    // "which parts does storage hold" is an ordinary bounded folder listing.
    // That authority exists on every host, so the lane is always available.
    archiveControlPlane: "available",

    async allocateOrdinaryUpload(input): Promise<StudioAllocatedUpload> {
      const { token } = await storage.createSignedUpload(input.bucket, input.path);
      return {
        bucket: input.bucket,
        path: input.path,
        transport: {
          kind: "supabase_signed",
          bucket: input.bucket,
          path: input.path,
          token,
        },
      };
    },

    async beginArchiveUpload(): Promise<StudioArchiveStorageState> {
      // Part objects are addressed deterministically from (job, archive, index);
      // there is nothing extra to remember.
      return { provider: "supabase" };
    },

    async archivePartTargets({ geometry, indexes }) {
      const targets: StudioArchivePartTarget[] = [];
      for (const index of indexes) targets.push(await partTarget(geometry, index));
      return targets;
    },

    async listAcceptedArchiveParts({ geometry }) {
      const listed = await storage.listObjects(
        LOGICAL_PRIVATE_SOURCE_BUCKET,
        archivePartFolder(geometry.jobId, geometry.archiveId),
      );
      const accepted = new Map<number, StudioAcceptedPart>();
      for (const object of listed) {
        if (!/^\d{5}$/.test(object.name)) continue;
        accepted.set(Number(object.name), { size: object.size });
      }
      return accepted;
    },

    async completeArchiveUpload({ state }) {
      // Acceptance IS completion on this lane: the parts are already durable
      // objects and the ranged reader assembles them on demand.
      return state;
    },

    async abortArchiveUpload() {
      // Never destructive: a Supabase archive's parts are the privately
      // retained original and must survive an abandoned upload.
    },

    async discardArchiveParts({ geometry, indexes }) {
      if (!indexes.length) return;
      await storage.remove(
        LOGICAL_PRIVATE_SOURCE_BUCKET,
        indexes.map((index) => archivePartPath(geometry.jobId, geometry.archiveId, index)),
      );
    },

    archiveReader({ geometry, totalSize }) {
      return new SupabasePartedReader(storage, geometry, totalSize);
    },

    buildPublicUrl(bucket, path) {
      if (bucketKindForLogicalBucket(bucket) !== "public_media") {
        throw new Error("studio_public_url_forbidden_bucket");
      }
      return storage.publicUrl(bucket, path);
    },

    locatorFor(bucket, path): StudioObjectLocator {
      const bucketKind = bucketKindForLogicalBucket(bucket);
      if (!bucketKind) throw new Error("studio_unknown_logical_bucket");
      return { storageProvider: "supabase", bucketKind, bucket, objectKey: path };
    },
  };
}
