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

import {
  isStudioMaterialPurpose,
  type StudioJobFile,
  type StudioMaterialPurpose,
  type StudioMaterialPurposeSource,
  type StudioStorageProviderId,
} from "../studio-types";
import { StudioAccessError, type StudioDeps, type StudioJobRow } from "./contracts";
import type { StudioStorageProvider } from "./storage/provider";
import { r2InlineEntryPath, r2StagingPathForJobFile } from "./storage/r2-layout";
import {
  createPublicDerivative,
  MAX_MEDIA_SANITIZE_BYTES,
  publicMediaTruthProjection,
  type SanitizedImageFormat,
} from "./media-truth";

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

/**
 * LEGACY / FULL-PROJECT-ARCHIVE-ENTRY FALLBACK ONLY.
 *
 * Guessing a file's purpose from its name is no longer how a direct Studio
 * upload is routed — the Owner states the purpose by choosing an upload
 * window, and `categoryForPurpose` maps that choice deterministically. This
 * classifier now runs in exactly two bounded places, BOTH of them read/
 * processing paths and NEITHER of them reachable from job creation:
 *
 *   1. a job whose stored manifest predates the explicit-purpose contract and
 *      therefore carries no `materialPurpose` (resume / retry of an old job)
 *      — see `routingCategoryForFile`;
 *   2. an entry discovered inside a FULL PROJECT ARCHIVE / OTHER PACKAGE,
 *      which is precisely the window whose meaning is "unsorted — sort it for
 *      me", so the Owner supplied no per-entry purpose to honour
 *      — see `archiveEntryRouting`.
 *
 * It must never be used to route, re-route, or second-guess a directly
 * uploaded file whose window the Owner already chose, nor an entry inside an
 * archive the Owner filed under some OTHER window.
 */
export function classifyFileName(name: string): IntakeCategory {
  return classifyPath(name).category;
}

/**
 * The Owner's chosen window → the ingestion/media routing vocabulary.
 *
 * Total and deterministic: every purpose has exactly one category, and the
 * mapping consults nothing else — not the filename, not the extension, not the
 * declared content type. Two windows may share a category (a construction
 * photo and a project photo are both `photo`); the ORIGINAL purpose is kept on
 * the manifest so the distinction survives, and the media title honours it.
 */
const CATEGORY_FOR_PURPOSE: Record<StudioMaterialPurpose, IntakeCategory> = {
  brochure: "brochure",
  price_list: "price-list",
  payment_plan: "payment-plan",
  project_photo: "photo",
  video: "video",
  master_plan: "master-plan",
  floor_plan: "floor-plan",
  unit_plan: "unit-plan",
  construction_photo: "photo",
  construction_video: "video",
  document_legal: "legal-document",
  developer_profile: "developer-profile",
  map_location: "map-location",
  project_archive: "archive",
};

