/**
 * FOREVER-STUDIO-R2-MANUAL-E2E-FAILURE-FORENSICS-006 — the honest final state.
 *
 * ---------------------------------------------------------------------------
 * THE MEASURED DEFECT
 * ---------------------------------------------------------------------------
 *
 * A manual end-to-end attempt uploaded a price list and three photographs. All
 * four failed to upload. The browser KNEW they had failed — it collected them
 * into `failedUploads` and rendered them — and the server knew too: each became
 * a `file_upload_missing` warning. Processing then continued without them and
 * the run finished with `0 units`, `0 prices`, `0 media`.
 *
 * The final screen said:
 *
 *     Published
 *     The page is live now. Anything missing can be added later.
 *
 * That heading was computed from nothing. It was a constant. The failure detail
 * was rendered BELOW it, so the screen simultaneously claimed success and
 * listed the four files that made success impossible — and the headline is what
 * a reader believes.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE DOES, AND DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It derives the final verdict from facts the run already produced. It invents
 * NO new product rule about which materials are required: the existing pipeline
 * already decides that, and it already reports the outcome as counts plus a
 * closed set of warning codes. This module only refuses to describe those facts
 * dishonestly.
 *
 * Three levels, and the rule for each:
 *
 *   - `failed`    — the job did not publish a page at all, OR a page exists but
 *                   carries no content AND declared sources were skipped. That
 *                   second clause is the measured case: an empty page produced
 *                   BECAUSE the uploads failed is a failure, not a success with
 *                   a note.
 *   - `partial`   — a page exists and carries content, but at least one declared
 *                   source never reached processing.
 *   - `complete`  — a page exists and every declared source reached processing.
 *
 * An empty page with NO skipped sources stays `complete`. That case is not the
 * defect being repaired and reclassifying it would be inventing a product rule
 * — a facts-only project update legitimately produces no units, prices or media.
 */

import type { StudioJobResult, StudioJobStatus, StudioWarningSummary } from "./studio-types";

/**
 * Warning codes that each mean THE SAME THING for this purpose: a source the
 * Owner declared did not contribute to the published result.
 *
 * Enumerated rather than pattern-matched on the `file_` prefix, because not
 * every `file_` warning is a skip — `file_declared_size_mismatch` describes a
 * file that WAS ingested, and treating it as a skip would report a healthy run
 * as partial.
 */
export const SKIPPED_SOURCE_WARNING_CODES = [
  "file_upload_missing",
  "file_unreadable",
  "file_oversized",
  "file_too_large_to_parse",
] as const;

export type PublicationOutcomeLevel = "complete" | "partial" | "failed";

export interface PublicationOutcome {
  readonly level: PublicationOutcomeLevel;
  /** The heading. Never the word "Published" unless a page truly published. */
  readonly title: string;
  /** One honest sentence. Never claims completeness the run did not reach. */
  readonly description: string;
  /** Declared sources the Owner named that did not reach processing. */
  readonly skippedSourceNames: readonly string[];
  /** How many declared sources were skipped, from BOTH client and server. */
  readonly skippedSourceCount: number;
  /** True when the page carries no units, no prices and no media. */
  readonly producedNothing: boolean;
  /** True only for `complete`. The one flag a caller may treat as success. */
  readonly ok: boolean;
}

export function countSkippedSourceWarnings(warnings: readonly StudioWarningSummary[]): number {
  const codes = new Set<string>(SKIPPED_SOURCE_WARNING_CODES);
  return warnings.filter((warning) => codes.has(warning.code)).length;
}

/**
 * PROVABLY empty — not merely unknown.
 *
 * A null `counts` block means the run reported no tally, which is not the same
 * as reporting zero. Treating null as empty would make the screen assert an
 * emptiness it cannot know, and "Published, but empty" is a strong claim: it
 * tells the Owner their page has nothing on it. It is only made when the run
 * actually counted, and counted nothing.
 */
export function producedNoContent(counts: StudioJobResult["counts"]): boolean {
  if (!counts) return false;
  return counts.units === 0 && counts.prices === 0 && counts.media === 0;
}

/**
 * The honest final state.
 *
 * `failedUploads` is the BROWSER's own record of transfers that did not
 * complete. It is counted alongside the server's warnings and the two are
 * reconciled by taking the greater: a transfer the browser abandoned may never
 * produce a server-side warning (the server never heard of the bytes), and a
 * source can be skipped server-side without the browser noticing. Summing them
 * would double-count the normal case where both observed the same loss.
 */
export function describePublicationOutcome(input: {
  readonly status: StudioJobStatus;
  readonly pagePath: string | null;
  readonly counts: StudioJobResult["counts"];
  readonly warnings: readonly StudioWarningSummary[];
  readonly failedUploads: readonly string[];
}): PublicationOutcome {
  const serverSkips = countSkippedSourceWarnings(input.warnings);
  const clientSkips = input.failedUploads.length;
  const skippedSourceCount = Math.max(serverSkips, clientSkips);
  const producedNothing = producedNoContent(input.counts);
  // `status` is the authority on whether the run published, and it is the ONLY
  // authority. `pagePath` is documented as "the public page path WHEN A PAGE
  // EXISTS" — it is legitimately null for a published run that produces no
  // public page, so requiring it here would invent a product rule and report
  // healthy runs as failures.
  const published = input.status === "published";

  const base = {
    skippedSourceNames: [...input.failedUploads],
    skippedSourceCount,
    producedNothing,
  };

  if (!published) {
    return {
      ...base,
      level: "failed",
      ok: false,
      title: "Not published",
      description:
        skippedSourceCount > 0
          ? "No page was published, and some files never finished uploading. Nothing was lost — upload them again to retry."
          : "No page was published. Nothing was lost — you can try again.",
    };
  }

  if (producedNothing && skippedSourceCount > 0) {
    return {
      ...base,
      level: "failed",
      ok: false,
      title: "Published, but empty",
      description:
        "The page went live with no units, prices or media, because the files it needed never finished uploading. Upload them again to fill it in.",
    };
  }

  if (skippedSourceCount > 0) {
    return {
      ...base,
      level: "partial",
      ok: false,
      title: "Partly published",
      description:
        "The page is live, but some files did not finish uploading and are not on it yet. Upload them again to complete it.",
    };
  }

  return {
    ...base,
    level: "complete",
    ok: true,
    title: "Published",
    description: "The page is live now. Anything missing can be added later.",
  };
}
