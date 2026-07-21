/**
 * Forever Studio — deterministic material gathering.
 *
 * Turns one upload job's stored files into the inputs the progressive
 * builder understands: an optional sanitized price list, optional structured
 * project facts, public media items, and warnings. Every failure of a single
 * file is a warning plus retention, never a job failure — incomplete or
 * partially readable materials still publish whatever is safely usable.
 *
 * Reuses the existing Fast Intake primitives (classifyPath, sanitizePriceList,
 * usableIntakeFact) rather than inventing a second interpretation layer.
 * No OCR, no AI document interpretation: exactly the existing capabilities.
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
// Routing
// ---------------------------------------------------------------------------

export const PUBLIC_IMAGE_BUCKET = "project-images";
export const PUBLIC_DOCUMENT_BUCKET = "project-documents";
export const PRIVATE_SOURCE_BUCKET = "studio-uploads";

const DOCUMENT_MEDIA_CATEGORIES: Partial<Record<IntakeCategory, string>> = {
  brochure: "brochure",
  "master-plan": "master_plan",
  "floor-plan": "floor_plan",
  "unit-plan": "unit_plan",
  "payment-plan": "payment_plan",
  "map-location": "document",
  "furniture-package": "document",
};

/** Bucket routing per classifier category. Private by default. */
export function bucketForCategory(category: IntakeCategory): string {
  if (category === "photo" || category === "video") return PUBLIC_IMAGE_BUCKET;
  if (DOCUMENT_MEDIA_CATEGORIES[category]) return PUBLIC_DOCUMENT_BUCKET;
  return PRIVATE_SOURCE_BUCKET;
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

export function storagePathForJobFile(jobId: string, index: number, name: string): string {
  return `jobs/${jobId}/${String(index).padStart(2, "0")}-${sanitizeFileName(name)}`;
}

export function declareJobFiles(
  jobId: string,
  files: Array<{ name: string; size?: number; contentType?: string }>,
): StudioJobFile[] {
  return files.map((file, index) => {
    const category = classifyFileName(file.name);
    return {
      name: file.name,
      bucket: bucketForCategory(category),
      path: storagePathForJobFile(jobId, index, file.name),
      content_type: file.contentType ?? null,
      size: file.size ?? null,
      category,
      status: "declared" as const,
    };
  });
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
  /** Progressive project payload columns derived from source-backed facts. */
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
  /** First uploaded photo / brochure public URLs, for blank-filling. */
  firstPhotoUrl: string | null;
  firstBrochureUrl: string | null;
  photoUrls: string[];
  warnings: ProgressiveWarning[];
  files: StudioJobFile[];
}

function fileWarning(code: string, name: string, message: string): ProgressiveWarning {
  return { entity: "document", code, severity: "warning", message, payload: { file: name } };
}

interface MediaCandidate {
  category: IntakeCategory;
  name: string;
  bucket: string;
  path: string;
}

/**
 * Downloads and interprets one job's uploaded files. Missing files (declared
 * but never uploaded — e.g. the phone lost connectivity mid-upload) become
 * warnings; everything usable continues.
 */
export async function gatherMaterials(
  deps: StudioDeps,
  job: StudioJobRow,
): Promise<GatheredMaterials> {
  const warnings: ProgressiveWarning[] = [];
  const files: StudioJobFile[] = job.files.map((file) => ({ ...file }));
  const mediaCandidates: MediaCandidate[] = [];
  let priceList: ExtractedPriceList | null = null;
  let priceListSource: string | null = null;
  let factFields: ExtractedFactFields | null = null;

  // One storage listing per (bucket, job folder) decides upload presence.
  const uploadedByBucket = new Map<string, Set<string>>();
  for (const bucket of new Set(files.map((file) => file.bucket))) {
    uploadedByBucket.set(bucket, await deps.storage.listNames(bucket, `jobs/${job.id}`));
  }

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

  for (const file of files) {
    const objectName = file.path.split("/").pop() ?? file.path;
    const uploaded = uploadedByBucket.get(file.bucket)?.has(objectName) ?? false;
    if (!uploaded) {
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

    const isJson = file.name.toLowerCase().endsWith(".json");
    const isPdf = file.name.toLowerCase().endsWith(".pdf");

    if (isJson) {
      const buffer = await deps.storage.download(file.bucket, file.path);
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
        factFields = projectFieldsFromFacts(parsed, file.name);
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

    if (file.category === "price-list" && isPdf) {
      const buffer = await deps.storage.download(file.bucket, file.path);
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

    if (file.category === "archive") {
      const buffer = await deps.storage.download(file.bucket, file.path);
      if (!buffer) {
        file.status = "unreadable";
        warnings.push(
          fileWarning("file_unreadable", file.name, `${file.name} could not be read back.`),
        );
        continue;
      }
      const archive = await deps.extractArchive({ fileName: file.name, buffer });
      warnings.push(...archive.warnings);
      let entryIndex = 0;
      for (const entry of archive.entries) {
        const category = classifyFileName(entry.name);
        const bucket = bucketForCategory(category);
        const path = `jobs/${job.id}/zip/${String(entryIndex).padStart(2, "0")}-${sanitizeFileName(entry.name)}`;
        entryIndex += 1;
        if (entry.name.toLowerCase().endsWith(".json")) {
          const parsed = parseJsonBuffer(entry.data);
          if (parsed && looksLikePriceList(parsed)) {
            adoptPriceList(parsed, entry.name);
            continue;
          }
          if (parsed && looksLikeProjectFacts(parsed)) {
            factFields = factFields ?? projectFieldsFromFacts(parsed, entry.name);
            continue;
          }
        }
        await deps.storage.upload(bucket, path, entry.data);
        if (mediaTypeForCategory(category)) {
          mediaCandidates.push({ category, name: entry.name, bucket, path });
        }
        if (category === "price-list" && entry.name.toLowerCase().endsWith(".pdf")) {
          const extraction = await deps.extractPriceListPdf({
            projectSlug: job.project_slug ?? job.id,
            fileName: entry.name,
            buffer: entry.data,
          });
          warnings.push(...extraction.warnings);
          if (extraction.priceList) adoptPriceList(extraction.priceList, entry.name);
        }
      }
      continue;
    }

    if (mediaTypeForCategory(file.category as IntakeCategory)) {
      mediaCandidates.push({
        category: file.category as IntakeCategory,
        name: file.name,
        bucket: file.bucket,
        path: file.path,
      });
    }
    // Everything else stays retained in its (private) bucket: preserved, never lost.
  }

  // Deterministic ordering: photos first (gallery), then plans and documents.
  const media: ProgressiveMediaItem[] = [];
  const photoUrls: string[] = [];
  let firstPhotoUrl: string | null = null;
  let firstBrochureUrl: string | null = null;
  const constructionUpdate = job.workflow === "construction_media_update";
  // Derived from the job's creation time so a retry replays byte-identical
  // batches (the RPC's fingerprint idempotency depends on it).
  const dateLabel = job.created_at.slice(0, 10);
  let sortOrder = 0;
  for (const candidate of mediaCandidates) {
    const mediaType = mediaTypeForCategory(candidate.category);
    if (!mediaType) continue;
    const url = deps.storage.publicUrl(candidate.bucket, candidate.path);
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
  };
}
