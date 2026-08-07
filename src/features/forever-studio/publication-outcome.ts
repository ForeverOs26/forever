/**
 * FOREVER-STUDIO-R2-MANUAL-E2E-FAILURE-FORENSICS-006 — the honest final state.
 * Corrected by FOREVER-PR141-PR142-EVIDENCE-REVIEW-CORRECTIONS-007.
 *
 * ---------------------------------------------------------------------------
 * THE MEASURED DEFECT
 * ---------------------------------------------------------------------------
 *
 * A manual end-to-end attempt declared a price list and three photographs. None
 * of the four reached the page. The browser could not confirm completion — it
 * collected them into `failedUploads` and rendered them — and processing could
 * not find them through their declared storage path, so each became a
 * `file_upload_missing` warning. Processing then continued without them and the
 * run finished with `0 units`, `0 prices`, `0 media`. What physically happened
 * to those bytes is UNRESOLVED — see THE EVIDENCE BOUNDARY below.
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
 *    SECTION. A source that did not reach the page, or that was rejected, is
 *    not a note. `criticalWarnings` exists so the caller can render those
 *    directly.
 *
 * ---------------------------------------------------------------------------
 * THE EVIDENCE BOUNDARY (FOREVER-PR141-PR142-FINAL-GATE-CORRECTIONS-008)
 * ---------------------------------------------------------------------------
 *
 * A `file_upload_missing` warning, and the `delivery_failure` class generally,
 * DO NOT PROVE THAT BYTES NEVER REACHED R2. The whole of what is observed is:
 *
 *   - the browser could not confirm completion of the transfer;
 *   - processing could not find the declared object through its storage path.
 *
 * Both are NEGATIVE READS, through the same client and the same credentialed
 * code path whose behaviour is itself in question. They are consistent with at
 * least three unresolved possibilities: the bytes never arrived; the bytes
 * arrived but the acknowledgement (or CORS on the response) failed; or an
 * object exists under a location this environment cannot enumerate. See
 * `tests/r2-object-key-contract.test.ts` for the full forensic statement.
 *
 * TWO CONSEQUENCES ARE BINDING ON EVERY STRING THIS MODULE PRODUCES:
 *
 * 1. **No wording may assert physical absence.** Not "never arrived", not "the
 *    bytes were lost", and — equally — not "nothing was lost". Both directions
 *    are claims this evidence cannot support. Only `retained_private` and
 *    `deferred_publication` may state that the original is retained, because
 *    for those the server status mechanically proves it.
 *
 * 2. **No wording may recommend an immediate re-upload.** Until the physical R2
 *    state and the transport defect are understood, re-uploading may duplicate
 *    an object that already exists, or repeat the same failure, and it destroys
 *    the forensic state needed to diagnose either. The safe guidance is
 *    `STORAGE_VERIFICATION_GUIDANCE`, below.
 *
 * THIS MODULE DOES NOT REPAIR THE TRANSPORT DEFECT. It corrects what the screen
 * SAYS about a failed run. The real browser/R2 transfer failure is unresolved,
 * and nothing here authorizes another manual upload.
 *
 * ---------------------------------------------------------------------------
 * THE THREE LEVELS
 * ---------------------------------------------------------------------------
 *
 *   - `failed`    — the job did not publish a page at all, OR a page exists but
 *                   carries no content AND a critical problem was observed.
 *                   That second clause is the measured case: an empty page
 *                   produced BECAUSE its declared sources never reached
 *                   processing is a failure, not a success with a note. Its
 *                   heading says so without leading with the word "Published" —
 *                   "Publication failed — empty page created".
 *   - `partial`   — a page exists and carries content, but a critical problem
 *                   was observed.
 *   - `complete`  — a page exists and no critical problem was observed.
 *
 * An empty page with NO critical problem stays `complete`. That case is not the
 * defect being repaired and reclassifying it would be inventing a product rule.
 *
 * ---------------------------------------------------------------------------
 * DRAFT VS LIVE (FOREVER-STUDIO-UNPUBLISHED-INGESTION-001)
 * ---------------------------------------------------------------------------
 *
 * A project upload no longer publishes anything: it creates or updates an
 * UNPUBLISHED draft, and publication is a separate authorized action. A resale
 * listing upload still does publish. One module serves both, so the wording is
 * chosen from what the run actually made public — `publicStatus` — and never
 * from the job's lifecycle status, which reads `published` for a completed job
 * in either lane and would therefore describe every new draft as live.
 *
 * `publicStatus` is also the honest answer for a job processed BEFORE this
 * change: those really did publish, they carry `publicStatus: "published"` in
 * their stored summary, and they keep the live wording they earned.
 */

import type { StudioJobResult, StudioJobStatus, StudioWarningSummary } from "./studio-types";

