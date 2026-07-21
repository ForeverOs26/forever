/**
 * Forever Studio — private staging, byte verification, and media selection
 * (items 4 & 5).
 *
 * EVERY incoming file lands in the private `studio-uploads` bucket. During
 * processing Studio verifies the ACTUAL stored bytes (size, SHA-256 where
 * practical, magic-byte media class, declared-vs-observed mismatch), parses
 * only bounded business files, and copies ONLY the selected final media to
 * public buckets on deterministic immutable paths. Raw PDFs, ZIPs, price
 * lists, legal files, and unselected media never leave the private bucket.
 *
 * Large photos and videos are never downloaded into a Buffer — their size is
 * read from storage metadata and they are published by a server-side copy.
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
/** Max archive we will download and expand in memory. */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024; // 100 MiB
/** Max media we will read to hash + sniff magic bytes; larger is copy-only. */
export const MAX_HASH_BYTES = 25 * 1024 * 1024; // 25 MiB

const DOCUMENT_MEDIA_CATEGORIES: Partial<Record<IntakeCategory, string>> = {
  brochure: "brochure",
  "master-plan": "master_plan",
  "floor-plan": "floor_plan",
  "unit-plan": "unit_plan",
  "payment-plan": "payment_plan",
  "map-location": "document",
  "furniture-package": "document",
};

/** Public bucket a selected media category is copied into. */
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

function publicPathForMedia(jobId: string, index: number, name: string): string {
  return `studio/${jobId}/${String(index).padStart(2, "0")}-${sanitizeFileName(name)}`;
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
  if (head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp") return "video";
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

function classFromExtension(name: string): MediaClass {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "tif", "tiff"].includes(ext))
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
  /** Public objects copied for this job — cleaned up if finalization fails. */
  publicObjects: Array<{ bucket: string; path: string }>;
  /** True when a title/name could be derived from an uploaded business file. */
  derivedName: string | null;
}

function fileWarning(code: string, name: string, message: string): ProgressiveWarning {
  return { entity: "document", code, severity: "warning", message, payload: { file: name } };
}

interface MediaCandidate {
  category: IntakeCategory;
  name: string;
  /** Source (staging) location to copy from. */
  from: { bucket: string; path: string };
}

/**
 * Verify, interpret, and select one job's staged files. Missing files
 * (declared but never uploaded) and oversized/unreadable files become
 * warnings and stay privately retained; selected media are copied to public
 * immutable paths and recorded only here.
 */
