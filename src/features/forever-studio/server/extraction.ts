/**
 * Forever Studio — private staging, byte verification, and media selection
 * (items 4 & 5).
 *
 * EVERY incoming file lands in the private `studio-uploads` bucket. During
 * processing Studio verifies the ACTUAL stored bytes of every uploaded file —
 * exact streamed byte count, full SHA-256, magic-byte media class, and
 * declared-vs-observed mismatches — regardless of size: large photos and
 * videos are streamed through the hash, never buffered whole. Only media
 * whose supported formats pass bounded sanitization and verification are uploaded to public buckets, on
 * processing-token-scoped immutable paths, so a stale worker can never
 * overwrite or delete a newer claim's public objects. Raw PDFs, ZIPs, price
 * lists, legal files, and unselected or unrecognized media never leave the
 * private bucket.
 *
 * A failure of any single file is a warning plus private retention, never a
 * job failure: incomplete or partially readable materials still publish
 * whatever is safely usable.
 */

import type {
  ProgressiveMediaItem,
  ProgressiveWarning,
} from "@/features/forever-ingestion/batch-types";
import type { FieldProvenanceMap } from "@/features/forever-ingestion/provenance";
import type { CurrencyEvidence } from "@/import/currency-policy";
import type { ExtractedPriceList } from "@/import/types";
import { classifyPath } from "@/intake/classify";
import { isUsableCountry, sanitizePriceList, usableIntakeFact } from "@/intake/sanitize";
import type { IntakeCategory, IntakeProjectFacts } from "@/intake/types";

import type { StudioJobFile } from "../studio-types";
import type { StudioDeps, StudioJobRow } from "./contracts";
import { createPublicDerivative, MAX_MEDIA_SANITIZE_BYTES } from "./media-truth";

// ---------------------------------------------------------------------------
// Buckets and limits
// ---------------------------------------------------------------------------

export const PUBLIC_IMAGE_BUCKET = "project-images";
export const PUBLIC_DOCUMENT_BUCKET = "project-documents";
export const PRIVATE_SOURCE_BUCKET = "studio-uploads";

/** Hard upload ceiling (declared + observed). */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GiB
/** Max bytes we will pull into memory to parse a JSON/PDF business file. */
export const MAX_PARSE_BYTES = 20 * 1024 * 1024; // 20 MiB
/** Max archive we will download and expand (entry-by-entry) on the server. */
// Complete ZIP validation needs the archive buffer in memory before expansion.
export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024; // 16 MiB
/** Leading bytes captured while streaming, for magic-byte class detection. */
export const HEAD_SNIFF_BYTES = 4096;

const DOCUMENT_MEDIA_CATEGORIES: Partial<Record<IntakeCategory, string>> = {
  brochure: "brochure",
  "master-plan": "master_plan",
  "floor-plan": "floor_plan",
  "unit-plan": "unit_plan",
  "payment-plan": "payment_plan",
  "map-location": "document",
  "furniture-package": "document",
};

/** Public bucket a selected derivative is uploaded into. */
export function publicBucketForCategory(category: IntakeCategory): string {
  if (category === "photo" || category === "video") return PUBLIC_IMAGE_BUCKET;
  return PUBLIC_DOCUMENT_BUCKET;
}

/** project_media.media_type for a public file; null keeps a file private. */
export function mediaTypeForCategory(category: IntakeCategory): string | null {
  if (category === "photo") return "gallery";
  if (category === "video") return "video";
  return DOCUMENT_MEDIA_CATEGORIES[category] ?? null;
}

export function classifyFileName(name: string): IntakeCategory {
  return classifyPath(name).category;
}

/** Storage-safe object name: never trust a client-chosen path. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return clean || "file";
}

export function prettyTitleFromFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? name).replace(/\.[a-z0-9]+$/i, "");
  const spaced = base
    .replace(/[-_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return spaced || name;
}

export function stagingPathForJobFile(jobId: string, index: number, name: string): string {
  return `jobs/${jobId}/staging/${String(index).padStart(2, "0")}-${sanitizeFileName(name)}`;
}

/**
 * Attempt discriminator derived from the processing-claim token. Public and
 * re-staged paths embed it so concurrent attempts never share object paths:
 * a stale worker writes/deletes only under its OWN prefix.
 */