/**
 * What a warning code MEANS. Six classes, and only the first two are critical.
 *
 *   - `delivery_failure`     — the declared object could not be found through
 *                              its storage path when processing looked for it.
 *                              **This does NOT establish that the bytes never
 *                              reached R2.** See THE EVIDENCE BOUNDARY below.
 *                              Physical storage state is unresolved, and
 *                              storage verification is required before any
 *                              retry.
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
  // The server emits: "could not be found through its declared storage path.
  // Physical storage state is unresolved." A report of a failed LOOKUP, not a
  // proof of physical absence — see THE EVIDENCE BOUNDARY above.
  //
  // SUPERSEDED WORDING, quoted once and refuted here: runs processed before
  // FOREVER-PR142-EVIDENCE-SAFE-RENDER-009 persisted "was declared but never
  // arrived in storage; continuing without it." That sentence asserts physical
  // absence, which this evidence cannot support, and it is NEVER rendered:
  // `EVIDENCE_SAFE_WARNING_MESSAGES` derives this code's public message from the
  // code itself, so a historical message cannot reach the DOM.
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
 * The classes that describe material the server's own status mechanically
 * proves it RETAINED: the original is stored, and only the public derivative is
 * absent. Visible, but not alarming, and NOT a failure — there is no action for
 * the Owner to take. This is the one place a retention claim is evidenced, and
 * it is the only place one may be made.
 */
export const RETAINED_WARNING_CLASSES = ["retained_private", "deferred_publication"] as const;

/**
 * THE ONLY SAFE GUIDANCE FOR A DELIVERY PROBLEM, until the physical R2 state
 * and the transport defect are understood.
 *
 * The screen previously said "Upload them again any time" and "Upload them
 * again to fill it in". Both are unsafe on the present evidence: the browser's
 * failure report does not establish that the object is absent, so a re-upload
 * may duplicate an object that already exists, may repeat the same silent
 * failure, and destroys the forensic state required to tell which. Diagnosis
 * comes first.
 */
export const STORAGE_VERIFICATION_GUIDANCE =
  "Do not upload these files again yet. Storage verification is required.";

/**
 * THE MESSAGE THE SCREEN SHOWS, DERIVED FROM THE CODE — NOT FROM THE STORED TEXT.
 *
 * FOREVER-PR142-EVIDENCE-SAFE-RENDER-009. Warning messages are PERSISTED with a
 * job, so a run processed before the canonical wording was corrected still
 * carries the old sentence — which asserted that an object "never arrived in
 * storage". Rendering that raw would let one screen say physical storage state
 * is unresolved and then assert the object is absent, which is the exact defect
 * this PR exists to remove.
 *
 * For any code listed here the public message is derived from the CODE, so a
 * historical message can never reach the DOM. Every other code keeps the
 * server's own message, which is the only place the specific detail lives.
 */
export const EVIDENCE_SAFE_WARNING_MESSAGES: Readonly<Record<string, string>> = {
  file_upload_missing:
    "Private source file could not be found through its declared storage path. Physical storage state is unresolved.",
};

/** The message a caller may display for a warning. Never `warning.message` raw. */
export function publicWarningMessage(warning: StudioWarningSummary): string {
  return EVIDENCE_SAFE_WARNING_MESSAGES[warning.code] ?? warning.message;
}

