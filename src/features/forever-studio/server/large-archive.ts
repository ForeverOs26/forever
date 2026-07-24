/**
 * Forever Studio — large-archive intake (FOREVER-STUDIO-LARGE-ARCHIVE-001).
 *
 * Replaces the 16 MiB synchronous ZIP ceiling with a commercially usable
 * 300 MiB lane built entirely on existing infrastructure:
 *
 *   UPLOAD    The browser slices a ZIP into fixed 8 MiB parts and uploads each
 *             through its own short-lived signed URL into the PRIVATE staging
 *             bucket — resumable at part granularity over unstable internet,
 *             and never proxied through the application server. Resume
 *             identity is the EXACT ordered per-part SHA-256 manifest (every
 *             byte hashed), never the filename and never a sampled digest.
 *             Storage acceptance proves existence + exact size of
 *             every part (uploaded_unverified); the stored bytes of every
 *             part are then streamed through SHA-256 by the first processing
 *             slices, and ONLY after all of them match does the archive
 *             become byte_verified. Nothing expands before that.
 *
 *   INVENTORY Once byte-verified (and the exact whole-archive SHA-256 is
 *             recorded from the ordered parts), the central directory is read
 *             through bounded range reads (never the whole archive), the
 *             COMPLETE entry-set safety contract runs before any expansion,
 *             and a durable per-entry inventory row is written for every file
 *             entry. Completion is derived from these rows, never a loop.
 *
 *   SLICES    Processing advances in bounded, claim-scoped slices: each slice
 *             verifies a few parts, or indexes, or routes a bounded batch of
 *             entries (facts JSON → fields, price artifacts → price pipeline,
 *             supported images → the PR #99 media-truth pipeline, oversized
 *             entries → the streaming private-evidence lane, everything else
 *             → private retention WITH independently addressable evidence),
 *             checkpointing every outcome through claim-checked pending-only
 *             writes. The slice then releases the claim so the next caller —
 *             the uploader page, any signed-in Studio session, or the
 *             scheduled runner (Cloudflare Cron → Worker scheduled() → the
 *             cloudflare:scheduled hook) — continues promptly with no browser
 *             session required.
 *
 * Privacy: original filenames and raw entry paths live only in the internal
 * service-role tables. Everything projected to the browser uses neutral
 * labels ("Archive 1", "entry 12"), and media metadata crosses the public
 * boundary only through the claims-stripped media-truth projection.
 */

import type {
  ProgressiveMediaItem,
  ProgressiveWarning,
} from "@/features/forever-ingestion/batch-types";
import {
  readZipDirectoryRanged,
  readZipEntryDataRanged,
  streamZipEntryDataRanged,
  type RangedZipDirectory,
  type RangedZipLimits,
  type ZipByteSource,
} from "@/intake/zip-ranged";
import { sanitizePriceList } from "@/intake/sanitize";
import type { IntakeCategory, IntakeProjectFacts } from "@/intake/types";
import { ZipError } from "@/intake/zip";
import type { ExtractedPriceList } from "@/import/types";

import {
  ARCHIVE_PART_BYTES,
  archivePartCountForSize,
  JOB_SOURCE_BUDGET_BYTES,
  LARGE_ARCHIVE_MAX_BYTES,
  MAX_ARCHIVES_PER_JOB,
  UPLOAD_MANIFEST_DOMAIN,
  type StudioArchiveConfirmInput,
  type StudioArchiveConfirmResult,
  type StudioArchivePartTarget,
  type StudioArchivePlanInput,
  type StudioArchivePlanResult,
  type StudioArchiveProgress,
  type StudioJobProgress,
} from "../studio-types";
import type {
  StudioArchiveEntryOutcome,
  StudioArchiveEntryRow,
  StudioArchiveExtracted,
  StudioArchivePartRecord,
  StudioArchiveRow,
  StudioDeps,
  StudioEntryEvidence,
  StudioEntryEvidencePart,
  StudioJobRow,
} from "./contracts";
import { StudioAccessError } from "./contracts";
import { safeMessageFor, StudioError } from "./errors";
import {
  canonicalPublicContentType,
  classifyFileName,
  detectMediaClass,
  HEAD_SNIFF_BYTES,
  isPublishableMediaClass,
  looksLikePriceList,
  looksLikeProjectFacts,
  MAX_PARSE_BYTES,
  mediaTypeForCategory,
  NEUTRAL_MEDIA_TITLE,
  parseJsonBuffer,
  PRIVATE_SOURCE_BUCKET,
  projectFieldsFromFacts,
  publicBucketForCategory,
  publicPathForDerivative,
  attemptPrefixFromToken,
  type ExtractedFactFields,
} from "./extraction";
import {
  createPublicDerivative,
  MAX_MEDIA_SANITIZE_BYTES,
  publicMediaTruthProjection,
} from "./media-truth";

// ---------------------------------------------------------------------------
// Budgets and limits (explicit, memory-bounded by construction)
// ---------------------------------------------------------------------------

/**
 * ZIP structure limits for the 300 MiB lane. The 300 MiB source cap is a
 * product limit, NOT permission for unbounded expansion: per-entry expansion
 * is capped at the media-sanitize ceiling (nothing larger can ever publish),
 * and the whole archive may expand to at most 1 GiB of routed entry bytes.
 * Peak processing memory is one compressed entry + one inflated entry + the
 * size-capped central directory — far below the Worker envelope.
 */
export const LARGE_ARCHIVE_ZIP_LIMITS: RangedZipLimits = {
  maxArchiveBytes: LARGE_ARCHIVE_MAX_BYTES, // 300 MiB source ceiling
  maxEntries: 2000,
  maxFileBytes: MAX_MEDIA_SANITIZE_BYTES, // 24 MiB expanded per entry
  maxCompressedEntryBytes: MAX_MEDIA_SANITIZE_BYTES, // bounds one range read
  maxTotalBytes: 1024 * 1024 * 1024, // 1 GiB expanded per archive
  maxCompressionRatio: 200,
  maxPathLength: 512,
  maxCentralDirectoryBytes: 4 * 1024 * 1024,
};

/** Entry-routing work per slice (checkpoint cadence). */
export const SLICE_MAX_ENTRIES = 24;
/** Expanded bytes routed per slice. */
export const SLICE_MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
/** Part hashes verified per slice (8 MiB streamed each). */
export const SLICE_MAX_VERIFY_PARTS = 12;
/** Fixed size of one stored private evidence part (mirrors upload parts). */
export const EVIDENCE_PART_BYTES = ARCHIVE_PART_BYTES;
/** Public media budget per job across ordinary files and every archive. */
export const MAX_PUBLIC_MEDIA_PER_JOB = 500;
/** Cap on durable adopted-artifact payload (sanitized price list + facts). */
export const MAX_EXTRACTED_ARTIFACT_BYTES = 2 * 1024 * 1024;

/** Containment root for entry-name validation only — nothing is written. */
const VIRTUAL_DEST = "/forever-studio-large-archive-virtual";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function archivePartPath(jobId: string, archiveId: string, index: number): string {
  return `jobs/${jobId}/parts/${archiveId}/${String(index).padStart(5, "0")}`;
}

function archivePartFolder(jobId: string, archiveId: string): string {
  return `jobs/${jobId}/parts/${archiveId}`;
}

/**
 * Private evidence folder for ONE entry. Deterministic (no attempt token):
 * every attempt derives byte-identical content from the same verified archive
 * parts, so a concurrent rewrite can only write the same bytes — and the
 * settled manifest records what was verified in storage.
 */
export function entryEvidenceFolder(jobId: string, archiveId: string, entryIndex: number): string {
  return `jobs/${jobId}/evidence/${archiveId}/${String(entryIndex).padStart(5, "0")}`;
}

export function entryEvidencePartPath(prefix: string, index: number): string {
  return `${prefix}/${String(index).padStart(5, "0")}`;
}