export function attemptPrefixFromToken(token: string): string {
  const clean = token.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return clean || "attempt";
}

/** Job-scoped public prefix (all attempts of one job live under it). */
export function publicJobPrefix(jobId: string): string {
  return `studio/${jobId}`;
}

function publicPathForMedia(jobId: string, token: string, index: number, name: string): string {
  return `${publicJobPrefix(jobId)}/${attemptPrefixFromToken(token)}/${String(index).padStart(2, "0")}-${sanitizeFileName(name)}`;
}

/** Declare every file into the PRIVATE staging bucket. */
export function declareJobFiles(
  jobId: string,
  files: Array<{ name: string; size?: number; contentType?: string }>,
): StudioJobFile[] {
  return files.map((file, index) => ({
    name: file.name,
    stagingBucket: PRIVATE_SOURCE_BUCKET,
    stagingPath: stagingPathForJobFile(jobId, index, file.name),
    declaredSize: file.size ?? null,
    declaredType: file.contentType ?? null,
    category: classifyFileName(file.name),
    status: "declared" as const,
  }));
}

// ---------------------------------------------------------------------------
// Byte-level media class detection (magic bytes)
// ---------------------------------------------------------------------------

export type MediaClass = "image" | "video" | "pdf" | "zip" | "json" | "other";

/**
 * ISO BMFF (`ftyp`) brands that are deterministically an IMAGE container:
 * HEIC/HEIF (phone photos) and AVIF.
 */
const FTYP_IMAGE_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);

/**
 * ISO BMFF brands that are deterministically a VIDEO container: MP4 family,
 * QuickTime MOV, M4V, 3GPP. A generic/unknown `ftyp` brand is NOT assumed to
 * be video — it stays `other` and is retained privately.
 */
const FTYP_VIDEO_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "mp4v",
  "avc1",
  "dash",
  "M4V ",
  "M4VP",
  "qt  ",
  "3gp4",
  "3gp5",
  "3gp6",
  "3gg6",
]);

/** Classify an `ftyp` box by its major brand, then its compatible brands. */
function classifyFtyp(head: Buffer): MediaClass {
  const boxSize = head.readUInt32BE(0);
  const brandOf = (offset: number): string | null =>
    offset + 4 <= head.length ? head.subarray(offset, offset + 4).toString("latin1") : null;
  const major = brandOf(8);
  if (major && FTYP_IMAGE_BRANDS.has(major)) return "image";
  if (major && FTYP_VIDEO_BRANDS.has(major)) return "video";
  // Compatible brands start at offset 16 and run to the end of the ftyp box.
  const end = Math.min(head.length, boxSize >= 16 ? boxSize : 16);
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    const brand = brandOf(offset);
    if (brand && FTYP_IMAGE_BRANDS.has(brand)) return "image";
  }
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    const brand = brandOf(offset);
    if (brand && FTYP_VIDEO_BRANDS.has(brand)) return "video";
  }
  // An unrecognized ftyp container is NOT publishable media.
  return "other";
}

