/**
 * Test fixtures for the large-archive lane: a parts-aware synthetic ZIP
 * builder (STORE and DEFLATE, hostile variants via the shared zip-writer) and
 * a simulated browser that plans, uploads parts, and confirms — so the
 * production plan/confirm/slice code is exercised for real against the
 * in-memory fakes. The part-streaming builder never materializes the whole
 * archive when generating near-300 MiB fixtures.
 */

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { zipCrc32 } from "@/intake/zip";

import { confirmJobArchiveUpload, planJobArchiveUpload, startUploadJob } from "../server/service";
import type { StudioActor } from "../server/contracts";
import type { StartJobInput } from "../studio-types";
import { PRIVATE_SOURCE_BUCKET } from "../server/extraction";
import type { FakeWorld } from "./fakes";

export function sha256HexSync(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Part-streaming ZIP builder (STORE / DEFLATE), whole-archive never held
// ---------------------------------------------------------------------------

export class PartEmitter {
  readonly parts: Buffer[] = [];
  private pending: Buffer[] = [];
  private pendingLength = 0;
  totalBytes = 0;

  constructor(private readonly partSize: number) {}

  append(chunk: Buffer): void {
    this.totalBytes += chunk.length;
    this.pending.push(chunk);
    this.pendingLength += chunk.length;
    while (this.pendingLength >= this.partSize) {
      const merged = Buffer.concat(this.pending);
      this.parts.push(merged.subarray(0, this.partSize));
      const rest = merged.subarray(this.partSize);
      this.pending = rest.length ? [rest] : [];
      this.pendingLength = rest.length;
    }
  }

  finish(): Buffer[] {
    if (this.pendingLength > 0) {
      this.parts.push(Buffer.concat(this.pending));
      this.pending = [];
      this.pendingLength = 0;
    }
    return this.parts;
  }
}

export interface StreamedZipEntry {
  name: string;
  /** Entry payload; provided per entry so only one lives in memory at once. */
  data: () => Buffer;
  method?: 0 | 8;
  /** Corrupt the stored CRC to model a damaged entry. */
  corruptCrc?: boolean;
}

/**
 * Build a well-formed ZIP directly into fixed-size parts. Only one entry's
 * payload plus one part boundary is ever resident while building, so a
 * near-300 MiB fixture can be generated without a 300 MiB test buffer.
 */
export function buildZipParts(
  entries: StreamedZipEntry[],
  partSize: number,
): { parts: Buffer[]; totalSize: number } {
  const emitter = new PartEmitter(partSize);
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw = entry.data();
    const method = entry.method ?? 0;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const crc = entry.corruptCrc ? (zipCrc32(raw) ^ 0xffffffff) >>> 0 : zipCrc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    emitter.append(local);
    emitter.append(nameBuf);
    emitter.append(stored);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0x21, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(stored.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(nameBuf.length, 28);
    record.writeUInt32LE(0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBuf);
    offset += 30 + nameBuf.length + stored.length;
  }

  const centralDir = Buffer.concat(central);
  emitter.append(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  emitter.append(eocd);
  return { parts: emitter.finish(), totalSize: emitter.totalBytes };
}

export function splitBuffer(buffer: Buffer, partSize: number): Buffer[] {
  const parts: Buffer[] = [];
  for (let start = 0; start < buffer.length; start += partSize) {
    parts.push(buffer.subarray(start, Math.min(buffer.length, start + partSize)));
  }
  return parts;
}

/** Deterministic incompressible-ish payload (fast to generate, stable). */
export function patternBytes(size: number, seed: number): Buffer {
  const buffer = Buffer.allocUnsafe(size);
  let state = (seed * 2654435761) >>> 0;
  for (let i = 0; i < size; i += 4) {
    state = (state * 1664525 + 1013904223) >>> 0;
    buffer.writeUInt32LE(state, i - (i + 4 > size ? i + 4 - size : 0));
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Simulated browser: start job → plan → upload parts → confirm
// ---------------------------------------------------------------------------

export async function startArchiveJob(
  world: FakeWorld,
  actor: StudioActor,
  input?: Partial<StartJobInput>,
): Promise<string> {
  const started = await startUploadJob(world.deps, actor, {
    workflow: "new_development",
    files: [],
    ...input,
  });
  return started.jobId;
}

export interface UploadedArchive {
  archiveId: string;
  parts: Buffer[];
  totalSize: number;
}

/**
 * Simulate the browser's resumable upload of pre-built parts: plan, write
 * each part to its signed target path, then confirm with per-part digests.
 */
export async function uploadArchiveParts(
  world: FakeWorld,
  actor: StudioActor,
  jobId: string,
  fileName: string,
  parts: Buffer[],
  totalSize: number,
  options: { skipParts?: number[]; tamperPart?: number; skipConfirm?: boolean } = {},
): Promise<UploadedArchive> {
  const plan = await planJobArchiveUpload(world.deps, actor, {
    jobId,
    fileName,
    declaredSize: totalSize,
  });
  for (const target of plan.parts) {
    if (options.skipParts?.includes(target.index)) continue;
    const data = parts[target.index];
    world.storage.put(target.bucket, target.path, Buffer.from(data));
  }
  if (options.tamperPart != null) {
    const target = plan.parts.find((part) => part.index === options.tamperPart);
    if (target) {
      const tampered = Buffer.from(parts[options.tamperPart]);
      tampered[Math.floor(tampered.length / 2)] ^= 0xff;
      world.storage.put(target.bucket, target.path, tampered);
    }
  }
  if (!options.skipConfirm) {
    await confirmJobArchiveUpload(world.deps, actor, {
      jobId,
      archiveId: plan.archiveId,
      partSha256: parts.map((part) => sha256HexSync(part)),
    });
  }
  return { archiveId: plan.archiveId, parts, totalSize };
}

/** Every private staging object key currently stored for one job's parts. */
export function storedPartKeys(world: FakeWorld, jobId: string): string[] {
  const prefix = `${PRIVATE_SOURCE_BUCKET}/jobs/${jobId}/parts/`;
  return [...world.storage.objects.keys()].filter((key) => key.startsWith(prefix));
}