/** Neutral public-safe archive label; original filenames stay private. */
export function archiveLabel(ordinal: number): string {
  return `Archive ${ordinal + 1}`;
}

function neutralWarning(code: string, message: string): ProgressiveWarning {
  return { entity: "document", code, severity: "warning", message };
}

async function sha256Hex(data: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}

function expectedPartSize(archive: StudioArchiveRow, index: number): number {
  if (index < archive.part_count - 1) return archive.part_size;
  return archive.declared_size - archive.part_size * (archive.part_count - 1);
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Cryptographically complete resume identity over the exact ordered per-part
 * manifest: SHA-256 of domain/version, exact file size, fixed part size, part
 * count, and the ordered RAW per-part digests. Derived by the SERVER from the
 * submitted manifest — the client never supplies this value. Used only to
 * find resume candidates; the actual resume decision additionally requires
 * the full stored manifest to match digest-for-digest.
 */
export async function deriveManifestSha256(
  declaredSize: number,
  partSize: number,
  partSha256: string[],
): Promise<string> {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  hash.update(Buffer.from(UPLOAD_MANIFEST_DOMAIN, "utf8"));
  const geometry = Buffer.alloc(16);
  geometry.writeBigUInt64BE(BigInt(declaredSize), 0);
  geometry.writeUInt32BE(partSize, 8);
  geometry.writeUInt32BE(partSha256.length, 12);
  hash.update(geometry);
  for (const digest of partSha256) hash.update(Buffer.from(digest, "hex"));
  return hash.digest("hex");
}

/** True when the archive's recorded manifest equals the submitted one exactly. */
function manifestMatchesArchive(archive: StudioArchiveRow, partSha256: string[]): boolean {
  if (archive.part_count !== partSha256.length) return false;
  if (archive.parts.length !== partSha256.length) return false;
  return archive.parts.every(
    (part, index) => part.index === index && part.declaredSha256 === partSha256[index],
  );
}

// ---------------------------------------------------------------------------
// Random-access source over the verified part objects
// ---------------------------------------------------------------------------

/**
 * Maps bounded range reads onto the stored 8 MiB part objects. At most one
 * part is cached, so sequential small-entry reads within a part hit storage
 * once while peak memory stays ≈ one part per open read span.
 */
export class PartedArchiveSource implements ZipByteSource {
  private cache: { index: number; data: Buffer } | null = null;

  constructor(
    private readonly deps: StudioDeps,
    private readonly jobId: string,
    private readonly archive: StudioArchiveRow,
    private readonly totalSize: number,
  ) {}

  size(): number {
    return this.totalSize;
  }

  private async part(index: number): Promise<Buffer> {
    if (this.cache?.index === index) return this.cache.data;
    const path = archivePartPath(this.jobId, this.archive.id, index);
    const data = await this.deps.storage.downloadWithin(
      PRIVATE_SOURCE_BUCKET,
      path,
      this.archive.part_size,
    );
    if (!data || data.length !== expectedPartSize(this.archive, index)) {
      throw new StudioError("storage_unavailable", safeMessageFor("storage_unavailable"), true);
    }
    this.cache = { index, data };
    return data;
  }

  async read(start: number, endExclusive: number): Promise<Buffer> {
    if (start < 0 || endExclusive > this.totalSize || endExclusive < start) {
      throw new StudioError("processing_failed", safeMessageFor("processing_failed"), true);
    }
    const firstPart = Math.floor(start / this.archive.part_size);
    const lastPart = Math.floor((endExclusive - 1) / this.archive.part_size);
    const chunks: Buffer[] = [];
    for (let index = firstPart; index <= lastPart; index += 1) {
      const data = await this.part(index);
      const partStart = index * this.archive.part_size;
      const from = Math.max(0, start - partStart);
      const to = Math.min(data.length, endExclusive - partStart);
      chunks.push(data.subarray(from, to));
    }
    // Single-part reads return a READ-ONLY view of the cached part instead of
    // an up-to-8-MiB copy per read: every consumer treats source bytes as
    // immutable, and a retained view pins at most one part-sized buffer —
    // the same bound as the cache itself. Cross-part reads still concatenate.
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  }
}

// ---------------------------------------------------------------------------
// Plan: register the part manifest, issue signed part targets (resumable)
// ---------------------------------------------------------------------------

function jobDeclaredSourceBytes(job: StudioJobRow, archives: StudioArchiveRow[]): number {
  const files = job.files.reduce((sum, file) => sum + (file.declaredSize ?? 0), 0);
  const archived = archives.reduce((sum, archive) => sum + archive.declared_size, 0);
  return files + archived;
}

async function partTargets(
  deps: StudioDeps,
  jobId: string,
  archiveId: string,
  indexes: number[],
): Promise<StudioArchivePartTarget[]> {
  const targets: StudioArchivePartTarget[] = [];
  for (const index of indexes) {
    const path = archivePartPath(jobId, archiveId, index);
    const { token } = await deps.storage.createSignedUpload(PRIVATE_SOURCE_BUCKET, path);
    targets.push({ index, bucket: PRIVATE_SOURCE_BUCKET, path, token });
  }
  return targets;
}

/** Stored part sizes keyed by index, from one bounded folder listing. */
async function storedPartSizes(
  deps: StudioDeps,
  jobId: string,
  archiveId: string,
): Promise<Map<number, number>> {
  const listed = await deps.storage.listObjects(
    PRIVATE_SOURCE_BUCKET,
    archivePartFolder(jobId, archiveId),
  );
  const sizes = new Map<number, number>();
  for (const object of listed) {
    if (!/^\d{5}$/.test(object.name)) continue;
    sizes.set(Number(object.name), object.size);
  }
  return sizes;
}

/**
 * Register (or resume) one large-archive upload for a job the actor owns.
 * Resume identity is the EXACT ordered per-part SHA-256 manifest — NEVER the
 * filename, and never a sampled digest: re-planning resumes an existing
 * archive only when the complete manifest matches digest-for-digest (plus the
 * exact size and part geometry), while ANY difference — even a single byte
 * anywhere in the file — produces a fresh archive id and fresh part paths, so
 * stale parts can never attach to different bytes. The job must not be
 * published yet.
 */
export async function planArchiveUpload(
  deps: StudioDeps,
  job: StudioJobRow,
  input: StudioArchivePlanInput,
): Promise<StudioArchivePlanResult> {
  if (job.status === "published") {
    throw new StudioAccessError(
      "job_already_published",
      "This upload already published. Start a new upload to add more archives.",
    );
  }
  const fileName = input.fileName.trim();
  if (!fileName || !fileName.toLowerCase().endsWith(".zip")) {
    throw new StudioAccessError("archive_not_zip", "Only ZIP archives use the large-archive lane.");
  }
  if (
    !Number.isInteger(input.declaredSize) ||
    input.declaredSize <= 0 ||
    input.declaredSize > LARGE_ARCHIVE_MAX_BYTES
  ) {
    throw new StudioAccessError(
      "archive_too_large",
      `Archives up to ${Math.round(LARGE_ARCHIVE_MAX_BYTES / (1024 * 1024))} MB are supported.`,
    );
  }
  const partSha256 = (input.partSha256 ?? []).map((digest) => digest?.toLowerCase());
  if (
    partSha256.length !== archivePartCountForSize(input.declaredSize) ||
    partSha256.some((digest) => !digest || !SHA256_HEX.test(digest))
  ) {
    throw new StudioAccessError("archive_manifest_invalid");
  }
  const manifestSha256 = await deriveManifestSha256(
    input.declaredSize,
    ARCHIVE_PART_BYTES,
    partSha256,
  );

  const archives = await deps.data.listJobArchives(job.id);
  const existing = archives.find(
    (archive) =>
      archive.manifest_sha256 === manifestSha256 &&
      archive.declared_size === input.declaredSize &&
      archive.part_size === ARCHIVE_PART_BYTES &&
      archive.status !== "rejected" &&
      // The identity digest narrows the candidate; the RESUME decision itself
      // requires the entire stored manifest to match, digest for digest.
      manifestMatchesArchive(archive, partSha256),
  );
  if (existing) {
    const sizes = await storedPartSizes(deps, job.id, existing.id);
    const present: number[] = [];
    const missing: number[] = [];
    for (let index = 0; index < existing.part_count; index += 1) {
      if (sizes.get(index) === expectedPartSize(existing, index)) present.push(index);
      else missing.push(index);
    }
    const alreadyAccepted = existing.status !== "planned";
    return {
      archiveId: existing.id,
      partSize: existing.part_size,
      partCount: existing.part_count,
      presentParts: present,
      parts: alreadyAccepted ? [] : await partTargets(deps, job.id, existing.id, missing),
    };
  }

  if (archives.length >= MAX_ARCHIVES_PER_JOB) {
    throw new StudioAccessError(
      "too_many_archives",
      `At most ${MAX_ARCHIVES_PER_JOB} archives per upload.`,
    );
  }
  if (jobDeclaredSourceBytes(job, archives) + input.declaredSize > JOB_SOURCE_BUDGET_BYTES) {
    throw new StudioAccessError(
      "job_source_budget_exceeded",
      "This upload exceeds the 1 GB source-material budget. Split it across uploads.",
    );
  }

  const partCount = partSha256.length;
  const row: StudioArchiveRow = {
    id: crypto.randomUUID(),
    job_id: job.id,
    // Plan order is the deterministic processing order: facts and price
    // artifacts adopt first-archive-wins, independent of clock resolution.
    ordinal: archives.length,
    file_name: fileName,
    manifest_sha256: manifestSha256,
    declared_size: input.declaredSize,
    part_size: ARCHIVE_PART_BYTES,
    part_count: partCount,
    // The complete per-part manifest is bound to the archive AT PLAN TIME:
    // every later confirm must present exactly this manifest, and byte
    // verification hashes the actual stored bytes against these claims.
    parts: partSha256.map((declaredSha256, index) => ({
      index,
      size: null,
      declaredSha256,
      sha256: null,
      verified: false,
    })),
    observed_size: null,
    composite_sha256: null,
    archive_sha256: null,
    status: "planned",
    entry_count: null,
    total_uncompressed: null,
    extracted: null,
    error_code: null,
    created_at: deps.now(),
  };
  await deps.data.createArchive(row);
  return {
    archiveId: row.id,
    partSize: row.part_size,
    partCount,
    presentParts: [],
    parts: await partTargets(
      deps,
      job.id,
      row.id,
      Array.from({ length: partCount }, (_, index) => index),
    ),
  };
}

// ---------------------------------------------------------------------------
// Confirm: verify every stored part's existence + exact size, record claims
// ---------------------------------------------------------------------------

/**
 * The browser's completion claim is never trusted: storage acceptance
 * requires every part to exist in private staging with exactly the planned
 * size. That makes the archive UPLOADED_UNVERIFIED — durably stored, NOT yet
 * byte-verified. Per-part SHA-256 claims are recorded here and verified
 * against the ACTUAL stored bytes by the first processing slices; only after
 * EVERY part hash-verifies does the archive become byte_verified. No caller
 * may describe this acceptance as "verified".
 */
export async function confirmArchiveUpload(
  deps: StudioDeps,
  job: StudioJobRow,
  input: StudioArchiveConfirmInput,
): Promise<StudioArchiveConfirmResult> {
  const archive = await deps.data.getArchive(input.archiveId);
  if (!archive || archive.job_id !== job.id) {
    throw new StudioAccessError("archive_not_found");
  }
  // The confirming client must present EXACTLY the manifest this archive was
  // planned with. An accepted archive can therefore never be "confirmed" by a
  // caller holding different bytes — a mismatch is a hard refusal, never an
  // idempotent success, and never mutates the archive.
  const partSha256 = (input.partSha256 ?? []).map((digest) => digest?.toLowerCase());
  if (partSha256.some((sha) => !sha || !SHA256_HEX.test(sha))) {
    throw new StudioAccessError("archive_part_manifest_invalid");
  }
  if (!manifestMatchesArchive(archive, partSha256)) {
    throw new StudioAccessError("archive_manifest_mismatch");
  }
  if (archive.status !== "planned") {
    // Idempotent re-confirm of an already accepted archive — reached only
    // with the SAME complete manifest (proven above).
    return { archiveId: archive.id, accepted: true, missingParts: [] };
  }

  const sizes = await storedPartSizes(deps, job.id, archive.id);
  const badIndexes: number[] = [];
  for (let index = 0; index < archive.part_count; index += 1) {
    if (sizes.get(index) !== expectedPartSize(archive, index)) badIndexes.push(index);
  }
  if (badIndexes.length > 0) {
    // Wrong-sized objects are removed so a fresh signed target can rewrite
    // them; the archive stays unaccepted until every part verifies.
    const wrongSized = badIndexes.filter((index) => sizes.has(index));
    if (wrongSized.length) {
      await deps.storage.remove(
        PRIVATE_SOURCE_BUCKET,
        wrongSized.map((index) => archivePartPath(job.id, archive.id, index)),
      );
    }
    return {
      archiveId: archive.id,
      accepted: false,
      missingParts: await partTargets(deps, job.id, archive.id, badIndexes),
    };
  }

  // Record server-observed sizes; the declared per-part manifest was bound at
  // plan time and is preserved verbatim (confirm can never rewrite claims).
  const parts: StudioArchivePartRecord[] = archive.parts.map((part, i) => ({
    index: i,
    size: sizes.get(i) ?? null,
    declaredSha256: part.declaredSha256,
    sha256: null,
    verified: false,
  }));
  const observed = parts.reduce((sum, part) => sum + (part.size ?? 0), 0);
  const accepted = await deps.data.updateArchivePreProcessing(archive.id, ["planned"], {
    parts,
    observed_size: observed,
    status: "uploaded_unverified",
  });
  if (!accepted) {
    const current = await deps.data.getArchive(archive.id);
    return { archiveId: archive.id, accepted: current?.status !== "planned", missingParts: [] };
  }
  return { archiveId: archive.id, accepted: true, missingParts: [] };
}

// ---------------------------------------------------------------------------
// Slice engine (runs under the job's processing claim)
// ---------------------------------------------------------------------------

export interface ArchiveSliceOutcome {
  /** True when bounded budgets ended the slice with work remaining. */
  pendingWork: boolean;
  /** Number of archives attached to the job (0 → nothing to compose). */
  archiveCount: number;
}

interface SliceBudget {
  entries: number;
  expandedBytes: number;
  verifiedParts: number;
}

function budgetExhausted(budget: SliceBudget): boolean {
  return budget.entries >= SLICE_MAX_ENTRIES || budget.expandedBytes >= SLICE_MAX_EXPANDED_BYTES;
}

class ClaimLostError extends StudioError {
  constructor() {
    super("studio_job_not_claimed", safeMessageFor("studio_job_not_claimed"), true);
  }
}

async function updateArchiveClaimedOrThrow(
  deps: StudioDeps,
  jobId: string,
  token: string,
  archiveId: string,
  patch: Partial<StudioArchiveRow>,
): Promise<void> {
  const applied = await deps.data.updateArchiveIfClaimed(jobId, token, archiveId, patch);
  if (!applied) throw new ClaimLostError();
}

/**
 * Verify part hashes against the ACTUAL stored bytes, a bounded number per
 * slice, checkpointing each verified part. A hash mismatch rejects the whole
 * archive (retained privately) — corrupted originals are never expanded.
 * Only when EVERY part has hash-verified does the archive durably become
 * byte_verified — the single point after which "byte verification passed"
 * may be shown. Returns true when that happened in this slice.
 */
async function verifyArchiveParts(
  deps: StudioDeps,
  job: StudioJobRow,
  token: string,
  archive: StudioArchiveRow,
  budget: SliceBudget,
  heartbeat: () => Promise<void>,
): Promise<boolean> {
  if (archive.status === "uploaded_unverified") {
    await updateArchiveClaimedOrThrow(deps, job.id, token, archive.id, {
      status: "byte_verifying",
    });
    archive.status = "byte_verifying";
  }
  const parts = archive.parts.map((part) => ({ ...part }));
  for (const part of parts) {
    if (part.verified) continue;
    if (budget.verifiedParts >= SLICE_MAX_VERIFY_PARTS) return false;
    await heartbeat();
    const path = archivePartPath(job.id, archive.id, part.index);
    const digest = await deps.storage.hashObject(PRIVATE_SOURCE_BUCKET, path, HEAD_SNIFF_BYTES);
    budget.verifiedParts += 1;
    const expectedSize = expectedPartSize(archive, part.index);
    const zipMagicOk =
      part.index !== 0 ||
      (digest != null &&
        digest.head.length >= 4 &&
        digest.head[0] === 0x50 &&
        digest.head[1] === 0x4b);
    if (
      !digest ||
      digest.size !== expectedSize ||
      digest.sha256 !== part.declaredSha256 ||
      !zipMagicOk
    ) {
      await updateArchiveClaimedOrThrow(deps, job.id, token, archive.id, {
        status: "rejected",
        error_code: zipMagicOk ? "archive_part_integrity_failed" : "archive_format_unsupported",
      });
      return false;
    }
    part.sha256 = digest.sha256;
    part.verified = true;
    await updateArchiveClaimedOrThrow(deps, job.id, token, archive.id, { parts });
  }
  const composite = await sha256Hex(Buffer.from(parts.map((part) => part.sha256).join(""), "utf8"));
  // The EXACT whole-archive SHA-256 is streamed across the ordered verified
  // parts BEFORE the archive may durably become byte_verified: the database
  // lifecycle guard requires complete part evidence AND the exact archive
  // hash to enter that state, so the transition is one atomic patch.
  const exact = await computeExactArchiveSha(deps, job, archive, heartbeat);
  await updateArchiveClaimedOrThrow(deps, job.id, token, archive.id, {
    parts,
    composite_sha256: composite,
    archive_sha256: exact,
    status: "byte_verified",
  });
  archive.parts = parts;
  archive.composite_sha256 = composite;
  archive.archive_sha256 = exact;
  archive.status = "byte_verified";
  return true;
}

/**
 * Exact SHA-256 of the WHOLE archive, STREAMED across the ordered verified
 * parts in transport-sized chunks — never a whole-archive buffer and never
 * even a whole-part buffer (peak memory ≈ one transport chunk, so a 300 MiB
 * pass allocates no per-part 8 MiB buffers). Runs before the byte_verified
 * transition (which requires it as state evidence). This is the archive's
 * true file digest; composite_sha256 remains the digest-of-part-digests and
 * is never labelled as the file hash.
 */
async function computeExactArchiveSha(
  deps: StudioDeps,
  job: StudioJobRow,
  archive: StudioArchiveRow,
  heartbeat: () => Promise<void>,
): Promise<string> {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  for (let index = 0; index < archive.part_count; index += 1) {
    await heartbeat();
    const size = await deps.storage.readObjectStream(
      PRIVATE_SOURCE_BUCKET,
      archivePartPath(job.id, archive.id, index),
      (chunk) => {
        hash.update(chunk);
      },
    );
    if (size !== expectedPartSize(archive, index)) {
      throw new StudioError("storage_unavailable", safeMessageFor("storage_unavailable"), true);
    }
  }
  return hash.digest("hex");
}

/**
 * Read the central directory through bounded range reads, run the complete
 * entry-set safety contract, and persist the durable inventory. Set-level
 * safety failures reject the whole archive fail-closed (nothing expands);
 * the original parts stay privately retained either way.
 */
async function indexArchive(
  deps: StudioDeps,
  job: StudioJobRow,
  token: string,
  archive: StudioArchiveRow,
  source: PartedArchiveSource,
): Promise<RangedZipDirectory | null> {
  let directory: RangedZipDirectory;
  try {
    directory = await readZipDirectoryRanged(source, LARGE_ARCHIVE_ZIP_LIMITS, VIRTUAL_DEST);
  } catch (error) {
    if (error instanceof ZipError) {
      await updateArchiveClaimedOrThrow(deps, job.id, token, archive.id, {
        status: "rejected",
        error_code: "archive_rejected_unsafe",
      });
      return null;
    }
    throw error;
  }

  const rows: StudioArchiveEntryRow[] = [];
  let totalUncompressed = 0;
  directory.entries.forEach((entry, index) => {
    if (entry.isDirectory) return;
    totalUncompressed += entry.uncompressedSize;
    const category = classifyFileName(entry.name);
    rows.push({
      id: crypto.randomUUID(),
      archive_id: archive.id,
      job_id: job.id,
      entry_index: index,
      entry_name: entry.name,
      display_label: `entry ${index + 1} (${category})`,
      category,
      compressed_size: entry.compressedSize,
      uncompressed_size: entry.uncompressedSize,
      observed_size: null,
      sha256: null,
      media_class: null,
      state: "pending",
      outcome_code: null,
      public_bucket: null,
      public_path: null,
      public_url: null,
      media_type: null,
      media_title: null,
      media_truth: null,
      evidence: null,
      attempt: null,
      processed_at: null,
    });
  });

  // Bounded batches keep each claim-checked insert payload small.
  for (let start = 0; start < rows.length; start += 500) {
    const inserted = await deps.data.insertArchiveEntriesIfClaimed(
      job.id,
      token,
      rows.slice(start, start + 500),
    );
    if (!inserted) throw new ClaimLostError();
  }
  await updateArchiveClaimedOrThrow(deps, job.id, token, archive.id, {
    status: "processing_entries",
    entry_count: rows.length,
    total_uncompressed: totalUncompressed,
  });
  archive.status = "processing_entries";
  archive.entry_count = rows.length;
  return directory;
}

// --- Entry routing ----------------------------------------------------------

interface EntryContext {
  publishedCount: number;
  /** Durable digests of already-settled entries (digest → display label). */
  seenHashes: Map<string, string>;
  /** SHA-256 of media already public on the target project (cross-job dedup). */
  existingProjectHashes: Set<string>;
}

function settledOutcome(
  state: StudioArchiveEntryOutcome["state"],
  code: string | null,
  token: string,
  at: string,
  extra: Partial<StudioArchiveEntryOutcome> = {},
): StudioArchiveEntryOutcome {
  return {
    state,
    outcomeCode: code,
    attempt: attemptPrefixFromToken(token),
    processedAt: at,
    ...extra,
  };
}

/** Adopt a structured artifact into the archive's durable extracted state. */
async function adoptExtracted(
  deps: StudioDeps,
  job: StudioJobRow,
  token: string,
  archive: StudioArchiveRow,
  patch: Partial<StudioArchiveExtracted>,
): Promise<boolean> {
  const merged: StudioArchiveExtracted = { ...(archive.extracted ?? {}), ...patch };
  if (Buffer.byteLength(JSON.stringify(merged), "utf8") > MAX_EXTRACTED_ARTIFACT_BYTES) {
    return false;
  }
  await updateArchiveClaimedOrThrow(deps, job.id, token, archive.id, { extracted: merged });
  archive.extracted = merged;
  return true;
}

// --- Private entry evidence -------------------------------------------------

/**
 * Chunk-buffered writer for one entry's private evidence: accumulates the
 * uncompressed stream into fixed 8 MiB parts, uploads each to the private
 * bucket, re-hashes the ACTUAL stored object before recording it, and keeps a
 * running SHA-256 + head sniff of the whole entry. Peak memory ≈ one pending
 * part + one incoming chunk, independent of entry size.
 */
class EvidenceWriter {
  private readonly parts: StudioEntryEvidencePart[] = [];
  private pending: Buffer[] = [];
  private pendingLength = 0;
  private readonly headChunks: Buffer[] = [];
  private headLength = 0;
  totalBytes = 0;

  private constructor(
    private readonly deps: StudioDeps,
    private readonly prefix: string,
    private readonly heartbeat: () => Promise<void>,
    private readonly hash: import("node:crypto").Hash,
  ) {}

  static async open(
    deps: StudioDeps,
    prefix: string,
    heartbeat: () => Promise<void>,
  ): Promise<EvidenceWriter> {
    const { createHash } = await import("node:crypto");
    return new EvidenceWriter(deps, prefix, heartbeat, createHash("sha256"));
  }

  async push(chunk: Buffer): Promise<void> {
    if (chunk.length === 0) return;
    this.totalBytes += chunk.length;
    this.hash.update(chunk);
    if (this.headLength < HEAD_SNIFF_BYTES) {
      const take = chunk.subarray(0, HEAD_SNIFF_BYTES - this.headLength);
      this.headChunks.push(Buffer.from(take));
      this.headLength += take.length;
    }
    this.pending.push(chunk);
    this.pendingLength += chunk.length;
    while (this.pendingLength >= EVIDENCE_PART_BYTES) {
      const merged = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending);
      await this.flushPart(merged.subarray(0, EVIDENCE_PART_BYTES));
      const rest = merged.subarray(EVIDENCE_PART_BYTES);
      this.pending = rest.length ? [rest] : [];
      this.pendingLength = rest.length;
    }
  }

  private async flushPart(data: Buffer): Promise<void> {
    await this.heartbeat();
    const index = this.parts.length;
    const path = entryEvidencePartPath(this.prefix, index);
    const expectedSha = await sha256Hex(data);
    // `data` may be a view of a larger pending buffer; the storage boundary
    // serializes it (production: network write; fakes copy defensively), so
    // no extra part-sized copy is made here.
    await this.deps.storage.upload(PRIVATE_SOURCE_BUCKET, path, data, "application/octet-stream");
    // The manifest records only server-observed stored bytes: re-hash the
    // object we just wrote (bounded read) before trusting it.
    const check = await this.deps.storage.hashObject(PRIVATE_SOURCE_BUCKET, path, 4);
    if (!check || check.size !== data.length || check.sha256 !== expectedSha) {
      throw new StudioError("storage_unavailable", safeMessageFor("storage_unavailable"), true);
    }
    this.parts.push({ index, size: check.size, sha256: check.sha256 });
  }

  head(): Buffer {
    return Buffer.concat(this.headChunks);
  }

  /** Flush the tail part and seal the manifest. Call at most once. */
  async finish(): Promise<{ evidence: StudioEntryEvidence; sha256: string }> {
    if (this.pendingLength > 0) {
      const tail = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending);
      this.pending = [];
      this.pendingLength = 0;
      await this.flushPart(tail);
    }
    return {
      evidence: {
        bucket: PRIVATE_SOURCE_BUCKET,
        prefix: this.prefix,
        partSize: EVIDENCE_PART_BYTES,
        partCount: this.parts.length,
        parts: this.parts,
        totalSize: this.totalBytes,
        crc32Verified: true,
      },
      sha256: this.hash.digest("hex"),
    };
  }

  /** Best-effort removal of every part written so far (failed extraction). */
  async abort(): Promise<void> {
    const paths = this.parts.map((part) => entryEvidencePartPath(this.prefix, part.index));
    if (paths.length) {
      await this.deps.storage.remove(PRIVATE_SOURCE_BUCKET, paths).catch(() => undefined);
    }
  }
}

