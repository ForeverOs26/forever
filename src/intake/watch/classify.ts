/**
 * TG-WATCH-001A — deterministic review-routing classification.
 *
 * Reuses the shared intake classifier (`src/intake/classify.ts`) on the
 * ORIGINAL published filename, then folds the result into review buckets,
 * with deterministic keyword hints (English and Russian — the languages The
 * Title channels publish in) taken from the filename and the message caption.
 *
 * CONSERVATIVE by design: a bucket requires a deterministic source signal —
 * a classifiable filename, a filename keyword, or a caption keyword. Bare
 * media without any signal is routed to `manual_review_required`, never
 * assumed to be construction media. Archives are opaque containers and are
 * never hint-routed.
 *
 * Routing only. A bucket decides which review section an item appears in and
 * which follow-up command is RECOMMENDED; it is never a fact about the
 * document and never triggers extraction automatically.
 */

import { classifyPath } from "../classify";
import type { AttachmentClassification, NormalizedAttachment, WatchBucket } from "./types";

/** Ordered, first match wins. Lowercased haystack. */
const TEXT_HINT_RULES: ReadonlyArray<{ hint: string; test: (h: string) => boolean }> = [
  {
    hint: "master-plan",
    test: (h) =>
      h.includes("master plan") ||
      h.includes("masterplan") ||
      h.includes("master-plan") ||
      h.includes("мастер-план") ||
      h.includes("мастер план"),
  },
  {
    hint: "price-list",
    test: (h) =>
      (h.includes("price") && h.includes("list")) || h.includes("pricelist") || h.includes("прайс"),
  },
  {
    hint: "construction",
    test: (h) =>
      h.includes("construction") ||
      (h.includes("progress") && !h.includes("progressive")) ||
      h.includes("строительств") ||
      h.includes("стройк"),
  },
  {
    hint: "promotion",
    test: (h) =>
      h.includes("promotion") ||
      h.includes("promo") ||
      h.includes("discount") ||
      h.includes("акци") ||
      h.includes("скидк"),
  },
  {
    hint: "brochure",
    test: (h) => h.includes("brochure") || h.includes("брошюр"),
  },
];

/** Deterministic keyword hints from a text (caption or filename); hints, never facts. */
export function textHints(text: string): string[] {
  const haystack = text.toLowerCase();
  return TEXT_HINT_RULES.filter((rule) => rule.test(haystack)).map((rule) => rule.hint);
}

const DOCUMENT_CATEGORIES: ReadonlySet<string> = new Set([
  "brochure",
  "legal-document",
  "developer-profile",
  "payment-plan",
  "floor-plan",
  "unit-plan",
  "map-location",
  "furniture-package",
  "project-facts",
]);

function bucketFromCategory(category: string): WatchBucket | null {
  if (category === "price-list") return "price_table";
  if (category === "master-plan") return "visual_master_plan";
  // An archive is an opaque container: quarantined as bytes, never routed by
  // caption keywords, extracted only later behind Fast Intake's hardened
  // ZIP boundary after Owner review.
  if (category === "archive") return "other";
  if (DOCUMENT_CATEGORIES.has(category)) return "document";
  return null;
}

function bucketFromHints(hints: string[]): WatchBucket | null {
  if (hints.includes("master-plan")) return "visual_master_plan";
  if (hints.includes("price-list")) return "price_table";
  if (hints.includes("construction")) return "construction_media";
  if (hints.includes("promotion") || hints.includes("brochure")) return "document";
  return null;
}

/**
 * Classify one attachment. Precedence (all deterministic, first match wins):
 *  1. the shared intake classifier over the original filename (a filename
 *     like "CLK - Price List V.2.pdf" is the strongest routing signal);
 *  2. keyword hints in the FILENAME itself (e.g. "construction-july.mp4");
 *  3. keyword hints in the message caption (bare media and unknown files
 *     only — a named document or archive is never re-routed by a caption);
 *  4. no signal: photo/video → `manual_review_required`; anything else →
 *     `other`. Nothing is assumed to be construction media without a signal.
 */
export function classifyAttachment(
  attachment: Pick<NormalizedAttachment, "original_filename" | "kind">,
  messageTextHints: string[],
): AttachmentClassification {
  const filename = attachment.original_filename ?? "";
  const { category } = classifyPath(filename);
  const filenameHints = textHints(filename);

  // A filename that explicitly says "master plan" is routed as the visual
  // master plan even when it also contains "price list" (for example,
  // "Master Plan Price list"). The shared classifier intentionally gives
  // price-list keywords priority for generic Fast Intake routing; that is too
  // broad for this review bucket because a master-plan document is not a
  // candidate price table.
  if (filenameHints.includes("master-plan")) {
    return { intake_category: "master-plan", bucket: "visual_master_plan", from_text_hint: false };
  }
  const fromFilename = bucketFromCategory(category);

  // A category derived from the filename's own words (or the archive rule)
  // wins outright; extension-only media and unknown files fall through to
  // the weaker hint signals.
  const isBareMedia = category === "photo" || category === "video" || category === "unknown";
  if (fromFilename !== null && !isBareMedia) {
    return { intake_category: category, bucket: fromFilename, from_text_hint: false };
  }
  const fromFilenameHints = bucketFromHints(filenameHints);
  if (fromFilenameHints !== null) {
    return { intake_category: category, bucket: fromFilenameHints, from_text_hint: false };
  }
  const fromCaptionHints = bucketFromHints(messageTextHints);
  if (fromCaptionHints !== null) {
    return { intake_category: category, bucket: fromCaptionHints, from_text_hint: true };
  }
  if (category === "photo" || category === "video" || attachment.kind === "photo") {
    return { intake_category: category, bucket: "manual_review_required", from_text_hint: false };
  }
  return { intake_category: category, bucket: "other", from_text_hint: false };
}