export function detectMediaClass(head: Buffer): MediaClass {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image";
  if (
    head.length >= 8 &&
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image";
  if (
    head.length >= 6 &&
    (head.subarray(0, 6).toString("ascii") === "GIF87a" ||
      head.subarray(0, 6).toString("ascii") === "GIF89a")
  )
    return "image";
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString("ascii") === "RIFF" &&
    head.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image";
  if (head.length >= 5 && head.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (
    head.length >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)
  )
    return "zip";
  if (head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp") {
    return classifyFtyp(head);
  }
  if (head.length >= 4 && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
    return "video";
  const text = head
    .subarray(0, Math.min(head.length, 64))
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (text.startsWith("{") || text.startsWith("[")) return "json";
  return "other";
}

/** Canonical public Content-Type derived only from verified bytes. */
export function canonicalPublicContentType(
  name: string,
  head: Buffer,
  observed: MediaClass,
): string | null {
  if (observed === "pdf") return "application/pdf";
  if (observed === "image") {
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
      return "image/jpeg";
    if (
      head.length >= 8 &&
      head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      return "image/png";
    if (head.length >= 6 && head.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
    if (
      head.length >= 12 &&
      head.subarray(0, 4).toString("ascii") === "RIFF" &&
      head.subarray(8, 12).toString("ascii") === "WEBP"
    )
      return "image/webp";
    if (head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp") {
      const brands: string[] = [];
      const boxEnd = Math.min(head.length, Math.max(16, head.readUInt32BE(0)));
      for (let offset = 8; offset + 4 <= boxEnd; offset += offset === 8 ? 8 : 4) {
        brands.push(head.subarray(offset, offset + 4).toString("latin1"));
      }
      if (brands.some((brand) => brand === "avif" || brand === "avis")) return "image/avif";
      if (brands.some((brand) => brand === "mif1" || brand === "msf1")) return "image/heif";
      return "image/heic";
    }
  }
  if (observed === "video") {
    if (head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp") {
      const boxEnd = Math.min(head.length, Math.max(16, head.readUInt32BE(0)));
      for (let offset = 8; offset + 4 <= boxEnd; offset += offset === 8 ? 8 : 4) {
        if (head.subarray(offset, offset + 4).toString("latin1") === "qt  ") {
          return "video/quicktime";
        }
      }
      return "video/mp4";
    }
    const extension = (name.split(".").pop() ?? "").toLowerCase();
    return extension === "webm" ? "video/webm" : "video/x-matroska";
  }
  return null;
}

/** The media class the file NAME claims — recorded, never trusted. */
export function classFromExtension(name: string): MediaClass {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (
    ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff"].includes(
      ext,
    )
  )
    return "image";
  if (["mp4", "mov", "webm", "mkv", "avi", "m4v"].includes(ext)) return "video";
  if (ext === "pdf") return "pdf";
  if (ext === "zip") return "zip";
  if (ext === "json") return "json";
  return "other";
}

async function sha256Of(buffer: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buffer).digest("hex");
}

// ---------------------------------------------------------------------------
// Structured JSON detection (Fast Intake artifact shapes, consumed verbatim)
// ---------------------------------------------------------------------------

function parseJsonBuffer(buffer: Buffer): unknown | null {
  try {
    return JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

export function looksLikePriceList(value: unknown): value is ExtractedPriceList {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { unit_inventory?: unknown }).unit_inventory)
  );
}

const FACT_KEYS: ReadonlyArray<keyof IntakeProjectFacts> = [
  "name",
  "developer",
  "location",
  "location_area",
  "country",
  "project_type",
  "short_description",
  "full_description",
];

export function looksLikeProjectFacts(value: unknown): value is IntakeProjectFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return FACT_KEYS.some((key) => {
    const fact = record[key as string];
    return !!fact && typeof fact === "object" && "value" in (fact as Record<string, unknown>);
  });
}

export interface ExtractedFactFields {
  fields: Record<string, string>;
  provenance: FieldProvenanceMap;
  countryEvidence?: CurrencyEvidence;
}

