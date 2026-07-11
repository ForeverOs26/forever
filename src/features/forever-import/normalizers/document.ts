/**
 * Forever Import — document normalizer.
 *
 * Turns a loosely-typed document record from a source into the canonical
 * document shape (minus the surrogate ids that binding assigns later). Like
 * media, a document is defined by the file it points at, so a candidate with no
 * valid URL normalizes to `undefined`.
 */

import type { ForeverDocumentType, VerificationStatus } from "@/features/forever-database";

import { normalizeBoolean, normalizeNumber, normalizeString, normalizeUrl } from "./primitives";

/** Loosely-typed document as it arrives from a source, before normalization. */
export interface RawDocumentInput {
  documentType?: unknown;
  title?: unknown;
  url?: unknown;
  description?: unknown;
  label?: unknown;
  note?: unknown;
  fileExtension?: unknown;
  verificationStatus?: unknown;
  sortOrder?: unknown;
  isPublic?: unknown;
}

/**
 * Canonical document without ids.
 *
 * Binding later attaches `id` and `projectId` to produce a full
 * `ForeverDocument`.
 */
export interface NormalizedDocument {
  documentType: ForeverDocumentType;
  title: string;
  url: string;
  description?: string;
  label?: string;
  note?: string;
  fileExtension?: string;
  verificationStatus?: VerificationStatus;
  sortOrder: number;
  isPublic: boolean;
}

/** Classify a free-text document kind into the canonical {@link ForeverDocumentType}. */
export function normalizeDocumentType(value: unknown): ForeverDocumentType {
  const v = normalizeString(value)?.toLowerCase();
  if (!v) return "other";
  if (v.includes("brochure")) return "brochure";
  if (v.includes("price")) return "price_list";
  if (v.includes("payment")) return "payment_plan";
  if (v.includes("unit")) return "unit_plan";
  if (v.includes("floor")) return "floor_plan";
  if (v.includes("master")) return "master_plan";
  if (v.includes("legal") || v.includes("contract") || v.includes("title")) return "legal";
  return "other";
}

function normalizeVerificationStatus(value: unknown): VerificationStatus | undefined {
  const v = normalizeString(value)?.toLowerCase();
  if (v === "unverified" || v === "pending" || v === "verified") return v;
  return undefined;
}

/** Derive a lowercase file extension from a URL or explicit hint, sans dot. */
function deriveExtension(explicit: unknown, url: string): string | undefined {
  const hint = normalizeString(explicit);
  if (hint !== undefined) return hint.replace(/^\./, "").toLowerCase();
  const match = /\.([a-z0-9]{1,8})(?:[?#].*)?$/i.exec(url);
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Normalize one document candidate.
 *
 * Returns `undefined` when the source carries no valid `http(s)` URL. The file
 * extension is taken from an explicit hint when present, otherwise derived
 * deterministically from the URL path.
 */
export function normalizeDocument(input: RawDocumentInput): NormalizedDocument | undefined {
  const url = normalizeUrl(input.url);
  if (url === undefined) return undefined;

  const document: NormalizedDocument = {
    documentType: normalizeDocumentType(input.documentType),
    title: normalizeString(input.title) ?? "",
    url,
    sortOrder: normalizeNumber(input.sortOrder) ?? 0,
    isPublic: normalizeBoolean(input.isPublic) ?? true,
  };

  const description = normalizeString(input.description);
  if (description !== undefined) document.description = description;
  const label = normalizeString(input.label);
  if (label !== undefined) document.label = label;
  const note = normalizeString(input.note);
  if (note !== undefined) document.note = note;
  const fileExtension = deriveExtension(input.fileExtension, url);
  if (fileExtension !== undefined) document.fileExtension = fileExtension;
  const verificationStatus = normalizeVerificationStatus(input.verificationStatus);
  if (verificationStatus !== undefined) document.verificationStatus = verificationStatus;

  return document;
}
