/**
 * FOREVER-STUDIO-R2-MANUAL-E2E-FAILURE-FORENSICS-006 — the honest final state.
 * Corrected by FOREVER-PR141-PR142-EVIDENCE-REVIEW-CORRECTIONS-007.
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
 * THE DURABLE PRODUCT RULE IS PRESERVED: every Studio material window is
 * OPTIONAL, and incomplete business data creates no new approval gate. Material
 * that was never supplied produces no warning, so it can never reach this
 * module and can never degrade a verdict. A facts-only publication remains a
 * legitimate `complete`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FIRST REVISION GOT WRONG (corrected here)
 * ---------------------------------------------------------------------------
 *
 * 1. IT RECONCILED CLIENT AND SERVER SKIPS WITH `Math.max`. That assumes one
 *    set is a SUBSET of the other, which is an identity claim, and no identity
 *    evidence exists: server warnings are redacted by `fileWarning`, which
 *    replaces every occurrence of the original filename with the literal
 *    "Private source file" and sets `payload.file` to the same constant. The
 *    browser's `failedUploads` carries real filenames. There is NO shared
 *    identifier, so the two observations cannot be matched, deduplicated or
 *    summed. **They are now reported as two independent counts and two
 *    independent booleans, and never combined into one number.**
 *
 * 2. IT TREATED EVERY COUNTED WARNING AS A SKIPPED SOURCE. The vocabulary is
 *    wider than that: some codes mean an intentional, harmless duplicate; some
 *    mean the original is safely retained and only the PUBLIC derivative was
 *    withheld; some mean publication was deferred. Classifying all of them as
 *    failures would be dishonest in the other direction. The full audited
 *    taxonomy is below.
 *
 * 3. IT LEFT CRITICAL WARNINGS INSIDE A COLLAPSED "notes for later enrichment"
 *    SECTION. A source that never arrived, or that was rejected, is not a note.
 *    `criticalWarnings` exists so the caller can render those directly.
 *
 * ---------------------------------------------------------------------------
 * THE THREE LEVELS
 * ---------------------------------------------------------------------------
 *
 *   - `failed`    — the job did not publish a page at all, OR a page exists but
 *                   carries no content AND a critical problem was observed.
 *                   That second clause is the measured case: an empty page
 *                   produced BECAUSE the uploads failed is a failure, not a
 *                   success with a note.
 *   - `partial`   — a page exists and carries content, but a critical problem
 *                   was observed.
 *   - `complete`  — a page exists and no critical problem was observed.
 *
 * An empty page with NO critical problem stays `complete`. That case is not the
 * defect being repaired and reclassifying it would be inventing a product rule.
 */

import type { StudioJobResult, StudioJobStatus, StudioWarningSummary } from "./studio-types";

/**
 * What a warning code MEANS. Six classes, and only the first two are critical.
 *
 *   - `delivery_failure`     — the bytes never arrived. The Owner must supply
 *                              the file again; nothing else can recover it.
 *   - `source_rejected`      — the bytes arrived but the source could not be
 *                              used in the role it was filed under. Only a
 *                              corrected or different file changes the outcome.
 *   - `retained_private`     — the ORIGINAL is stored and intact; only the
 *                              public derivative was withheld. No Owner action
 *                              changes it today. Not a failure.
 *   - `deferred_publication` — retained now, processable or publishable later.
 *                              Not a failure.
 *   - `harmless_duplicate`   — a deliberate no-op: the same bytes, or a second
 *                              price list, already accounted for. Not a loss.
 *   - `enrichment_note`      — informational; the material was ingested.
 */
export type WarningClass =
  | "delivery_failure"
  | "source_rejected"
  | "retained_private"
  | "deferred_publication"
  | "harmless_duplicate"
  | "enrichment_note";

/**
 * THE AUDITED VOCABULARY.
 *
 * Every warning code that can reach the browser is classified here explicitly.
 * The set is not guessed and not prefix-matched: `publication-outcome.test.ts`
 * extracts the codes MECHANICALLY from the `fileWarning` / `archiveWarning` /
 * `neutralWarning` call sites in `server/` and fails if any code is missing
 * from this map, so a newly introduced warning cannot silently default to
 * "enrichment note".
 *
 * Each classification is justified by the message the server actually emits.
 */