/** Anti-fabrication: only source-backed usable facts become fields. */
export function projectFieldsFromFacts(
  facts: IntakeProjectFacts,
  sourceRef: string,
): ExtractedFactFields {
  const fields: Record<string, string> = {};
  const provenance: FieldProvenanceMap = {};
  const mapping: ReadonlyArray<[keyof IntakeProjectFacts, string]> = [
    ["name", "name"],
    ["developer", "developer_name_raw"],
    ["location", "location_name_raw"],
    ["location_area", "location_area"],
    ["project_type", "project_type"],
    ["short_description", "short_description"],
    ["full_description", "full_description"],
  ];
  for (const [factKey, column] of mapping) {
    const fact = usableIntakeFact(facts[factKey]);
    if (!fact || typeof fact.value !== "string" || !fact.value.trim()) continue;
    fields[column] = fact.value.trim();
    provenance[column] = {
      status: "extracted",
      source_ref: fact.source_file ?? sourceRef,
      ...(fact.source_date ? { source_date: fact.source_date } : {}),
    };
  }

  let countryEvidence: CurrencyEvidence | undefined;
  const countryFact = usableIntakeFact(facts.country);
  if (countryFact && isUsableCountry(countryFact.value)) {
    countryEvidence = {
      value: String(countryFact.value),
      status: "source_verified",
      confidence:
        countryFact.confidence === "medium" || countryFact.confidence === "low"
          ? countryFact.confidence
          : "high",
      sourceFile: countryFact.source_file ?? sourceRef,
      context: "source-verified project country",
    };
  }

  return { fields, provenance, countryEvidence };
}

// ---------------------------------------------------------------------------
// Job material gathering
// ---------------------------------------------------------------------------

export interface GatheredMaterials {
  priceList: ExtractedPriceList | null;
  priceListSource: string | null;
  factFields: ExtractedFactFields | null;
  media: ProgressiveMediaItem[];
  firstPhotoUrl: string | null;
  firstBrochureUrl: string | null;
  photoUrls: string[];
  warnings: ProgressiveWarning[];
  files: StudioJobFile[];
  /**
   * Public derivatives uploaded by THIS attempt (token-scoped paths, possibly in
   * different buckets) — removed, grouped by bucket, if this attempt loses.
   */
  publicObjects: Array<{ bucket: string; path: string }>;
  /** True when a title/name could be derived from an uploaded business file. */
  derivedName: string | null;
}

/** Options for one processing attempt. */
export interface GatherOptions {
  /** The processing-claim token; scopes every side-effect path. */
  token: string;
  /** Lease heartbeat, awaited between files/entries; throws to abort. */
  heartbeat?: () => Promise<void>;
}

function fileWarning(code: string, name: string, message: string): ProgressiveWarning {
  // ZIP entry names and legacy browser names can contain local paths. Warnings
  // cross the browser boundary, so they receive only a normalized basename.
  const safeName = sanitizeFileName(name);
  return {
    entity: "document",
    code,
    severity: "warning",
    message: message.split(name).join(safeName),
    payload: { file: safeName },
  };
}

interface MediaCandidate {
  category: IntakeCategory;
  name: string;
  contentType: string;
  originalSha256: string;
  originalSize: number;
  fileRecord?: StudioJobFile;
  archiveEntryName?: string;
  /** Private source location used to derive public bytes. */
  from: { bucket: string; path: string };
}

function retentionWarning(
  candidate: MediaCandidate,
  reason:
    | "unsupported_format"
    | "over_limit"
    | "source_changed"
    | "malformed_media"
    | "verification_failed"
    | "read_failed",
): ProgressiveWarning {
  if (reason === "over_limit") {
    return fileWarning(
      "media_sanitization_limit",
      candidate.name,
      `${candidate.name} exceeds the bounded public-media transformation limit and remains private.`,
    );
  }
  if (reason === "unsupported_format") {
    return fileWarning(
      "media_sanitization_unsupported",
      candidate.name,
      `${candidate.name} uses a format that Forever cannot safely sanitize for public delivery yet; it remains private.`,
    );
  }
  return fileWarning(
    "media_sanitization_failed",
    candidate.name,
    `${candidate.name} could not be safely sanitized and verified for public delivery; it remains private.`,
  );
}

/**
 * Verify, interpret, and select one job's staged files. Missing files
 * (declared but never uploaded) and oversized/unreadable files become
 * warnings and stay privately retained; supported media become verified derivatives in public
 * token-scoped immutable paths and recorded only here.
 */