export async function gatherMaterials(
  deps: StudioDeps,
  job: StudioJobRow,
): Promise<GatheredMaterials> {
  const warnings: ProgressiveWarning[] = [];
  const files: StudioJobFile[] = job.files.map((file) => ({ ...file }));
  const mediaCandidates: MediaCandidate[] = [];
  const seenHashes = new Map<string, string>();
  let priceList: ExtractedPriceList | null = null;
  let priceListSource: string | null = null;
  let factFields: ExtractedFactFields | null = null;
  let derivedName: string | null = null;

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

  for (const file of files) {
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
    file.observedSize = stat.size;
    file.status = "uploaded";
    file.mediaClass = classFromExtension(file.name);
    if (file.declaredSize != null && file.declaredSize !== stat.size) {
      file.declaredMismatch = true;
    }
    if (stat.size > MAX_UPLOAD_BYTES) {
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

    const lower = file.name.toLowerCase();
    const isJson = lower.endsWith(".json");
    const isPdf = lower.endsWith(".pdf");
    const isArchive = file.category === "archive";
    const isMedia = mediaTypeForCategory(file.category as IntakeCategory) !== null;

    // --- Structured JSON (bounded parse) -----------------------------------
    if (isJson) {
      if (stat.size > MAX_PARSE_BYTES) {
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
      if (buffer) {
        file.sha256 = await sha256Of(buffer);
        file.mediaClass = detectMediaClass(buffer);
      }
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
      if (stat.size > MAX_PARSE_BYTES) {
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
      file.sha256 = await sha256Of(buffer);
      file.mediaClass = detectMediaClass(buffer);
      const extraction = await deps.extractPriceListPdf({
        projectSlug: job.project_slug ?? job.id,
        fileName: file.name,
        buffer,
      });
      warnings.push(...extraction.warnings);
      if (extraction.priceList) adoptPriceList(extraction.priceList, file.name);
      continue;
    }

    // --- Archive (bounded download + expansion) ---------------------------
    if (isArchive) {
      if (stat.size > MAX_ARCHIVE_BYTES) {
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
      file.sha256 = await sha256Of(buffer);
      file.mediaClass = detectMediaClass(buffer);
      const archive = await deps.extractArchive({ fileName: file.name, buffer });
      warnings.push(...archive.warnings);
      let entryIndex = 0;
      for (const entry of archive.entries) {
        const category = classifyFileName(entry.name);
        if (entry.name.toLowerCase().endsWith(".json")) {
          const parsed = parseJsonBuffer(entry.data);
          if (parsed && looksLikePriceList(parsed)) {
            adoptPriceList(parsed, entry.name);
            continue;
          }
          if (parsed && looksLikeProjectFacts(parsed)) {
            adoptFacts(parsed, entry.name);
            continue;
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
          continue;
        }
        if (mediaTypeForCategory(category)) {
          const mediaClass = detectMediaClass(entry.data.subarray(0, 64));
          if (!isPublishableMediaClass(category, mediaClass)) {
            warnings.push(
              fileWarning(
                "media_class_mismatch",
                entry.name,
                `${entry.name} inside ${file.name} is not a valid ${category}; retained privately.`,
              ),
            );
            continue;
          }
          // Re-stage the entry privately, then treat it as a media candidate.
          const stagedPath = `jobs/${job.id}/zip/${String(entryIndex).padStart(2, "0")}-${sanitizeFileName(entry.name)}`;
          entryIndex += 1;
          await deps.storage.upload(PRIVATE_SOURCE_BUCKET, stagedPath, entry.data);
          mediaCandidates.push({
            category,
            name: entry.name,
            from: { bucket: PRIVATE_SOURCE_BUCKET, path: stagedPath },
          });
        }
      }
      continue;
    }

    // --- Media (small: verify magic bytes; large: copy-only) --------------
    if (isMedia) {
      if (stat.size <= MAX_HASH_BYTES) {
        const buffer = await deps.storage.downloadWithin(
          file.stagingBucket,
          file.stagingPath,
          MAX_HASH_BYTES,
        );
        if (buffer) {
          const hash = await sha256Of(buffer);
          file.sha256 = hash;
          const mediaClass = detectMediaClass(buffer);
          file.mediaClass = mediaClass;
          if (!isPublishableMediaClass(file.category as IntakeCategory, mediaClass)) {
            warnings.push(
              fileWarning(
                "media_class_mismatch",
                file.name,
                `${file.name} does not look like a valid ${file.category} (${mediaClass}); it was retained privately and not published.`,
              ),
            );
            continue;
          }
          const dup = seenHashes.get(hash);
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
          seenHashes.set(hash, file.name);
        }
      } else {
        // Large media: never buffered; classify by extension, publish by copy.
        file.mediaClass = classFromExtension(file.name);
      }
      mediaCandidates.push({
        category: file.category as IntakeCategory,
        name: file.name,
        from: { bucket: file.stagingBucket, path: file.stagingPath },
      });
      continue;
    }

    // --- Everything else stays retained in private staging ----------------
    if (stat.size <= MAX_HASH_BYTES) {
      const buffer = await deps.storage.downloadWithin(
        file.stagingBucket,
        file.stagingPath,
        MAX_HASH_BYTES,
      );
      if (buffer) {
        file.sha256 = await sha256Of(buffer);
        file.mediaClass = detectMediaClass(buffer);
      }
    }
  }

  // --- Publish selected media to public immutable paths (server-side copy)
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
    const mediaType = mediaTypeForCategory(candidate.category);
    if (!mediaType) continue;
    const toBucket = publicBucketForCategory(candidate.category);
    const toPath = publicPathForMedia(job.id, mediaIndex, candidate.name);
    mediaIndex += 1;
    try {
      await deps.storage.copyObject(candidate.from, { bucket: toBucket, path: toPath });
    } catch {
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
    const record = files.find((f) => f.name === candidate.name);
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
        studio: { job_id: job.id, original_name: candidate.name, category: candidate.category },
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
function isPublishableMediaClass(category: IntakeCategory, observed: MediaClass): boolean {
  if (category === "photo") return observed === "image";
  if (category === "video") return observed === "video";
  // Documents/plans are typically PDFs but may legitimately be images.
  if (DOCUMENT_MEDIA_CATEGORIES[category]) return observed === "pdf" || observed === "image";
  return false;
}