export const WARNING_CLASSIFICATION: Readonly<Record<string, WarningClass>> = {
  // "was declared but never arrived in storage; continuing without it."
  file_upload_missing: "delivery_failure",

  // "could not be read back." / "could not be parsed as JSON; the file was
  // retained for later review." — arrived, unusable as filed.
  file_unreadable: "source_rejected",
  // "exceeds the N MB limit; it was retained privately and skipped."
  file_oversized: "source_rejected",
  // "is not a valid <category>" / "does not look like a valid <category>;
  // it was retained privately and not published."
  media_class_mismatch: "source_rejected",
  // "is JSON but matches no supported structured artifact; retained."
  structured_artifact_unrecognized: "source_rejected",
  // Filed under a window that admits no structured artifact.
  structured_purpose_mismatch: "source_rejected",
  // "is not a ZIP archive; the file was retained unexpanded."
  archive_format_unsupported: "source_rejected",
  // "was rejected by archive safety checks (...); it was retained privately."
  archive_rejected_unsafe: "source_rejected",
  // "failed integrity verification mid-archive; remaining entries were
  // retained unexpanded."
  archive_entry_integrity_failed: "source_rejected",
  archive_too_large: "source_rejected",

  // "could not be safely sanitized and verified for public delivery; it
  // remains private." The original is intact and stored.
  media_sanitization_failed: "retained_private",
  // "uses a format that Forever cannot safely sanitize ... yet".
  media_sanitization_unsupported: "retained_private",
  // "exceeds the bounded public-media transformation limit and remains
  // private."
  media_sanitization_limit: "retained_private",
  // "carries an embedded color profile that Forever cannot yet re-render
  // safely for public delivery; it remains private."
  media_color_profile_unsupported: "retained_private",

  // "could not be published to the public gallery just now; it was retained
  // privately." Transient, and retryable without the Owner re-supplying bytes.
  media_publish_deferred: "deferred_publication",
  // "is too large to parse ... it was retained privately for later
  // extraction." The bytes are held; extraction is what was deferred.
  file_too_large_to_parse: "deferred_publication",

  // "is byte-identical to <other>; the duplicate was skipped."
  duplicate_media_ignored: "harmless_duplicate",
  // "A price list was already provided; <name> was retained but not applied."
  price_list_duplicate_ignored: "harmless_duplicate",

  // "declared N bytes but M bytes were stored; the stored bytes are
  // authoritative." The file WAS ingested and used.
  file_declared_size_mismatch: "enrichment_note",
};

/** The classes that must be visible in the final result, never collapsed. */
export const CRITICAL_WARNING_CLASSES = ["delivery_failure", "source_rejected"] as const;

/**
 * The classes that describe material which arrived intact but is not on the
 * public page. Visible, but not alarming, and NOT a failure: the Owner has lost
 * nothing and there is no action for them to take.
 */
export const RETAINED_WARNING_CLASSES = ["retained_private", "deferred_publication"] as const;

/**
 * Unknown codes classify as `enrichment_note` so an unrecognised warning can
 * never fabricate a failure. The vocabulary test is what stops that default
 * being reached silently — see `WARNING_CLASSIFICATION`.
 */
export function classifyWarning(code: string): WarningClass {
  return WARNING_CLASSIFICATION[code] ?? "enrichment_note";
}

export function isCriticalWarning(warning: StudioWarningSummary): boolean {
  const cls = classifyWarning(warning.code);
  return cls === "delivery_failure" || cls === "source_rejected";
}

export function isRetainedWarning(warning: StudioWarningSummary): boolean {
  const cls = classifyWarning(warning.code);
  return cls === "retained_private" || cls === "deferred_publication";
}

export function countWarningsByClass(
  warnings: readonly StudioWarningSummary[],
): Readonly<Record<WarningClass, number>> {
  const counts: Record<WarningClass, number> = {
    delivery_failure: 0,
    source_rejected: 0,
    retained_private: 0,
    deferred_publication: 0,
    harmless_duplicate: 0,
    enrichment_note: 0,
  };
  for (const warning of warnings) counts[classifyWarning(warning.code)] += 1;
  return counts;
}

export type PublicationOutcomeLevel = "complete" | "partial" | "failed";

export interface PublicationOutcome {
  readonly level: PublicationOutcomeLevel;
  /** The heading. Never the word "Published" unless a page truly published. */
  readonly title: string;
  /** One honest sentence. Never claims completeness the run did not reach. */
  readonly description: string;
  /** True only for `complete`. The one flag a caller may treat as success. */
  readonly ok: boolean;
  /** True when the page carries no units, no prices and no media. */
  readonly producedNothing: boolean;

  // --- The BROWSER's own observation. Independent. -------------------------
  /** Files this browser abandoned. Real names; the browser is allowed them. */
  readonly clientFailedUploadNames: readonly string[];
  readonly clientFailedUploadCount: number;
  readonly clientObservedFailure: boolean;