async function removeEvidenceParts(deps: StudioDeps, evidence: StudioEntryEvidence): Promise<void> {
  const paths = evidence.parts.map((part) => entryEvidencePartPath(evidence.prefix, part.index));
  if (paths.length) await deps.storage.remove(evidence.bucket, paths).catch(() => undefined);
}

/**
 * Private evidence for a retained entry whose (CRC-verified) bytes are
 * already in memory: chunked into the same fixed-size part objects.
 */
async function writeBufferedEvidence(
  deps: StudioDeps,
  jobId: string,
  archiveId: string,
  entryIndex: number,
  data: Buffer,
  heartbeat: () => Promise<void>,
): Promise<StudioEntryEvidence> {
  const writer = await EvidenceWriter.open(
    deps,
    entryEvidenceFolder(jobId, archiveId, entryIndex),
    heartbeat,
  );
  try {
    for (let offset = 0; offset < data.length; offset += EVIDENCE_PART_BYTES) {
      await writer.push(data.subarray(offset, Math.min(data.length, offset + EVIDENCE_PART_BYTES)));
    }
    const { evidence } = await writer.finish();
    return evidence;
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

interface StreamedEvidence {
  evidence: StudioEntryEvidence;
  sha256: string;
  head: Buffer;
  size: number;
}

/**
 * Streaming evidence lane for entries larger than the in-memory cap: the
 * entry's uncompressed bytes (STORE or DEFLATE) stream straight from bounded
 * archive-part reads into fixed-size private evidence parts. CRC-32 and the
 * exact uncompressed size are verified over the FULL stream by the ranged
 * reader; a mismatch throws after this helper removed its written parts. No
 * buffer ever approaches the entry size.
 */
async function streamEntryEvidence(
  deps: StudioDeps,
  job: StudioJobRow,
  archive: StudioArchiveRow,
  source: PartedArchiveSource,
  directory: RangedZipDirectory,
  zipEntry: RangedZipDirectory["entries"][number],
  entryIndex: number,
  heartbeat: () => Promise<void>,
): Promise<StreamedEvidence> {
  const writer = await EvidenceWriter.open(
    deps,
    entryEvidenceFolder(job.id, archive.id, entryIndex),
    heartbeat,
  );
  try {
    await streamZipEntryDataRanged(
      source,
      directory,
      zipEntry,
      { maxChunkBytes: ARCHIVE_PART_BYTES },
      (chunk) => writer.push(chunk),
    );
    const { evidence, sha256 } = await writer.finish();
    return { evidence, sha256, head: writer.head(), size: evidence.totalSize };
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

/**
 * Route ONE entry to its outcome. Every path ends in exactly one claim-checked
 * pending-only settle; a data-level failure of this entry never affects any
 * other entry.
 */
async function routeEntry(
  deps: StudioDeps,
  job: StudioJobRow,
  token: string,
  archive: StudioArchiveRow,
  source: PartedArchiveSource,
  directory: RangedZipDirectory,
  row: StudioArchiveEntryRow,
  ctx: EntryContext,
  /** Running expanded-byte total for THIS archive (durable + this slice). */
  expanded: { bytes: number },
  heartbeat: () => Promise<void>,
): Promise<void> {
  const at = deps.now();
  const settle = async (
    outcome: StudioArchiveEntryOutcome,
    publicObject?: { bucket: string; path: string },
  ) => {
    const applied = await deps.data.settleArchiveEntryIfClaimed(job.id, token, row.id, outcome);
    if (!applied) {
      // Claim lost or already settled elsewhere: our uploaded object (if any)
      // is an orphan of THIS attempt — remove it and stop the slice.
      if (publicObject) {
        await deps.storage.remove(publicObject.bucket, [publicObject.path]).catch(() => undefined);
      }
      throw new ClaimLostError();
    }
  };

  const zipEntry = directory.entries[row.entry_index];
  if (!zipEntry || zipEntry.name !== row.entry_name) {
    await settle(settledOutcome("failed", "entry_inventory_mismatch", token, at));
    return;
  }

  // The archive-wide expansion budget bounds EVERY extraction, including the
  // streaming lane: beyond it, entries stay inside the privately retained
  // original parts (truthfully recorded as not independently extracted).
  if (expanded.bytes + row.uncompressed_size > LARGE_ARCHIVE_ZIP_LIMITS.maxTotalBytes) {
    await settle(settledOutcome("retained_private", "archive_expansion_budget_reached", token, at));
    return;
  }

  // Entries above the bounded in-memory cap (large videos, big PDFs/HEIC,
  // unknown documents) take the STREAMING evidence lane: uncompressed bytes
  // stream from bounded part reads into fixed-size private evidence objects,
  // with full-stream CRC-32/size verification and a server-observed SHA-256 —
  // never a whole-entry buffer, never archive-fatal, never public.
  if (
    row.uncompressed_size > LARGE_ARCHIVE_ZIP_LIMITS.maxFileBytes ||
    row.compressed_size > LARGE_ARCHIVE_ZIP_LIMITS.maxCompressedEntryBytes
  ) {
    let streamed: StreamedEvidence;
    try {
      streamed = await streamEntryEvidence(
        deps,
        job,
        archive,
        source,
        directory,
        zipEntry,
        row.entry_index,
        heartbeat,
      );
    } catch (error) {
      if (error instanceof ZipError) {
        // One damaged entry is isolated (its partial evidence was removed);
        // everything else continues.
        await settle(settledOutcome("failed", "entry_integrity_failed", token, at));
        return;
      }
      throw error;
    }
    expanded.bytes += streamed.size;
    const streamedBase = {
      observedSize: streamed.size,
      sha256: streamed.sha256,
      mediaClass: detectMediaClass(streamed.head),
    };
    const streamedDuplicate = ctx.seenHashes.get(streamed.sha256);
    if (streamedDuplicate || ctx.existingProjectHashes.has(streamed.sha256)) {
      // The identical bytes are already durably retained elsewhere; the
      // fresh evidence copy is redundant and removed.
      await removeEvidenceParts(deps, streamed.evidence);
      ctx.seenHashes.set(streamed.sha256, row.display_label);
      await settle(
        settledOutcome(
          "skipped_duplicate",
          streamedDuplicate ? "duplicate_content_skipped" : "duplicate_of_existing_media",
          token,
          at,
          streamedBase,
        ),
      );
      return;
    }
    ctx.seenHashes.set(streamed.sha256, row.display_label);
    await settle(
      settledOutcome("retained_private", "entry_over_size_limit", token, at, {
        ...streamedBase,
        evidence: streamed.evidence,
      }),
    );
    return;
  }

  let data: Buffer;
  try {
    data = await readZipEntryDataRanged(source, directory, zipEntry, LARGE_ARCHIVE_ZIP_LIMITS);
  } catch (error) {
    if (error instanceof ZipError) {
      // One damaged entry is isolated: settled as failed, everything else
      // continues. (Set-level safety was already enforced before expansion.)
      await settle(settledOutcome("failed", "entry_integrity_failed", token, at));
      return;
    }
    throw error;
  }

  expanded.bytes += data.length;
  const digest = await sha256Hex(data);
  const head = data.subarray(0, HEAD_SNIFF_BYTES);
  const mediaClass = detectMediaClass(head);
  const base = { observedSize: data.length, sha256: digest, mediaClass };

  const duplicateOf = ctx.seenHashes.get(digest);
  if (duplicateOf) {
    await settle(settledOutcome("skipped_duplicate", "duplicate_content_skipped", token, at, base));
    return;
  }
  if (ctx.existingProjectHashes.has(digest)) {
    ctx.seenHashes.set(digest, row.display_label);
    await settle(
      settledOutcome("skipped_duplicate", "duplicate_of_existing_media", token, at, base),
    );
    return;
  }
  ctx.seenHashes.set(digest, row.display_label);

  // Every entry that settles retained_private below gets independently
  // addressable private evidence (CRC-verified bytes re-staged as fixed-size
  // private objects), written lazily exactly once. Evidence part paths are
  // deterministic per entry, so a lost-claim race can only rewrite identical
  // bytes — no orphan cleanup is needed for them.
  let bufferedEvidence: StudioEntryEvidence | null = null;
  const retainedEvidence = async (): Promise<StudioEntryEvidence> => {
    bufferedEvidence ??= await writeBufferedEvidence(
      deps,
      job.id,
      archive.id,
      row.entry_index,
      data,
      heartbeat,
    );
    return bufferedEvidence;
  };
  const settleRetained = async (
    code: string,
    extra: Partial<StudioArchiveEntryOutcome> = {},
  ): Promise<void> => {
    const evidence = await retainedEvidence();
    await settle(
      settledOutcome("retained_private", code, token, at, { ...base, evidence, ...extra }),
    );
  };

  const lowerName = row.entry_name.toLowerCase();
  const category = row.category as IntakeCategory;

  // --- Structured JSON artifacts -------------------------------------------
  if (lowerName.endsWith(".json") && data.length <= MAX_PARSE_BYTES) {
    const parsed = parseJsonBuffer(data);
    if (parsed && looksLikePriceList(parsed)) {
      if (archive.extracted?.priceList) {
        await settleRetained("price_list_duplicate_ignored");
        return;
      }
      const sanitized = sanitizePriceList(parsed as ExtractedPriceList);
      if (sanitized.priceList) {
        const adopted = await adoptExtracted(deps, job, token, archive, {
          priceList: sanitized.priceList,
          priceListSource: row.display_label,
        });
        await settleRetained(adopted ? "price_list_extracted" : "price_list_too_large_retained");
        return;
      }
      await settleRetained("price_list_unusable_retained");
      return;
    }
    if (parsed && looksLikeProjectFacts(parsed)) {
      if (!archive.extracted?.factFields) {
        const factFields = projectFieldsFromFacts(parsed as IntakeProjectFacts, row.display_label);
        const derivedName =
          typeof factFields.fields.name === "string" ? factFields.fields.name : undefined;
        await adoptExtracted(deps, job, token, archive, { factFields, derivedName });
      }
      await settleRetained("project_facts_extracted");
      return;
    }
    await settleRetained("structured_artifact_unrecognized");
    return;
  }

  // --- Price-list PDF (bounded; unavailable on the Worker → retained) ------
  if (category === "price-list" && lowerName.endsWith(".pdf") && data.length <= MAX_PARSE_BYTES) {
    const extraction = await deps.extractPriceListPdf({
      projectSlug: job.project_slug ?? job.id,
      fileName: row.display_label,
      buffer: data,
    });
    if (extraction.priceList && !archive.extracted?.priceList) {
      await adoptExtracted(deps, job, token, archive, {
        priceList: extraction.priceList,
        priceListSource: row.display_label,
      });
      await settleRetained("price_list_extracted");
      return;
    }
    await settleRetained("price_list_retained_for_extraction");
    return;
  }

  // --- Media ----------------------------------------------------------------
  const mediaType = mediaTypeForCategory(category);
  if (mediaType) {
    if (!isPublishableMediaClass(category, mediaClass)) {
      await settleRetained("media_class_mismatch");
      return;
    }
    if (ctx.publishedCount >= MAX_PUBLIC_MEDIA_PER_JOB) {
      await settleRetained("media_budget_reached");
      return;
    }
    const contentType =
      canonicalPublicContentType(row.entry_name, head, mediaClass) ?? "application/octet-stream";
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      // Video, HEIC/HEIF, PDFs and other classes have no safe public
      // sanitizer yet — truthfully retained private (with independently
      // addressable evidence), never silently dropped.
      await settleRetained("media_format_private");
      return;
    }
    const derivative = createPublicDerivative({
      bytes: data,
      originalSha256: digest,
      originalSize: data.length,
      observedContentType: contentType,
    });
    if (!derivative.eligible) {
      await settleRetained(`media_${derivative.reason}`, { mediaTruth: derivative.record });
      return;
    }
    const toBucket = publicBucketForCategory(category);
    const toPath = publicPathForDerivative(
      job.id,
      token,
      row.entry_index,
      derivative.record.derivative!.sha256,
      derivative.format,
    );
    try {
      await deps.storage.upload(toBucket, toPath, derivative.bytes, derivative.contentType);
      const check = await deps.storage.hashObject(toBucket, toPath, HEAD_SNIFF_BYTES);
      if (
        !check ||
        check.sha256 !== derivative.record.derivative!.sha256 ||
        check.size !== derivative.record.derivative!.size ||
        detectMediaClass(check.head) !== "image"
      ) {
        await deps.storage.remove(toBucket, [toPath]).catch(() => undefined);
        await settleRetained("media_verification_failed", { mediaTruth: derivative.record });
        return;
      }
    } catch {
      await deps.storage.remove(toBucket, [toPath]).catch(() => undefined);
      await settleRetained("media_publish_deferred", { mediaTruth: derivative.record });
      return;
    }
    ctx.publishedCount += 1;
    await settle(
      settledOutcome("published_public", null, token, at, {
        ...base,
        publicBucket: toBucket,
        publicPath: toPath,
        publicUrl: deps.storage.publicUrl(toBucket, toPath),
        mediaType,
        mediaTruth: derivative.record,
      }),
      { bucket: toBucket, path: toPath },
    );
    return;
  }

  // --- Everything else: truthful private retention --------------------------
  await settleRetained("retained_unrecognized");
}

// ---------------------------------------------------------------------------
// One bounded slice across the job's archives (sequential, deterministic)
// ---------------------------------------------------------------------------

/**
 * Advance the job's archive work by one bounded slice. Archives are processed
 * strictly in (created_at, id) order so multi-archive uploads never produce
 * order-dependent facts. Returns pendingWork=true when budgets ended the
 * slice early — the caller releases the claim and reports progress.
 */
export async function runArchiveSlice(
  deps: StudioDeps,
  job: StudioJobRow,
  token: string,
  heartbeat: () => Promise<void>,
): Promise<ArchiveSliceOutcome> {
  const archives = await deps.data.listJobArchives(job.id);
  if (archives.length === 0) return { pendingWork: false, archiveCount: 0 };

  const budget: SliceBudget = { entries: 0, expandedBytes: 0, verifiedParts: 0 };

  // Durable dedup context: digests settled by earlier slices, digests of the
  // target project's existing public media (multi-session enrichment).
  const settled = await deps.data.listJobArchiveEntries(job.id, [
    "published_public",
    "retained_private",
    "failed",
  ]);
  const seenHashes = new Map<string, string>();
  let publishedCount = 0;
  for (const entry of settled) {
    if (entry.sha256) seenHashes.set(entry.sha256, entry.display_label);
    if (entry.state === "published_public") publishedCount += 1;
  }
  const existingProjectHashes = new Set<string>();
  if (job.project_slug) {
    const existing = await deps.fetchExisting(job.project_slug).catch(() => undefined);
    for (const item of Object.values(existing?.media ?? {})) {
      const metadata = (item.values as { metadata?: Record<string, unknown> }).metadata;
      const truth = (metadata?.studio as { media_truth?: { original?: { sha256?: string } } })
        ?.media_truth;
      const sha = truth?.original?.sha256;
      if (typeof sha === "string" && SHA256_HEX.test(sha)) existingProjectHashes.add(sha);
    }
  }
  const ctx: EntryContext = { publishedCount, seenHashes, existingProjectHashes };

  for (const archive of archives) {
    if (archive.status === "rejected" || archive.status === "completed") continue;
    await heartbeat();

    if (archive.status === "planned") {
      // Processing was explicitly requested while this archive never finished
      // uploading: its parts stay privately retained; nothing expands.
      await updateArchiveClaimedOrThrow(deps, job.id, token, archive.id, {
        status: "rejected",
        error_code: "archive_upload_incomplete",
      });
      continue;
    }

    if (archive.status === "uploaded_unverified" || archive.status === "byte_verifying") {
      const verified = await verifyArchiveParts(deps, job, token, archive, budget, heartbeat);
      if (!verified) {
        const current = await deps.data.getArchive(archive.id);
        if (current?.status === "rejected") continue;
        return { pendingWork: true, archiveCount: archives.length };
      }
    }

    const size = archive.observed_size ?? archive.declared_size;
    const source = new PartedArchiveSource(deps, job.id, archive, size);

    let directory: RangedZipDirectory | null = null;
    if (archive.status === "byte_verified") {
      // The exact whole-archive SHA-256 was recorded atomically WITH the
      // byte_verified transition (the database lifecycle guard enforces it);
      // this slice only has to persist the entry inventory.
      directory = await indexArchive(deps, job, token, archive, source);
      if (!directory) continue; // rejected fail-closed
    }

    if (archive.status === "processing_entries") {
      const pending = await deps.data.listArchiveEntries(archive.id, ["pending"]);
      if (pending.length > 0 && !directory) {
        directory = await readZipDirectoryRanged(source, LARGE_ARCHIVE_ZIP_LIMITS, VIRTUAL_DEST);
      }
      // Durable per-archive expansion total (aggregate budget over retries).
      const expanded = {
        bytes: settled
          .filter((entry) => entry.archive_id === archive.id)
          .reduce((sum, entry) => sum + (entry.observed_size ?? 0), 0),
      };
      for (const row of pending) {
        if (budgetExhausted(budget)) return { pendingWork: true, archiveCount: archives.length };
        if (
          budget.entries > 0 &&
          budget.expandedBytes + row.uncompressed_size > SLICE_MAX_EXPANDED_BYTES
        ) {
          return { pendingWork: true, archiveCount: archives.length };
        }
        await heartbeat();
        await routeEntry(
          deps,
          job,
          token,
          archive,
          source,
          directory!,
          row,
          ctx,
          expanded,
          heartbeat,
        );
        budget.entries += 1;
        budget.expandedBytes += row.uncompressed_size;
      }
      await updateArchiveClaimedOrThrow(deps, job.id, token, archive.id, { status: "completed" });
      archive.status = "completed";
    }
  }
  return { pendingWork: false, archiveCount: archives.length };
}

// ---------------------------------------------------------------------------
// Compose: durable outcomes → publishable materials (deterministic)
// ---------------------------------------------------------------------------

export interface ComposedArchiveMaterials {
  media: ProgressiveMediaItem[];
  photoUrls: string[];
  firstPhotoUrl: string | null;
  firstBrochureUrl: string | null;
  priceList: ExtractedPriceList | null;
  priceListSource: string | null;
  factFields: ExtractedFactFields | null;
  derivedName: string | null;
  warnings: ProgressiveWarning[];
  /** Digest → label of every settled entry (seeds ordinary-file dedup). */
  settledHashes: Map<string, string>;
  /** Every public object referenced by durable entry rows (sweep keep-set). */
  referencedPublicObjects: Array<{ bucket: string; path: string }>;
}

const OUTCOME_WARNING_TEXT: Record<string, string> = {
  media_format_private:
    "archive item(s) use formats (video, HEIC, PDF or similar) Forever cannot publish safely yet; they remain private.",
  media_class_mismatch:
    "archive item(s) did not match their declared media type and remain private.",
  media_budget_reached:
    "archive item(s) exceeded the public media budget for one upload and remain private.",
  media_over_limit: "archive item(s) exceed the public-media transformation limit; kept private.",
  media_unsupported_format:
    "archive item(s) use image variants Forever cannot sanitize yet; kept private.",
  media_color_profile_unsupported:
    "archive item(s) carry embedded color profiles Forever cannot re-render safely yet; kept private.",
  media_malformed_media: "archive item(s) could not be decoded safely and remain private.",
  media_source_changed: "archive item(s) changed between verification steps and remain private.",
  media_verification_failed: "archive item(s) failed final public verification and remain private.",
  media_publish_deferred:
    "archive item(s) could not be published to the gallery just now; they remain private.",
  duplicate_content_skipped: "duplicate archive item(s) were skipped deterministically.",
  duplicate_of_existing_media:
    "archive item(s) matched media this project already has and were skipped.",
  entry_integrity_failed:
    "archive item(s) failed integrity verification and were isolated; everything else processed.",
  entry_inventory_mismatch:
    "archive item(s) no longer matched the recorded inventory and were isolated.",
  structured_artifact_unrecognized:
    "JSON archive item(s) matched no supported structured artifact; retained for review.",
  price_list_retained_for_extraction:
    "price-list document(s) were retained privately for later extraction.",
  price_list_duplicate_ignored:
    "additional price list(s) were retained but not applied (one price list per upload).",
  price_list_too_large_retained: "price-list artifact(s) were too large to adopt; retained.",
  price_list_unusable_retained: "price-list artifact(s) had no safely usable rows; retained.",
  retained_unrecognized: "archive item(s) were retained privately as source evidence.",
  entry_over_size_limit:
    "archive item(s) exceed the public processing limit; each was extracted into independently retrievable private evidence and remains private.",
  archive_expansion_budget_reached:
    "archive item(s) beyond the expansion budget remain inside the privately retained archive (not independently extracted).",
};

const ARCHIVE_ERROR_TEXT: Record<string, string> = {
  archive_rejected_unsafe:
    "was rejected by archive safety checks; it was retained privately and did not block the rest of the upload.",
  archive_part_integrity_failed:
    "failed stored-byte verification and was retained privately without being expanded.",
  archive_format_unsupported: "is not a ZIP archive; it was retained privately unexpanded.",
  archive_upload_incomplete:
    "never finished uploading; its received parts remain private and nothing was expanded.",
};

/** Deterministic merge of every durable archive outcome for final publish. */
export async function composeArchiveMaterials(
  deps: StudioDeps,
  job: StudioJobRow,
  sortOrderBase: number,
): Promise<ComposedArchiveMaterials> {
  const archives = await deps.data.listJobArchives(job.id);
  const warnings: ProgressiveWarning[] = [];
  const media: ProgressiveMediaItem[] = [];
  const photoUrls: string[] = [];
  const referencedPublicObjects: Array<{ bucket: string; path: string }> = [];
  const settledHashes = new Map<string, string>();
  let firstPhotoUrl: string | null = null;
  let firstBrochureUrl: string | null = null;
  let priceList: ExtractedPriceList | null = null;
  let priceListSource: string | null = null;
  let factFields: ExtractedFactFields | null = null;
  let derivedName: string | null = null;

  const archiveOrdinal = new Map<string, number>();
  archives.forEach((archive, index) => archiveOrdinal.set(archive.id, index));

  for (const archive of archives) {
    const label = archiveLabel(archiveOrdinal.get(archive.id) ?? 0);
    if (archive.status === "rejected") {
      warnings.push(
        neutralWarning(
          archive.error_code ?? "archive_rejected_unsafe",
          `${label} ${ARCHIVE_ERROR_TEXT[archive.error_code ?? ""] ?? ARCHIVE_ERROR_TEXT.archive_rejected_unsafe}`,
        ),
      );
      continue;
    }
    // Artifact adoption in strict archive order: first adopted wins.
    const extracted = archive.extracted;
    if (extracted?.priceList && !priceList) {
      priceList = extracted.priceList as ExtractedPriceList;
      priceListSource = `${label} ${extracted.priceListSource ?? ""}`.trim();
    } else if (extracted?.priceList && priceList) {
      warnings.push(
        neutralWarning(
          "price_list_duplicate_ignored",
          `${label} contained an additional price list; it was retained but not applied.`,
        ),
      );
    }
    if (extracted?.factFields && !factFields) {
      factFields = extracted.factFields as ExtractedFactFields;
    }
    if (extracted?.derivedName && !derivedName) derivedName = extracted.derivedName;
  }

  const entries = await deps.data.listJobArchiveEntries(job.id);
  entries.sort((left, right) => {
    const archiveDelta =
      (archiveOrdinal.get(left.archive_id) ?? 0) - (archiveOrdinal.get(right.archive_id) ?? 0);
    return archiveDelta !== 0 ? archiveDelta : left.entry_index - right.entry_index;
  });

  const outcomeCounts = new Map<string, number>();
  let sortOrder = sortOrderBase;
  const categoryOrdinals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.sha256) settledHashes.set(entry.sha256, entry.display_label);
    if (entry.state === "pending") continue;
    if (entry.state === "published_public") {
      if (!entry.public_url || !entry.public_bucket || !entry.public_path || !entry.media_type) {
        continue;
      }
      referencedPublicObjects.push({ bucket: entry.public_bucket, path: entry.public_path });
      const category = entry.category as IntakeCategory;
      const ordinal = (categoryOrdinals.get(entry.category) ?? 0) + 1;
      categoryOrdinals.set(entry.category, ordinal);
      const title = `${NEUTRAL_MEDIA_TITLE[category] ?? "Project media"} ${ordinal}`;
      media.push({
        media_type: entry.media_type,
        url: entry.public_url,
        title,
        sort_order: sortOrder,
        metadata: {
          studio: {
            job_id: job.id,
            category: entry.category,
            // Claims-stripped projection ONLY — the full record with GPS and
            // device claims stays on the private entry row.
            ...(entry.media_truth
              ? { media_truth: publicMediaTruthProjection(entry.media_truth) }
              : {}),
          },
        },
      });
      sortOrder += 1;
      if (category === "photo") {
        photoUrls.push(entry.public_url);
        if (!firstPhotoUrl) firstPhotoUrl = entry.public_url;
      }
      if (category === "brochure" && !firstBrochureUrl) firstBrochureUrl = entry.public_url;
      continue;
    }
    if (
      entry.outcome_code &&
      entry.outcome_code !== "price_list_extracted" &&
      entry.outcome_code !== "project_facts_extracted"
    ) {
      outcomeCounts.set(entry.outcome_code, (outcomeCounts.get(entry.outcome_code) ?? 0) + 1);
    }
  }

  // Aggregate outcome warnings: one truthful line per outcome family instead
  // of hundreds of per-entry lines.
  for (const [code, count] of outcomeCounts) {
    const text = OUTCOME_WARNING_TEXT[code] ?? "archive item(s) were retained privately.";
    warnings.push(neutralWarning(code, `${count} ${text}`));
  }

  return {
    media,
    photoUrls,
    firstPhotoUrl,
    firstBrochureUrl,
    priceList,
    priceListSource,
    factFields,
    derivedName,
    warnings,
    settledHashes,
    referencedPublicObjects,
  };
}

// ---------------------------------------------------------------------------
// Progress projection (public-safe)
// ---------------------------------------------------------------------------

export async function buildJobProgress(
  deps: StudioDeps,
  job: StudioJobRow,
): Promise<StudioJobProgress> {
  const archives = await deps.data.listJobArchives(job.id);
  const entries = await deps.data.listJobArchiveEntries(job.id);
  const byArchive = new Map<string, StudioArchiveEntryRow[]>();
  for (const entry of entries) {
    const list = byArchive.get(entry.archive_id) ?? [];
    list.push(entry);
    byArchive.set(entry.archive_id, list);
  }

  const progressArchives: StudioArchiveProgress[] = archives.map((archive, index) => {
    const archiveEntries = byArchive.get(archive.id) ?? [];
    const count = (state: string) => archiveEntries.filter((e) => e.state === state).length;
    return {
      archiveId: archive.id,
      label: archiveLabel(index),
      status: archive.status,
      partCount: archive.part_count,
      uploadedParts: archive.parts.filter((part) => part.size != null).length,
      verifiedParts: archive.parts.filter((part) => part.verified).length,
      entryCount: archive.entry_count,
      entriesProcessed: archiveEntries.length - count("pending"),
      entriesPublished: count("published_public"),
      entriesRetained: count("retained_private"),
      entriesSkipped: count("skipped_duplicate"),
      entriesFailed: count("failed"),
      warningCode: archive.error_code,
    };
  });

  const total = (state: string) => entries.filter((e) => e.state === state).length;
  const pending = total("pending");
  return {
    jobId: job.id,
    status: job.status,
    archives: progressArchives,
    discovered: entries.length,
    processed: entries.length - pending,
    published: total("published_public"),
    retained: total("retained_private"),
    skippedDuplicates: total("skipped_duplicate"),
    failed: total("failed"),
    pending,
    warnings: [],
  };
}