/** A warning whose message is safe to render, whenever it was produced. */
function toSafeWarning(warning: StudioWarningSummary): StudioWarningSummary {
  const safe = EVIDENCE_SAFE_WARNING_MESSAGES[warning.code];
  return safe === undefined ? warning : { ...warning, message: safe };
}

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
  /**
   * Whether this run made anything PUBLICLY VISIBLE. False for every project
   * ingestion, which produces an unpublished draft. A caller uses it to decide
   * whether a public page link or a share action may be offered at all —
   * neither resolves for a draft.
   */
  readonly isPublic: boolean;

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

  /**
   * True when EITHER observer saw a delivery problem — the browser could not
   * confirm completion, or processing could not find a declared object through
   * its storage path. It is the flag that means "physical storage state is
   * unresolved", and it is what a caller renders
   * `STORAGE_VERIFICATION_GUIDANCE` against. It is NOT a claim that anything is
   * physically absent.
   */
  readonly deliveryProblem: boolean;

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
 * emptiness it cannot know, and "Publication failed — empty page created" is a
 * strong claim: it tells the Owner their page has nothing on it. It is only
 * made when the run actually counted, and counted nothing.
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
  /**
   * What the run made public: `"published"` only when a public page exists.
   * A project ingestion reports `"draft"`; a failed run reports null. See
   * DRAFT VS LIVE above — this, not `status`, decides the live/draft wording.
   */
  readonly publicStatus: string | null;
  readonly counts: StudioJobResult["counts"];
  readonly warnings: readonly StudioWarningSummary[];
  readonly failedUploads: readonly string[];
}): PublicationOutcome {
  const byClass = countWarningsByClass(input.warnings);
  // Every group carries SAFE messages. The mapping is a no-op for codes with no
  // override, so each of those keeps the server's own, correct message.
  const criticalWarnings = input.warnings.filter(isCriticalWarning).map(toSafeWarning);
  const retainedWarnings = input.warnings.filter(isRetainedWarning).map(toSafeWarning);
  const enrichmentWarnings = input.warnings
    .filter((warning) => !isCriticalWarning(warning) && !isRetainedWarning(warning))
    .map(toSafeWarning);

  const clientFailedUploadCount = input.failedUploads.length;
  const clientObservedFailure = clientFailedUploadCount > 0;
  const serverObservedCriticalProblem = criticalWarnings.length > 0;
  const anyCriticalProblem = clientObservedFailure || serverObservedCriticalProblem;

  // Only a DELIVERY problem justifies wording about an unconfirmed transfer. A
  // rejected source arrived; saying it did not would send the Owner to fix the
  // wrong thing, which is the same class of error this whole correction is
  // about. Note the ceiling on what this boolean means: an unconfirmed transfer
  // and a failed lookup, NOT a proven absence — see THE EVIDENCE BOUNDARY.
  const deliveryProblem = clientObservedFailure || byClass.delivery_failure > 0;
  const producedNothing = producedNoContent(input.counts);
  // `status` is the authority on whether the run COMPLETED, and it is the ONLY
  // authority for that. `pagePath` is documented as "the public page path WHEN A
  // PAGE EXISTS" — it is legitimately null for a completed run that produces no
  // public page, so requiring it here would invent a product rule and report
  // healthy runs as failures.
  //
  // `status` is NOT the authority on whether anything became PUBLIC. A completed
  // project ingestion reports `published` as its job lifecycle state while
  // deliberately leaving the project a draft; `publicStatus` is what separates
  // those two questions. See DRAFT VS LIVE above.
  const completed = input.status === "completed";
  const isPublic = input.publicStatus === "published";

  const base = {
    isPublic,
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
    deliveryProblem,
    criticalWarnings,
    retainedWarnings,
    enrichmentWarnings,
  };

  // ATTRIBUTED TO THE OBSERVER THAT ACTUALLY SAW IT. Saying "the browser could
  // not confirm completion" for a run where the browser confirmed every
  // transfer and only processing's lookup failed is a false statement of the
  // same family as the one this correction removes.
  const deliveryEvidence = [
    clientObservedFailure ? "the browser could not confirm completion for them" : null,
    byClass.delivery_failure > 0
      ? "processing could not find them through their declared storage path"
      : null,
  ]
    .filter(Boolean)
    .join(", and ");

  // A run that did not complete saved nothing — in either lane. "Not published"
  // was the old heading, and for a draft lane it names the wrong goal: a project
  // upload was never trying to publish, so failing to publish is not what
  // happened. What happened is that nothing was saved.
  if (!completed) {
    return {
      ...base,
      level: "failed",
      ok: false,
      title: "Not saved",
      description: deliveryProblem
        ? `Nothing was saved by this run, and some files did not complete: ${deliveryEvidence}, so whether their bytes reached storage is unresolved. ${STORAGE_VERIFICATION_GUIDANCE}`
        : anyCriticalProblem
          ? "Nothing was saved by this run, and some files could not be used. Check the details below."
          : "Nothing was saved by this run.",
    };
  }

  // The noun for the thing this run produced. A draft is not a page: it has no
  // public route, so calling it one would restate the defect being repaired.
  const thing = isPublic ? "page" : "draft";

  if (producedNothing && anyCriticalProblem) {
    return {
      ...base,
      level: "failed",
      ok: false,
      // NOT a success heading. A run whose every source failed and which
      // produced 0 units / 0 prices / 0 media is a failure, and the heading is
      // the only part of this screen a reader reliably takes in. "Published,
      // but empty" led with the success word and qualified it afterwards, which
      // is the same defect as the constant "Published" it replaced.
      title: isPublic ? "Publication failed — empty page created" : "Failed — empty draft created",
      description: deliveryProblem
        ? `An empty ${thing} was created with no units, prices or media: ${deliveryEvidence} — physical storage state is unresolved. ${STORAGE_VERIFICATION_GUIDANCE}`
        : `An empty ${thing} was created with no units, prices or media, because the source files that reached processing could not be used. Check the details below.`,
    };
  }

  // What is true of the thing right now. A draft is explicitly NOT live, and
  // saying so is the whole point: the Owner has to know a further, deliberate
  // step stands between this upload and the public site.
  const state = isPublic ? "The page is live" : "The draft is saved and is not on the public site";

  if (anyCriticalProblem) {
    return {
      ...base,
      level: "partial",
      ok: false,
      title: isPublic ? "Partly published" : "Draft saved with problems",
      description: deliveryProblem
        ? `${state}, but some files did not complete and are not on it: ${deliveryEvidence}, so whether their bytes reached storage is unresolved. ${STORAGE_VERIFICATION_GUIDANCE}`
        : `${state}, but some files could not be used and are not on it yet. Check the details below.`,
    };
  }

  return {
    ...base,
    level: "complete",
    ok: true,
    title: isPublic ? "Published" : "Draft saved",
    description: isPublic
      ? "The page is live now. Anything missing can be added later."
      : "Saved as an unpublished draft. It is not on the public site — review it, then publish it when you are ready. Anything missing can be added later.",
  };
}