  // --- The SERVER's observation. Independent, and REDACTED. ----------------
  readonly serverDeliveryFailureCount: number;
  readonly serverRejectedSourceCount: number;
  readonly serverRetainedPrivateCount: number;
  readonly serverDeferredPublicationCount: number;
  readonly serverHarmlessDuplicateCount: number;
  readonly serverEnrichmentNoteCount: number;
  readonly serverObservedCriticalProblem: boolean;

  /** Server warnings that must be rendered directly, never collapsed. */
  readonly criticalWarnings: readonly StudioWarningSummary[];
  /** Retained / deferred material: shown plainly, but not as a failure. */
  readonly retainedWarnings: readonly StudioWarningSummary[];
  /** Everything else: safe to collapse. */
  readonly enrichmentWarnings: readonly StudioWarningSummary[];
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
 * THE TWO OBSERVERS ARE NEVER MERGED. `failedUploads` is the BROWSER's record
 * of transfers that did not complete; the warnings are the SERVER's record of
 * sources that did not contribute. A transfer the browser abandoned may never
 * produce a server warning (the server never heard of the bytes), and a source
 * can be rejected server-side without the browser noticing. Whether they
 * describe the SAME files is UNKNOWABLE from this data — the server's warnings
 * are redacted to "Private source file" and carry no identifier the client
 * record shares. Summing would double-count; taking the greater would assume a
 * subset relationship that is equally unevidenced. Both counts are therefore
 * reported, separately, and the verdict is driven by two independent booleans.
 */
export function describePublicationOutcome(input: {
  readonly status: StudioJobStatus;
  readonly pagePath: string | null;
  readonly counts: StudioJobResult["counts"];
  readonly warnings: readonly StudioWarningSummary[];
  readonly failedUploads: readonly string[];
}): PublicationOutcome {
  const byClass = countWarningsByClass(input.warnings);
  const criticalWarnings = input.warnings.filter(isCriticalWarning);
  const retainedWarnings = input.warnings.filter(isRetainedWarning);
  const enrichmentWarnings = input.warnings.filter(
    (warning) => !isCriticalWarning(warning) && !isRetainedWarning(warning),
  );

  const clientFailedUploadCount = input.failedUploads.length;
  const clientObservedFailure = clientFailedUploadCount > 0;
  const serverObservedCriticalProblem = criticalWarnings.length > 0;
  const anyCriticalProblem = clientObservedFailure || serverObservedCriticalProblem;

  // Only a DELIVERY problem justifies "did not finish uploading". A rejected
  // source arrived; saying it did not would send the Owner to fix the wrong
  // thing, which is the same class of error this whole correction is about.
  const deliveryProblem = clientObservedFailure || byClass.delivery_failure > 0;
  const producedNothing = producedNoContent(input.counts);
  // `status` is the authority on whether the run published, and it is the ONLY
  // authority. `pagePath` is documented as "the public page path WHEN A PAGE
  // EXISTS" — it is legitimately null for a published run that produces no
  // public page, so requiring it here would invent a product rule and report
  // healthy runs as failures.
  const published = input.status === "published";

  const base = {
    producedNothing,
    clientFailedUploadNames: [...input.failedUploads],
    clientFailedUploadCount,
    clientObservedFailure,
    serverDeliveryFailureCount: byClass.delivery_failure,
    serverRejectedSourceCount: byClass.source_rejected,
    serverRetainedPrivateCount: byClass.retained_private,
    serverDeferredPublicationCount: byClass.deferred_publication,
    serverHarmlessDuplicateCount: byClass.harmless_duplicate,
    serverEnrichmentNoteCount: byClass.enrichment_note,
    serverObservedCriticalProblem,
    criticalWarnings,
    retainedWarnings,
    enrichmentWarnings,
  };

  if (!published) {
    return {
      ...base,
      level: "failed",
      ok: false,
      title: "Not published",
      description: anyCriticalProblem
        ? "No page was published, and some files did not make it through. Nothing was lost — check the details below and try again."
        : "No page was published. Nothing was lost — you can try again.",
    };
  }

  if (producedNothing && anyCriticalProblem) {
    return {
      ...base,
      level: "failed",
      ok: false,
      title: "Published, but empty",
      description: deliveryProblem
        ? "The page went live with no units, prices or media, because the files it needed never finished uploading. Upload them again to fill it in."
        : "The page went live with no units, prices or media, because the files it needed could not be used. Check the details below and supply them again.",
    };
  }

  if (anyCriticalProblem) {
    return {
      ...base,
      level: "partial",
      ok: false,
      title: "Partly published",
      description: deliveryProblem
        ? "The page is live, but some files did not finish uploading and are not on it yet. Upload them again to complete it."
        : "The page is live, but some files could not be used and are not on it yet. Check the details below.",
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