export async function gatherMaterials(
  deps: StudioDeps,
  job: StudioJobRow,
  options: GatherOptions,
): Promise<GatheredMaterials> {
  const warnings: ProgressiveWarning[] = [];
  const files: StudioJobFile[] = job.files.map((file) => ({ ...file }));
  const mediaCandidates: MediaCandidate[] = [];
  const seenHashes = new Map<string, string>();
  let priceList: ExtractedPriceList | null = null;
  let priceListSource: string | null = null;
  let factFields: ExtractedFactFields | null = null;
  let derivedName: string | null = null;
  let zipStageIndex = 0;
  const attempt = attemptPrefixFromToken(options.token);

  const adoptPriceList = (candidate: ExtractedPriceList, sourceName: string) => {
    if (priceList) {
      warnings.push(
        fileWarning(
          "price_list_duplicate_ignored",
          sourceName,
          `A price list was already provided; ${sourceName} was retained but not applied.`,
        ),
      );
      return;
    }
    const sanitized = sanitizePriceList(candidate);
    warnings.push(...sanitized.warnings);
    if (sanitized.priceList) {
      priceList = sanitized.priceList;
      priceListSource = sourceName;
    }
  };

  const adoptFacts = (parsed: IntakeProjectFacts, sourceName: string) => {
    if (!factFields) factFields = projectFieldsFromFacts(parsed, sourceName);
    if (!derivedName && typeof factFields.fields.name === "string")
      derivedName = factFields.fields.name;
  };

  /** Shared per-entry routing for expanded archive entries. */
  const handleArchiveEntry = async (
    containerName: string,
    entry: { name: string; data: Buffer },
  ): Promise<void> => {
    await options.heartbeat?.();
    const category = classifyFileName(entry.name);
    if (entry.name.toLowerCase().endsWith(".json")) {
      const parsed = parseJsonBuffer(entry.data);
      if (parsed && looksLikePriceList(parsed)) {
        adoptPriceList(parsed, entry.name);
        return;
      }
      if (parsed && looksLikeProjectFacts(parsed)) {
        adoptFacts(parsed, entry.name);
        return;
      }
    }
    if (category === "price-list" && entry.name.toLowerCase().endsWith(".pdf")) {
      const extraction = await deps.extractPriceListPdf({
        projectSlug: job.project_slug ?? job.id,
        fileName: entry.name,
        buffer: entry.data,
      });
      warnings.push(...extraction.warnings);
      if (extraction.priceList) adoptPriceList(extraction.priceList, entry.name);
      return;
    }
    if (mediaTypeForCategory(category)) {
      const mediaClass = detectMediaClass(entry.data.subarray(0, HEAD_SNIFF_BYTES));
      if (!isPublishableMediaClass(category, mediaClass)) {
        warnings.push(
          fileWarning(
            "media_class_mismatch",
            entry.name,
            `${entry.name} inside ${containerName} is not a valid ${category}; retained privately.`,
          ),
        );
        return;
      }
      const hash = await sha256Of(entry.data);
      const dup = seenHashes.get(hash);
      if (dup) {
        warnings.push(
          fileWarning(
            "duplicate_media_ignored",
            entry.name,
            `${entry.name} is byte-identical to ${dup}; the duplicate was skipped.`,
          ),
        );
        return;
      }
      seenHashes.set(hash, entry.name);
      // Re-stage the entry privately (attempt-scoped), then treat it as media.
      const stagedPath = `jobs/${job.id}/zip/${attempt}/${String(zipStageIndex).padStart(2, "0")}-${sanitizeFileName(entry.name)}`;
      zipStageIndex += 1;
      await deps.storage.upload(PRIVATE_SOURCE_BUCKET, stagedPath, entry.data);
      mediaCandidates.push({
        category,
        name: entry.name,
        originalSha256: hash,
        originalSize: entry.data.length,
        fileRecord: files.find((file) => file.name === containerName),
        archiveEntryName: entry.name,
        contentType:
          canonicalPublicContentType(
            entry.name,
            entry.data.subarray(0, HEAD_SNIFF_BYTES),
            mediaClass,
          ) ?? "application/octet-stream",
        from: { bucket: PRIVATE_SOURCE_BUCKET, path: stagedPath },
      });
    }
  };

  for (const file of files) {
    await options.heartbeat?.();
    const stat = await deps.storage.statObject(file.stagingBucket, file.stagingPath);
    if (!stat) {
      file.status = "missing";
      warnings.push(
        fileWarning(
          "file_upload_missing",
          file.name,
          `${file.name} was declared but never arrived in storage; continuing without it.`,
        ),
      );
      continue;
    }
    file.status = "uploaded";
    if (stat.size > MAX_UPLOAD_BYTES) {
      // Never streamed, never published; the byte cap is a hard ceiling.
      file.observedSize = stat.size;
      file.mediaClass = null;
      file.status = "oversized";
      warnings.push(
        fileWarning(
          "file_oversized",
          file.name,
          `${file.name} exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit; it was retained privately and skipped.`,
        ),
      );
      continue;
    }

    // EVERY stored object is streamed once: full SHA-256, exact byte count,
    // and magic-byte class from the ACTUAL bytes — for large media too.
    const digest = await deps.storage.hashObject(
      file.stagingBucket,
      file.stagingPath,
      HEAD_SNIFF_BYTES,
    );
    if (!digest) {
      file.status = "unreadable";
      warnings.push(
        fileWarning("file_unreadable", file.name, `${file.name} could not be read back.`),
      );
      continue;
    }
    file.observedSize = digest.size;
    file.sha256 = digest.sha256;
    const observedClass = detectMediaClass(digest.head);
    file.mediaClass = observedClass;
    const declaredClass = classFromExtension(file.name);
    if (file.declaredSize != null && file.declaredSize !== digest.size) {
      file.declaredMismatch = true;
      warnings.push(
        fileWarning(
          "file_declared_size_mismatch",
          file.name,
          `${file.name} declared ${file.declaredSize} bytes but ${digest.size} bytes were stored; the stored bytes are authoritative.`,
        ),
      );
    }
    if (declaredClass !== "other" && declaredClass !== observedClass) {
      file.declaredMismatch = true;
    }

    const lower = file.name.toLowerCase();
    const isJson = lower.endsWith(".json");
    const isPdf = lower.endsWith(".pdf");
    const isArchive = file.category === "archive";
    const isMedia = mediaTypeForCategory(file.category as IntakeCategory) !== null;

    // --- Structured JSON (bounded parse) -----------------------------------
    if (isJson) {
      if (digest.size > MAX_PARSE_BYTES) {
        warnings.push(
          fileWarning(
            "file_too_large_to_parse",
            file.name,
            `${file.name} is too large to parse safely; it was retained privately.`,
          ),
        );
        continue;
      }
      const buffer = await deps.storage.downloadWithin(
        file.stagingBucket,
        file.stagingPath,
        MAX_PARSE_BYTES,
      );
      const parsed = buffer ? parseJsonBuffer(buffer) : null;
      if (!parsed) {
        file.status = "unreadable";
        warnings.push(
          fileWarning(
            "file_unreadable",
            file.name,
            `${file.name} could not be parsed as JSON; the file was retained for later review.`,
          ),
        );
        continue;
      }
      if (looksLikePriceList(parsed)) {
        adoptPriceList(parsed, file.name);
        continue;
      }
      if (looksLikeProjectFacts(parsed)) {
        adoptFacts(parsed, file.name);
        continue;
      }
      warnings.push(
        fileWarning(
          "structured_artifact_unrecognized",
          file.name,
          `${file.name} is JSON but matches no supported structured artifact; retained.`,
        ),
      );
      continue;
    }

    // --- Price-list PDF (bounded parse; SIP best-effort) -------------------
    if (file.category === "price-list" && isPdf) {
      if (digest.size > MAX_PARSE_BYTES) {
        warnings.push(
          fileWarning(
            "file_too_large_to_parse",
            file.name,
            `${file.name} is too large to parse on the server; it was retained privately for later extraction.`,
          ),
        );
        continue;
      }
      const buffer = await deps.storage.downloadWithin(
        file.stagingBucket,
        file.stagingPath,
        MAX_PARSE_BYTES,
      );
      if (!buffer) {
        file.status = "unreadable";
        warnings.push(
          fileWarning("file_unreadable", file.name, `${file.name} could not be read back.`),
        );
        continue;
      }
      const extraction = await deps.extractPriceListPdf({
        projectSlug: job.project_slug ?? job.id,
        fileName: file.name,
        buffer,
      });
      warnings.push(...extraction.warnings);
      if (extraction.priceList) adoptPriceList(extraction.priceList, file.name);
      continue;
    }

    // --- Archive (bounded download + full-contract per-entry expansion) ----
    if (isArchive) {
      if (digest.size > MAX_ARCHIVE_BYTES) {
        warnings.push(
          fileWarning(
            "archive_too_large",
            file.name,
            `${file.name} is too large to expand on the server; it was retained privately.`,
          ),
        );
        continue;
      }
      const buffer = await deps.storage.downloadWithin(
        file.stagingBucket,
        file.stagingPath,
        MAX_ARCHIVE_BYTES,
      );
      if (!buffer) {
        file.status = "unreadable";
        warnings.push(
          fileWarning("file_unreadable", file.name, `${file.name} could not be read back.`),
        );
        continue;
      }
      const archive = await deps.extractArchive({ fileName: file.name, buffer }, (entry) =>
        handleArchiveEntry(file.name, entry),
      );
      warnings.push(...archive.warnings);
      continue;
    }

    // --- Media: publishable ONLY when the observed bytes match the role ----
    if (isMedia) {
      if (!isPublishableMediaClass(file.category as IntakeCategory, observedClass)) {
        warnings.push(
          fileWarning(
            "media_class_mismatch",
            file.name,
            `${file.name} does not look like a valid ${file.category} (${observedClass}); it was retained privately and not published.`,
          ),
        );
        continue;
      }
      const dup = seenHashes.get(digest.sha256);
      if (dup) {
        warnings.push(
          fileWarning(
            "duplicate_media_ignored",
            file.name,
            `${file.name} is byte-identical to ${dup}; the duplicate was skipped.`,
          ),
        );
        continue;
      }
      seenHashes.set(digest.sha256, file.name);
      mediaCandidates.push({
        category: file.category as IntakeCategory,
        name: file.name,
        originalSha256: digest.sha256,
        originalSize: digest.size,
        fileRecord: file,
        contentType:
          canonicalPublicContentType(file.name, digest.head, observedClass) ??
          "application/octet-stream",
        from: { bucket: file.stagingBucket, path: file.stagingPath },
      });
      continue;
    }

    // --- Everything else stays retained in private staging (verified above).
  }

  // --- Publish separately hashed, sanitized, verified token-scoped derivatives
  const media: ProgressiveMediaItem[] = [];
  const photoUrls: string[] = [];
  const publicObjects: Array<{ bucket: string; path: string }> = [];
  let firstPhotoUrl: string | null = null;
  let firstBrochureUrl: string | null = null;
  const constructionUpdate = job.workflow === "construction_media_update";
  const dateLabel = job.created_at.slice(0, 10);
  let sortOrder = 0;
  let mediaIndex = 0;

  for (const candidate of mediaCandidates) {
    await options.heartbeat?.();
    const mediaType = mediaTypeForCategory(candidate.category);
    if (!mediaType) continue;
    const toBucket = publicBucketForCategory(candidate.category);
    const toPath = publicPathForMedia(job.id, options.token, mediaIndex, candidate.name);
    mediaIndex += 1;
    let sourceBytes: Buffer = Buffer.alloc(0);
    if (
      candidate.originalSize <= MAX_MEDIA_SANITIZE_BYTES &&
      ["image/jpeg", "image/png", "image/webp"].includes(candidate.contentType)
    ) {
      const downloaded = await deps.storage.downloadWithin(
        candidate.from.bucket,
        candidate.from.path,
        MAX_MEDIA_SANITIZE_BYTES,
      );
      if (!downloaded) {
        warnings.push(retentionWarning(candidate, "read_failed"));
        continue;
      }
      sourceBytes = downloaded;
    }
    const derivative = createPublicDerivative({
      bytes: sourceBytes,
      originalSha256: candidate.originalSha256,
      originalSize: candidate.originalSize,
      observedContentType: candidate.contentType,
    });
    if (candidate.fileRecord && candidate.archiveEntryName) {
      const entries = candidate.fileRecord.mediaTruthEntries ?? [];
      entries.push({ name: candidate.archiveEntryName, mediaTruth: derivative.record });
      candidate.fileRecord.mediaTruthEntries = entries;
    } else if (candidate.fileRecord) {
      candidate.fileRecord.mediaTruth = derivative.record;
    }
    if (!derivative.eligible) {
      warnings.push(retentionWarning(candidate, derivative.reason));
      continue;
    }
    try {
      await deps.storage.upload(toBucket, toPath, derivative.bytes, derivative.contentType);
      const publicDigest = await deps.storage.hashObject(toBucket, toPath, HEAD_SNIFF_BYTES);
      if (
        !publicDigest ||
        publicDigest.sha256 !== derivative.record.derivative!.sha256 ||
        publicDigest.size !== derivative.record.derivative!.size ||
        detectMediaClass(publicDigest.head) !== "image" ||
        canonicalPublicContentType(candidate.name, publicDigest.head, "image") !==
          derivative.contentType
      ) {
        await deps.storage.remove(toBucket, [toPath]).catch(() => undefined);
        warnings.push(retentionWarning(candidate, "verification_failed"));
        continue;
      }
    } catch {
      await deps.storage.remove(toBucket, [toPath]).catch(() => undefined);
      warnings.push(
        fileWarning(
          "media_publish_deferred",
          candidate.name,
          `${candidate.name} could not be published to the public gallery just now; it was retained privately.`,
        ),
      );
      continue;
    }
    publicObjects.push({ bucket: toBucket, path: toPath });
    const record = candidate.archiveEntryName ? undefined : candidate.fileRecord;
    if (record) {
      record.publicBucket = toBucket;
      record.publicPath = toPath;
      record.status = "published_public";
    }
    const url = deps.storage.publicUrl(toBucket, toPath);
    if (candidate.category === "photo") {
      photoUrls.push(url);
      if (!firstPhotoUrl) firstPhotoUrl = url;
    }
    if (candidate.category === "brochure" && !firstBrochureUrl) firstBrochureUrl = url;
    const title =
      constructionUpdate && candidate.category === "photo"
        ? `Construction update ${dateLabel}`
        : prettyTitleFromFileName(candidate.name);
    media.push({
      media_type: mediaType,
      url,
      title,
      sort_order: sortOrder,
      metadata: {
        studio: {
          job_id: job.id,
          original_name: candidate.name,
          category: candidate.category,
          media_truth: derivative.record,
        },
      },
    });
    sortOrder += 1;
  }

  return {
    priceList,
    priceListSource,
    factFields,
    media,
    firstPhotoUrl,
    firstBrochureUrl,
    photoUrls,
    warnings,
    files,
    publicObjects,
    derivedName,
  };
}

/** A file may be published as public media only when its bytes match its role. */
export function isPublishableMediaClass(category: IntakeCategory, observed: MediaClass): boolean {
  if (category === "photo") return observed === "image";
  if (category === "video") return observed === "video";
  // Documents/plans are typically PDFs but may legitimately be images.
  if (DOCUMENT_MEDIA_CATEGORIES[category]) return observed === "pdf" || observed === "image";
  return false;
}
