/**
 * Forever Project Sources — the source descriptor.
 *
 * A {@link ProjectSourceDescriptor} classifies *what* a catalogued document is:
 * its document type, its file format, and the optional language and dates that
 * situate it. The vocabularies are closed and include an explicit `"unknown"`
 * so a document that cannot yet be classified is represented rather than
 * dropped (anti-fabrication). Both dates are supplied by the caller — RC4.4
 * reads no clock — and are omitted when not known, never coerced to a
 * placeholder.
 *
 * The vocabularies deliberately bridge to the neighbouring foundations rather
 * than replacing them: every document type maps deterministically onto the
 * canonical RC3.0 {@link ForeverDocumentType}, and a file format maps onto the
 * RC3.1 {@link ImportFormat} and RC3.0 {@link ForeverMediaType} where a direct
 * counterpart exists — mirroring the RC3.3 `sourceTypeToImportFormat` bridge,
 * so a catalogued source lines up with the import and canonical-record paths
 * that will later consume it.
 */

import type {
  ForeverDocumentType,
  ForeverMediaType,
  ISODate,
  ISODateTime,
} from "@/features/forever-database";
import type { ImportFormat } from "@/features/forever-import";

/**
 * The closed vocabulary of document types the registry can catalogue.
 *
 * Extends the canonical RC3.0 vocabulary with the intake-facing kinds RC4.4
 * must describe (contracts, marketing materials, specifications, developer
 * updates); {@link projectSourceDocumentTypeToForeverDocumentType} maps every
 * kind back onto the RC3.0 canonical vocabulary.
 */
export type ProjectSourceDocumentType =
  | "price_list"
  | "brochure"
  | "floor_plan"
  | "master_plan"
  | "unit_plan"
  | "payment_plan"
  | "contract"
  | "legal_document"
  | "marketing_material"
  | "specification"
  | "developer_update"
  | "unknown";

/** Every {@link ProjectSourceDocumentType}, in a stable declared order. */
export const PROJECT_SOURCE_DOCUMENT_TYPES = [
  "price_list",
  "brochure",
  "floor_plan",
  "master_plan",
  "unit_plan",
  "payment_plan",
  "contract",
  "legal_document",
  "marketing_material",
  "specification",
  "developer_update",
  "unknown",
] as const satisfies readonly ProjectSourceDocumentType[];

/** Runtime guard: whether a value is a known {@link ProjectSourceDocumentType}. */
export function isKnownProjectSourceDocumentType(
  value: unknown,
): value is ProjectSourceDocumentType {
  return (
    typeof value === "string" &&
    (PROJECT_SOURCE_DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

/** Deterministic canonical RC3.0 document type for each registry document type. */
const DOCUMENT_TYPE_TO_FOREVER: Record<ProjectSourceDocumentType, ForeverDocumentType> = {
  price_list: "price_list",
  brochure: "brochure",
  floor_plan: "floor_plan",
  master_plan: "master_plan",
  unit_plan: "unit_plan",
  payment_plan: "payment_plan",
  contract: "legal",
  legal_document: "legal",
  marketing_material: "other",
  specification: "other",
  developer_update: "other",
  unknown: "other",
};

/**
 * The canonical RC3.0 {@link ForeverDocumentType} a registry document type
 * corresponds to.
 *
 * Total and deterministic: every registry kind maps to exactly one canonical
 * kind (the RC3.0 vocabulary's `legal` and `other` absorb the finer intake
 * kinds), so a catalogued source always lines up with the canonical record it
 * will evidence.
 */
export function projectSourceDocumentTypeToForeverDocumentType(
  type: ProjectSourceDocumentType,
): ForeverDocumentType {
  return DOCUMENT_TYPE_TO_FOREVER[type];
}

/**
 * The closed vocabulary of file formats a catalogued source may arrive in.
 *
 * `"image"` and `"video"` cover the media formats; `"unknown"` explicitly
 * represents a format that cannot yet be classified.
 */
export type ProjectSourceFileFormat =
  | "pdf"
  | "image"
  | "video"
  | "excel"
  | "csv"
  | "json"
  | "text"
  | "archive"
  | "unknown";

/** Every {@link ProjectSourceFileFormat}, in a stable declared order. */
export const PROJECT_SOURCE_FILE_FORMATS = [
  "pdf",
  "image",
  "video",
  "excel",
  "csv",
  "json",
  "text",
  "archive",
  "unknown",
] as const satisfies readonly ProjectSourceFileFormat[];

/** Runtime guard: whether a value is a known {@link ProjectSourceFileFormat}. */
export function isKnownProjectSourceFileFormat(value: unknown): value is ProjectSourceFileFormat {
  return (
    typeof value === "string" && (PROJECT_SOURCE_FILE_FORMATS as readonly string[]).includes(value)
  );
}

/**
 * The Forever Import (RC3.1) format a file format maps to, or `undefined` when
 * the format has no direct import format. A deterministic, partial bridge — it
 * reuses the RC3.1 vocabulary rather than inventing a parallel one, mirroring
 * the RC3.3 `sourceTypeToImportFormat` bridge.
 */
export function projectSourceFileFormatToImportFormat(
  format: ProjectSourceFileFormat,
): ImportFormat | undefined {
  switch (format) {
    case "pdf":
      return "pdf";
    case "excel":
      return "excel";
    case "csv":
      return "csv";
    case "json":
      return "json";
    default:
      return undefined;
  }
}

/**
 * The canonical RC3.0 {@link ForeverMediaType} a file format maps to, or
 * `undefined` for non-media formats. A deterministic, partial bridge: only the
 * media formats have a media counterpart — a PDF is evidence (a Document),
 * never Media.
 */
export function projectSourceFileFormatToMediaType(
  format: ProjectSourceFileFormat,
): ForeverMediaType | undefined {
  switch (format) {
    case "image":
      return "image";
    case "video":
      return "video";
    default:
      return undefined;
  }
}

/** The classification of one catalogued document. */
export interface ProjectSourceDescriptor {
  documentType: ProjectSourceDocumentType;
  fileFormat: ProjectSourceFileFormat;
  /** Language of the document's content, e.g. `en` or `th`, when known. */
  language?: string;
  /** When the document entered the ecosystem, supplied by the caller. */
  uploadedAt?: ISODateTime;
  /** The date the document itself is dated, when the document states one. */
  documentDate?: ISODate;
}

/** Options accepted by {@link projectSourceDescriptor}. */
export interface ProjectSourceDescriptorOptions {
  language?: string;
  uploadedAt?: ISODateTime;
  documentDate?: ISODate;
}

/**
 * Build a {@link ProjectSourceDescriptor}; optional facts are attached only
 * when supplied so an absent fact stays absent (anti-fabrication).
 */
export function projectSourceDescriptor(
  documentType: ProjectSourceDocumentType,
  fileFormat: ProjectSourceFileFormat,
  options: ProjectSourceDescriptorOptions = {},
): ProjectSourceDescriptor {
  const descriptor: ProjectSourceDescriptor = { documentType, fileFormat };
  if (options.language !== undefined) descriptor.language = options.language;
  if (options.uploadedAt !== undefined) descriptor.uploadedAt = options.uploadedAt;
  if (options.documentDate !== undefined) descriptor.documentDate = options.documentDate;
  return descriptor;
}
