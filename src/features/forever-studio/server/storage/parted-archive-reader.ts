/**
 * Forever Studio — the bounded reader over an archive stored as PART OBJECTS.
 *
 * Both parted lanes read the same way, so they read through the same object:
 *
 *   - the legacy Supabase lane, whose parts live in the private staging bucket;
 *   - the R2 parts-as-objects lane
 *     (FOREVER-R2-BINDING-NATIVE-MULTIPART-ARCHIVE-001), whose parts live under
 *     one archive-scoped prefix in the archive bucket.
 *
 * Only the BUCKET and the PATH FUNCTION differ, so those are the only things
 * this module is parameterized by. Everything that makes the reader safe — the
 * one-part cache, the exact-size check, the range arithmetic — is written once
 * and is therefore identical on both providers by construction rather than by
 * two implementations agreeing.
 *
 * The memory profile is the contract: at most ONE part is resident, whatever
 * the archive's total size. Nothing here ever holds the whole archive.
 */

import type { StudioObjectDigest, StudioStorage } from "../contracts";
import type { StudioArchiveByteReader, StudioArchiveGeometry } from "./provider";

/** Exact stored size of one part (the last one may be short). */
export function expectedPartSize(geometry: StudioArchiveGeometry, index: number): number {
  if (index < geometry.partCount - 1) return geometry.partSize;
  return geometry.declaredSize - geometry.partSize * (geometry.partCount - 1);
}

/** Where one lane keeps its part objects. */
export interface PartedArchiveLayout {
  /** Logical bucket holding the part objects. */
  readonly bucket: string;
  /** Logical path of one part object. */
  pathFor(geometry: StudioArchiveGeometry, index: number): string;
}

/**
 * Bounded random access across the stored part objects. At most one part is
 * cached, so sequential small reads inside a part hit storage once while peak
 * memory stays ≈ one part.
 */
export class PartedArchiveReader implements StudioArchiveByteReader {
  private cache: { index: number; data: Buffer } | null = null;

  constructor(
    private readonly storage: StudioStorage,
    private readonly layout: PartedArchiveLayout,
    private readonly geometry: StudioArchiveGeometry,
    private readonly totalSize: number,
  ) {}

  size(): number {
    return this.totalSize;
  }

  private pathFor(index: number): string {
    return this.layout.pathFor(this.geometry, index);
  }

  private async part(index: number): Promise<Buffer> {
    if (this.cache?.index === index) return this.cache.data;
    const data = await this.storage.downloadWithin(
      this.layout.bucket,
      this.pathFor(index),
      this.geometry.partSize,
    );
    // A short, long or missing part is never silently tolerated: the ranged ZIP
    // reader above would otherwise interpret whatever bytes it did get.
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
    return this.storage.hashObject(this.layout.bucket, this.pathFor(index), headBytes);
  }

  streamPart(
    index: number,
    onChunk: (chunk: Buffer) => void | Promise<void>,
  ): Promise<number | null> {
    return this.storage.readObjectStream(this.layout.bucket, this.pathFor(index), onChunk);
  }
}