export function categoryForPurpose(purpose: StudioMaterialPurpose): IntakeCategory {
  return CATEGORY_FOR_PURPOSE[purpose];
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

export function stagingPathForJobFile(jobId: string, index: number, name: string): string {
  return `jobs/${jobId}/staging/${String(index).padStart(2, "0")}-${sanitizeFileName(name)}`;
}

/**
 * The private staging path for one declared file, on the provider that will
 * actually hold it.
 *
 * The Supabase lane keeps the historical path (sanitized filename included):
 * those objects are already written, and rewriting the scheme would orphan
 * them. A brand-new R2 key carries no filename at all — filenames routinely
 * contain personal names, addresses and deal references, and a storage key has
 * no need of them. Identity is the job id plus the file's server-assigned index,
 * which is exactly what pairs bytes to targets.
 */
export function stagingPathForProvider(
  provider: StudioStorageProviderId,
  jobId: string,
  index: number,
  name: string,
): string {
  return provider === "r2"
    ? r2StagingPathForJobFile(jobId, index)
    : stagingPathForJobFile(jobId, index, name);
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

const PUBLIC_IMAGE_EXTENSION: Record<SanitizedImageFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

/**
 * Public names are derived only from server/job identity and verified final
 * bytes. Client filenames never participate in this public boundary.
 */
export function publicPathForDerivative(
  jobId: string,
  token: string,
  index: number,
  derivativeSha256: string,
  format: SanitizedImageFormat,
): string {
  if (!/^[a-f0-9]{64}$/.test(derivativeSha256)) {
    throw new Error("invalid_derivative_sha256");
  }
  const ordinal = String(index).padStart(2, "0");
  const hashPrefix = derivativeSha256.slice(0, 16);
  return `${publicJobPrefix(jobId)}/${attemptPrefixFromToken(token)}/${ordinal}-${hashPrefix}.${PUBLIC_IMAGE_EXTENSION[format]}`;
}

/**
 * Declare every NEW directly uploaded file into the PRIVATE staging bucket.
 *
 * THE CREATION PATH. An explicit, allowlisted `materialPurpose` is REQUIRED on
 * every file: this function cannot produce a manifest entry routed by
 * filename, because a brand-new direct upload always came from a window the
 * Owner chose. A missing, null, blank, unknown or otherwise unrecognized value
 * is a hard refusal — never a silent downgrade to guessing, never a default,
 * and never a stripped field. The refusal happens before the caller writes a
 * job row or mints a signed upload target, so one bad file refuses the whole
 * job atomically.
 *
 * ROUTING RULE: the window is authoritative and the filename is never
 * consulted — a price list called `document.pdf` routes as a price list, and a
 * document called `price-list.pdf` uploaded under Documents stays a document.
 *
 * The endpoint schema already rejects unknown values; this second, independent
 * check keeps the guarantee for every other caller of this service, including
 * internal ones that never touch the endpoint.
 */
export function declareNewDirectJobFiles(
  jobId: string,
  files: Array<{
    name: string;
    size?: number;
    contentType?: string;
    materialPurpose?: StudioMaterialPurpose | null;
  }>,
  /**
   * The storage system this job is being created on. Recorded on EVERY file so
   * the manifest states where its bytes live rather than leaving a later reader
   * to consult a global setting that may since have changed. Defaults to the
   * legacy provider so existing callers (and every stored manifest) keep their
   * exact previous meaning.
   */
  storageProvider: StudioStorageProviderId = "supabase",
): StudioJobFile[] {
  return files.map((file, index) => {
    const purpose = assertNewDirectMaterialPurpose(file.materialPurpose);
    return {
      name: file.name,
      storageProvider,
      stagingBucket: PRIVATE_SOURCE_BUCKET,
      stagingPath: stagingPathForProvider(storageProvider, jobId, index, file.name),
      declaredSize: file.size ?? null,
      declaredType: file.contentType ?? null,
      materialPurpose: purpose,
      purposeSource: "owner_selected" as const,
      category: categoryForPurpose(purpose),
      status: "declared" as const,
    };
  });
}

/**
 * The closed-allowlist gate every NEW directly uploaded material passes,
 * whether it travels the ordinary signed lane or the resumable large-archive
 * lane. Returns the validated purpose or throws; it never returns a default.
 *
 * `undefined`, `null`, `""` and whitespace are reported as MISSING and every
 * other unrecognized value as INVALID, because those are different mistakes:
 * one is a caller that forgot the field, the other is a caller sending
 * something Studio does not recognize. Neither is ever routed.
 */
export function assertNewDirectMaterialPurpose(value: unknown): StudioMaterialPurpose {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    throw new StudioAccessError(
      "material_purpose_required",
      "Choose the upload window that says what this file is.",
    );
  }
  if (!isStudioMaterialPurpose(value)) {
    throw new StudioAccessError(
      "material_purpose_invalid",
      "That upload window is not one Forever recognizes.",
    );
  }
  return value;
}

/**
 * The routing category of a STORED manifest entry. THE READ PATH — the only
 * place a directly uploaded file may fall back to its filename, and only for a
 * manifest that genuinely predates this contract.
 *
 * The Owner's recorded purpose wins whenever one is present, so a retry or a
 * resume of an explicit job re-derives the SAME category it was declared with
 * and can never drift into a filename guess — even if the stored `category`
 * text was tampered with. An entry with no purpose is a manifest written
 * before the explicit-purpose contract existed: it keeps whatever category the
 * classifier gave it at declaration time, exactly as it processed before, and
 * only a row that somehow also lost its category is re-classified now.
 */
export function routingCategoryForFile(file: StudioJobFile): IntakeCategory {
  if (isStudioMaterialPurpose(file.materialPurpose))
    return categoryForPurpose(file.materialPurpose);
  return file.category ? (file.category as IntakeCategory) : classifyFileName(file.name);
}

/** Truthful provenance of the category `routingCategoryForFile` just derived. */
export function purposeSourceForStoredFile(file: StudioJobFile): StudioMaterialPurposeSource {
  return isStudioMaterialPurpose(file.materialPurpose) ? "owner_selected" : "filename_fallback";
}

/**
 * How ONE entry expanded from a directly uploaded archive is routed.
 *
 * Two explicit cases, and nothing in between:
 *
 *   A. the archive was filed under FULL PROJECT ARCHIVE / OTHER PACKAGE (or is
 *      a pre-contract archive with no recorded window at all) — the Owner
 *      deliberately did not sort it, so the bounded deterministic entry
 *      classifier routes each entry. This is routing, never verification.
 *
 *   B. the archive was filed under ANY other window — Project Photos, Price
 *      List, Documents / Legal, Floor Plans… — so every entry INHERITS that
 *      window. Filename, folder name and extension may not override it.
 *
 * The inherited purpose is a semantic decision only. It never relaxes byte
 * safety: an entry whose actual bytes are incompatible with the inherited
 * category still fails `isPublishableMediaClass`, stays private with a truthful
 * warning, and is NEVER re-filed under some other window that would accept it.
 */
export function archiveEntryRouting(
  outerPurpose: StudioMaterialPurpose | null,
  entryName: string,
): { category: IntakeCategory; purposeSource: StudioMaterialPurposeSource } {
  if (outerPurpose === null) {
    return { category: classifyFileName(entryName), purposeSource: "filename_fallback" };
  }
  if (outerPurpose === "project_archive") {
    return { category: classifyFileName(entryName), purposeSource: "archive_entry_classifier" };
  }
  return {
    category: categoryForPurpose(outerPurpose),
    purposeSource: "inherited_explicit_window",
  };
}

// ---------------------------------------------------------------------------
// Structured-artifact purpose boundary
// ---------------------------------------------------------------------------

/**
 * What a structured artifact BECOMES when it is adopted.
 *
 * Adoption is not publication of one file: it replaces project-wide state — the
 * project's price list, the project's facts. That is a far stronger act than
 * putting a photo in the gallery, and it is exactly the act the Owner's chosen
 * window has to authorize.
 */
export type StructuredArtifactKind = "price_list" | "project_facts";

/** The routing decision a structured artifact is being considered under. */
export interface StructuredPurposeScope {
  /** The window governing this material, when one does. */
  purpose: StudioMaterialPurpose | null;
  /** How that window — or its absence — was arrived at. */
  purposeSource: StudioMaterialPurposeSource;
}

/** Safe warning/outcome code for an artifact refused by its own window. */
export const STRUCTURED_PURPOSE_MISMATCH_CODE = "structured_purpose_mismatch";

const EVERY_STRUCTURED_ARTIFACT: ReadonlySet<StructuredArtifactKind> =
  new Set<StructuredArtifactKind>(["price_list", "project_facts"]);
const PRICE_LIST_ONLY: ReadonlySet<StructuredArtifactKind> = new Set<StructuredArtifactKind>([
  "price_list",
]);
const NO_STRUCTURED_ARTIFACT: ReadonlySet<StructuredArtifactKind> =
  new Set<StructuredArtifactKind>();

/**
 * WHICH structured artifacts a window may adopt — the complete matrix, as one
 * total function, consulted BEFORE any JSON is parsed.
 *
 * Content shape may VALIDATE a file inside the window the Owner chose. It may
 * never REPLACE that window. `prices.json` filed under Project Photos is a
 * private photo-window file that happens to contain JSON; it is not a price
 * list, and neither its `.json` extension nor its `unit_inventory` array is
 * permission to overwrite the project's prices.
 *
 * Three cases admit structured adoption, for three different reasons:
 *
 *   price_list          the Owner said "this IS the price list", so a
 *                       price-list artifact is precisely what was promised. A
 *                       PROJECT-FACTS artifact still is not, and does not get
 *                       to rewrite the project's facts from this window.
 *   project_archive     Full Project Archive / Other Package means "unsorted —
 *                       sort it for me": the Owner deliberately supplied no
 *                       per-item purpose, so supported artifacts inside it are
 *                       detected exactly as before.
 *   no explicit window  a stored manifest that predates the explicit-purpose
 *                       contract (or an entry inside such an archive). Its
 *                       historical filename/content behaviour is preserved so
 *                       old jobs still resume. A NEW direct upload can never
 *                       reach this case: creation refuses a file with no window
 *                       (see `assertNewDirectMaterialPurpose`).
 *
 * Every OTHER window — Project Photos, Documents / Legal, Construction, Master
 * Plan, Floor Plan, Unit Plan, Payment Plan, Brochure, Video, Developer
 * Profile, Map — admits NOTHING. Material filed there stays private with a safe
 * warning, and is never silently moved into a category that would accept it.
 */
export function admittedStructuredArtifacts(
  scope: StructuredPurposeScope,
): ReadonlySet<StructuredArtifactKind> {
  // Routed with no explicit window at all — legacy stored data only.
  if (scope.purposeSource === "filename_fallback") return EVERY_STRUCTURED_ARTIFACT;
  // Inside a Full Project Archive, the window whose meaning is "sort this".
  if (scope.purposeSource === "archive_entry_classifier") return EVERY_STRUCTURED_ARTIFACT;
  // An explicit source with no recorded purpose is a contradiction: fail closed.
  if (scope.purpose === null) return NO_STRUCTURED_ARTIFACT;
  if (scope.purpose === "project_archive") return EVERY_STRUCTURED_ARTIFACT;
  if (scope.purpose === "price_list") return PRICE_LIST_ONLY;
  return NO_STRUCTURED_ARTIFACT;
}

/** Whether ONE structured artifact kind may be adopted under `scope`. */
export function structuredArtifactAllowed(
  scope: StructuredPurposeScope,
  kind: StructuredArtifactKind,
): boolean {
  return admittedStructuredArtifacts(scope).has(kind);
}

/** The scope a STORED direct manifest entry is considered under. */
export function structuredPurposeScopeForFile(file: StudioJobFile): StructuredPurposeScope {
  return {
    purpose: isStudioMaterialPurpose(file.materialPurpose) ? file.materialPurpose : null,
    purposeSource: purposeSourceForStoredFile(file),
  };
}

/**
 * The scope ONE entry expanded from a directly uploaded archive is considered
 * under — derived from the SAME routing decision that gave the entry its
 * category, so the two can never disagree. Only an inherited entry carries a
 * purpose: an entry the classifier routed inside a Full Project Archive has
 * none, because the Owner never filed it individually.
 */
export function structuredPurposeScopeForArchiveEntry(
  outerPurpose: StudioMaterialPurpose | null,
  entryName: string,
): StructuredPurposeScope {
  const { purposeSource } = archiveEntryRouting(outerPurpose, entryName);
  return {
    purpose: purposeSource === "inherited_explicit_window" ? outerPurpose : null,
    purposeSource,
  };
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

export function parseJsonBuffer(buffer: Buffer): unknown | null {
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
  /**
   * True when the price list was DISCOVERED inside a Full Project Archive
   * rather than filed by the Owner under a price-list window.
   *
   * The difference matters at exactly one point: an archive is "unsorted, sort
   * it for me", so a price list found inside one is an inference. Applying an
   * inference over a project that already has its imported prices would
   * silently rewrite real commercial data, so it is refused. A price list the
   * Owner deliberately filed is not an inference and is never refused here.
   */
  priceListFromArchive: boolean;
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
  /**
   * The storage provider THIS JOB was created with, resolved from the job's own
   * persisted record. Every read, every re-stage and every public derivative in
   * this function goes through it — there is no path back to `deps.storage`, so
   * an R2 job cannot touch Supabase Storage and a Supabase job cannot touch R2.
   */
  provider: StudioStorageProvider;
  /** The processing-claim token; scopes every side-effect path. */
  token: string;
  /** Lease heartbeat, awaited between files/entries; throws to abort. */
  heartbeat?: () => Promise<void>;
  /**
   * SHA-256 digests already published durably by this job's large-archive
   * entries (digest → public-safe label). Ordinary files and legacy inline
   * ZIP entries matching one of these are deterministic duplicates.
   */
  seedHashes?: Map<string, string>;
}

function fileWarning(code: string, name: string, message: string): ProgressiveWarning {
  // Original names can contain names, addresses, phone/email-shaped values,
  // or local paths. Warnings cross the browser boundary, so no portion of the
  // original filename is projected.
  const publicLabel = "Private source file";
  return {
    entity: "document",
    code,
    severity: "warning",
    message: message.split(name).join(publicLabel),
    payload: { file: publicLabel },
  };
}

/**
 * A structured artifact refused because it did not match the window the Owner
 * filed it under.
 *
 * Public-safe by construction: `fileWarning` replaces every occurrence of the
 * original filename with a neutral label, and the message names no Storage
 * bucket, no object path, no database table and no column. It says what the
 * Owner needs to know — this one file changed nothing, and it is still here.
 */
function structuredPurposeMismatchWarning(name: string): ProgressiveWarning {
  return fileWarning(
    STRUCTURED_PURPOSE_MISMATCH_CODE,
    name,
    `${name} does not match the upload window it was filed under, so nothing was updated from it; it was retained privately.`,
  );
}

export const NEUTRAL_MEDIA_TITLE: Partial<Record<IntakeCategory, string>> = {
  photo: "Project photo",
  video: "Project video",
  brochure: "Project brochure",
  "master-plan": "Master plan",
  "floor-plan": "Floor plan",
  "unit-plan": "Unit plan",
  "payment-plan": "Payment plan",
  "map-location": "Location map",
  "furniture-package": "Furniture package",
};

/**
 * Neutral public title. Original filenames never participate.
 *
 * A file the Owner uploaded into a Construction window is a construction
 * update wherever it was uploaded from — the explicit purpose is honoured
 * first, and the workflow-level rule stays as the fallback for material with
 * no purpose (legacy manifests and archive entries).
 */
function neutralPublicMediaTitle(
  category: IntakeCategory,
  purpose: StudioMaterialPurpose | null,
  ordinal: number,
  constructionUpdate: boolean,
  dateLabel: string,
): string {
  if (purpose === "construction_photo" || purpose === "construction_video") {
    return `Construction update ${dateLabel}`;
  }
  if (!purpose && constructionUpdate && category === "photo") {
    return `Construction update ${dateLabel}`;
  }
  return `${NEUTRAL_MEDIA_TITLE[category] ?? "Project media"} ${ordinal}`;
}

interface MediaCandidate {
  category: IntakeCategory;
  /** The Owner's chosen window, when this candidate came from a direct file. */
  purpose?: StudioMaterialPurpose | null;
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
    | "color_profile_unsupported"
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
  if (reason === "color_profile_unsupported") {
    // A valid color-managed (e.g. Display-P3 / embedded-ICC) image. Its color
    // cannot be safely re-interpreted as sRGB without a profile rewriter, so it
    // is retained privately with a dedicated, non-alarming reason.
    return fileWarning(
      "media_color_profile_unsupported",
      candidate.name,
      `${candidate.name} carries an embedded color profile that Forever cannot yet re-render safely for public delivery; it remains private.`,
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
  // The job's OWN provider — never `deps.storage`, never the current global
  // write-provider setting.
  const storage = options.provider.objects;
  const warnings: ProgressiveWarning[] = [];
  const files: StudioJobFile[] = job.files.map((file) => ({ ...file }));
  const mediaCandidates: MediaCandidate[] = [];
  const seenHashes = new Map<string, string>(options.seedHashes ?? []);
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

  /**
   * Shared per-entry routing for entries expanded from an inline archive.
   *
   * The container's OWN Owner-selected window decides how its entries route:
   * only a Full Project Archive (or a pre-contract manifest with no recorded
   * window) reaches the filename classifier — an archive filed under any other
   * window hands that window down to every entry inside it.
   */
  const handleArchiveEntry = async (
    container: StudioJobFile,
    entry: { name: string; data: Buffer },
  ): Promise<void> => {
    await options.heartbeat?.();
    const containerName = container.name;
    const outerPurpose = isStudioMaterialPurpose(container.materialPurpose)
      ? container.materialPurpose
      : null;
    const { category } = archiveEntryRouting(outerPurpose, entry.name);
    // Only an INHERITED entry carries a purpose: an entry the classifier routed
    // inside a Full Project Archive has none, and saying otherwise would claim
    // the Owner filed it individually.
    const scope = structuredPurposeScopeForArchiveEntry(outerPurpose, entry.name);
    const entryPurpose = scope.purpose;
    if (entry.name.toLowerCase().endsWith(".json")) {
      // PURPOSE FIRST, SHAPE SECOND. An entry inherits its container's window,
      // so `prices.json` inside a Project Photos ZIP is a photo-window file
      // that happens to hold JSON — it never becomes the project's price list.
      // A window that admits nothing is settled without the bytes ever being
      // parsed, so no shape test can even be consulted, and its siblings in the
      // same archive continue untouched.
      const admitted = admittedStructuredArtifacts(scope);
      if (admitted.size === 0) {
        warnings.push(structuredPurposeMismatchWarning(entry.name));
        return;
      }
      const parsed = parseJsonBuffer(entry.data);
      if (parsed && looksLikePriceList(parsed)) {
        if (!admitted.has("price_list")) {
          warnings.push(structuredPurposeMismatchWarning(entry.name));
          return;
        }
        adoptPriceList(parsed, entry.name);
        return;
      }
      if (parsed && looksLikeProjectFacts(parsed)) {
        if (!admitted.has("project_facts")) {
          warnings.push(structuredPurposeMismatchWarning(entry.name));
          return;
        }
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
      // On R2 the key carries no entry name for the same reason a staging key
      // carries no filename: a path inside someone's ZIP is not storage
      // identity, and it can hold personal data.
      const stagedPath =
        options.provider.id === "r2"
          ? r2InlineEntryPath(job.id, attempt, zipStageIndex)
          : `jobs/${job.id}/zip/${attempt}/${String(zipStageIndex).padStart(2, "0")}-${sanitizeFileName(entry.name)}`;
      zipStageIndex += 1;
      await storage.upload(PRIVATE_SOURCE_BUCKET, stagedPath, entry.data);
      mediaCandidates.push({
        category,
        purpose: entryPurpose,
        name: entry.name,
        originalSha256: hash,
        originalSize: entry.data.length,
        // The container itself, not a name lookup: two archives with the same
        // filename must not fold each other's evidence together.
        fileRecord: container,
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
    const stat = await storage.statObject(file.stagingBucket, file.stagingPath);
    if (!stat) {
      file.status = "missing";
      warnings.push(
        fileWarning(
          "file_upload_missing",
          file.name,
          // EVIDENCE-SAFE BY CONSTRUCTION (FOREVER-PR142-EVIDENCE-SAFE-RENDER-009).
          // A `statObject` miss is a failed LOOKUP through one credentialed code
          // path. It does not establish that the bytes never reached storage, so
          // this message reports the lookup and stops there.
          `${file.name} could not be found through its declared storage path. Physical storage state is unresolved.`,
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
    const digest = await storage.hashObject(file.stagingBucket, file.stagingPath, HEAD_SNIFF_BYTES);
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

    // The Owner's chosen window decides routing; the filename is only ever a
    // hint about HOW to read the bytes (JSON/PDF parsing), never about WHAT
    // the material is.
    const category = routingCategoryForFile(file);
    // The SAME stored window, in the vocabulary the structured-artifact
    // boundary reasons in — derived from the manifest, never from this file's
    // name, extension or declared type.
    const structuredScope = structuredPurposeScopeForFile(file);
    const lower = file.name.toLowerCase();
    const isJson = lower.endsWith(".json");
    const isPdf = lower.endsWith(".pdf");
    // A ZIP is expanded because it IS a ZIP — declared `.zip` AND observed as
    // zip bytes — not because of which window it came from. That is what keeps
    // the two transport lanes semantically identical: the resumable lane
    // expands a large ZIP from any window, so the inline lane must expand a
    // small one from any window too, and both hand the SAME outer purpose down
    // to their entries (see archiveEntryRouting). A file whose name says `.jpg`
    // but whose bytes are a ZIP is still a declared/observed mismatch, kept
    // private exactly as before — never quietly expanded.
    const isArchive = category === "archive" || (lower.endsWith(".zip") && observedClass === "zip");
    const isMedia = mediaTypeForCategory(category) !== null;

    // --- Structured JSON (bounded parse) -----------------------------------
    if (isJson) {
      // PURPOSE FIRST, SHAPE SECOND. The Owner's window decides whether this
      // file may become a price list or the project's facts AT ALL; only then
      // does its content get to say WHICH of the admitted artifacts it is.
      // A window that admits nothing never reaches the parser, so neither the
      // `.json` extension nor a price-list-shaped body can authorize adoption.
      const admitted = admittedStructuredArtifacts(structuredScope);
      if (admitted.size === 0) {
        warnings.push(structuredPurposeMismatchWarning(file.name));
        continue;
      }
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
      const buffer = await storage.downloadWithin(
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
        if (!admitted.has("price_list")) {
          warnings.push(structuredPurposeMismatchWarning(file.name));
          continue;
        }
        adoptPriceList(parsed, file.name);
        continue;
      }
      if (looksLikeProjectFacts(parsed)) {
        if (!admitted.has("project_facts")) {
          warnings.push(structuredPurposeMismatchWarning(file.name));
          continue;
        }
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
    if (category === "price-list" && isPdf) {
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
      const buffer = await storage.downloadWithin(
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
      const buffer = await storage.downloadWithin(
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
        handleArchiveEntry(file, entry),
      );
      warnings.push(...archive.warnings);
      continue;
    }

    // --- Media: publishable ONLY when the observed bytes match the role ----
    if (isMedia) {
      // Bytes incompatible with the chosen window are NEVER quietly re-filed
      // under a window that would accept them: the Owner's purpose stands, the
      // original stays private, and the job continues with its other files.
      if (!isPublishableMediaClass(category, observedClass)) {
        warnings.push(
          fileWarning(
            "media_class_mismatch",
            file.name,
            `${file.name} does not look like a valid ${category} (${observedClass}); it was retained privately and not published.`,
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
        category,
        purpose: isStudioMaterialPurpose(file.materialPurpose) ? file.materialPurpose : null,
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
    const mediaOrdinal = mediaIndex;
    mediaIndex += 1;
    let sourceBytes: Buffer = Buffer.alloc(0);
    if (
      candidate.originalSize <= MAX_MEDIA_SANITIZE_BYTES &&
      ["image/jpeg", "image/png", "image/webp"].includes(candidate.contentType)
    ) {
      const downloaded = await storage.downloadWithin(
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
    const derivativeSha256 = derivative.record.derivative!.sha256;
    const toPath = publicPathForDerivative(
      job.id,
      options.token,
      mediaOrdinal,
      derivativeSha256,
      derivative.format,
    );
    try {
      await storage.upload(toBucket, toPath, derivative.bytes, derivative.contentType);
      const publicDigest = await storage.hashObject(toBucket, toPath, HEAD_SNIFF_BYTES);
      if (
        !publicDigest ||
        publicDigest.sha256 !== derivative.record.derivative!.sha256 ||
        publicDigest.size !== derivative.record.derivative!.size ||
        detectMediaClass(publicDigest.head) !== "image" ||
        canonicalPublicContentType(toPath, publicDigest.head, "image") !== derivative.contentType
      ) {
        await storage.remove(toBucket, [toPath]).catch(() => undefined);
        warnings.push(retentionWarning(candidate, "verification_failed"));
        continue;
      }
    } catch {
      await storage.remove(toBucket, [toPath]).catch(() => undefined);
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
    const url = options.provider.buildPublicUrl(toBucket, toPath);
    if (candidate.category === "photo") {
      photoUrls.push(url);
      if (!firstPhotoUrl) firstPhotoUrl = url;
    }
    if (candidate.category === "brochure" && !firstBrochureUrl) firstBrochureUrl = url;
    const title = neutralPublicMediaTitle(
      candidate.category,
      candidate.purpose ?? null,
      sortOrder + 1,
      constructionUpdate,
      dateLabel,
    );
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
          // The window this material was routed from, carried through to
          // publication so the routing decision stays inspectable. It is the
          // Owner's own selection for a direct file, and the INHERITED outer
          // window for an entry expanded from an archive the Owner filed under
          // a specific (non-Full-Project-Archive) window. It is null in exactly
          // the two cases where no window governs the item: an entry the
          // bounded classifier routed inside a Full Project Archive, and a
          // legacy manifest written before the explicit-purpose contract.
          material_purpose: candidate.purpose ?? null,
          // Public-safe projection only: the extracted `claims` (GPS, device
          // make/model, capture time, software) stay on the private job record
          // and must never reach the anonymously readable project_media row.
          media_truth: publicMediaTruthProjection(derivative.record),
        },
      },
    });
    sortOrder += 1;
  }

  return {
    priceList,
    priceListSource,
    // Everything gathered HERE was filed by the Owner under a window. Only
    // `mergeComposedIntoMaterials` can flip this, and only for a price list it
    // found inside an archive.
    priceListFromArchive: false,
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
