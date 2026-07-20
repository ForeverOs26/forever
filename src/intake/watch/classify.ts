/**
 * TG-WATCH-001A — deterministic review-routing classification.
 *
 * Reuses the shared intake classifier (`src/intake/classify.ts`) on the
 * ORIGINAL published filename, then folds the result into the four review
 * buckets the Owner cares about, with deterministic message-text keyword
 * hints (English and Russian — the languages The Title channels publish in)
 * for bare media that carries no classifiable filename.
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

/** Deterministic keyword hints from the message text; hints, never facts. */
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
  if (category === "photo" || category === "video") return "construction_media";
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
 * Classify one attachment. Precedence:
 *  1. the shared intake classifier over the original filename (a filename
 *     like "CLK - Price List V.2.pdf" is the strongest routing signal);
 *  2. for bare media (photo/video) or unclassified files, deterministic
 *     message-text hints;
 *  3. photo/video without any hint remains construction media (the ordinary
 *     content of these channels); everything else falls to "other".
 */
export function classifyAttachment(
  attachment: Pick<NormalizedAttachment, "original_filename" | "kind">,
  messageTextHints: string[],
): AttachmentClassification {
  const filename = attachment.original_filename ?? "";
  const { category } = classifyPath(filename);
  const fromFilename = bucketFromCategory(category);

  // photo/video from the extension alone is the weakest filename signal —
  // let an explicit text hint refine it; a named document never gets
  // re-routed by caption keywords.
  const isBareMedia = category === "photo" || category === "video" || category === "unknown";
  if (fromFilename !== null && !isBareMedia) {
    return { intake_category: category, bucket: fromFilename, from_text_hint: false };
  }
  const fromHints = bucketFromHints(messageTextHints);
  if (fromHints !== null) {
    return { intake_category: category, bucket: fromHints, from_text_hint: true };
  }
  if (fromFilename !== null) {
    return { intake_category: category, bucket: fromFilename, from_text_hint: false };
  }
  if (attachment.kind === "photo") {
    return { intake_category: category, bucket: "construction_media", from_text_hint: false };
  }
  return { intake_category: category, bucket: "other", from_text_hint: false };
}
