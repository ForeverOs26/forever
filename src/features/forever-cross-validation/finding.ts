/**
 * Forever Cross-Source Validation — the validation finding.
 *
 * A {@link CrossValidationFinding} is one described observation about a batch
 * of readings: independent sources agree, sources disagree, a reading comes
 * from an outdated revision, a fact is duplicated, evidence or provenance is
 * incomplete, a claim has nothing supporting it, expected information is
 * missing, or readings are mutually incomparable (different units,
 * currencies, or languages). A finding *describes* — it never resolves: a
 * conflict finding shows every side, an agreement finding says who agreed,
 * and nothing anywhere picks a winner, invents a value, or fills a gap.
 *
 * Every finding carries a {@link CrossValidationDisposition} — whether it is
 * informational, advisory, or requires future human review — and a list of
 * {@link CrossValidationReference}s that trace it back to the facts, sources,
 * source revisions, and canonical paths it is about (and through the fact
 * ids, to the RC4.5 evidence and provenance those facts carry). Timestamps
 * appear only when the caller supplied one — RC4.7 reads no clock.
 */

import type { ISODateTime } from "@/features/forever-database";
import type { ExtractionFactType } from "@/features/forever-extraction-pipeline";

import { compareCrossValidationStrings } from "./helpers";
import type { CrossFactId, CrossSourceRef } from "./types";
import type { CrossValidationSourceVersion } from "./version";

/** Every kind of observation a cross-source examination can describe. */
export type CrossValidationFindingKind =
  | "agreement"
  | "single_source"
  | "conflict"
  | "inconsistency"
  | "stale_revision"
  | "duplicate_fact"
  | "unregistered_source"
  | "inactive_source"
  | "authority_below_bar"
  | "confidence_below_bar"
  | "evidence_gap"
  | "provenance_gap"
  | "unsupported_claim"
  | "missing_information";

/** Every {@link CrossValidationFindingKind}, in the canonical declared order. */
export const CROSS_VALIDATION_FINDING_KINDS = [
  "agreement",
  "single_source",
  "conflict",
  "inconsistency",
  "stale_revision",
  "duplicate_fact",
  "unregistered_source",
  "inactive_source",
  "authority_below_bar",
  "confidence_below_bar",
  "evidence_gap",
  "provenance_gap",
  "unsupported_claim",
  "missing_information",
] as const satisfies readonly CrossValidationFindingKind[];

/** Runtime guard: whether a value is a known {@link CrossValidationFindingKind}. */
export function isKnownCrossValidationFindingKind(
  value: unknown,
): value is CrossValidationFindingKind {
  return (
    typeof value === "string" &&
    (CROSS_VALIDATION_FINDING_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Rank of a finding kind in the canonical declared order; an
 * out-of-vocabulary runtime value ranks after everything so a malformed
 * finding never jumps the deterministic order.
 */
export function crossValidationFindingKindRank(kind: CrossValidationFindingKind): number {
  const rank = (CROSS_VALIDATION_FINDING_KINDS as readonly CrossValidationFindingKind[]).indexOf(
    kind,
  );
  return rank === -1 ? CROSS_VALIDATION_FINDING_KINDS.length : rank;
}

/**
 * What a finding asks of its reader.
 *
 * `informational` states an observation that demands nothing (independent
 * agreement, a lone-source subject under a policy that demands no
 * corroboration), `advisory` recommends attention without blocking
 * (redundant duplicates, evidentiary thinness), and `requires_review` marks
 * an unresolved uncertainty a human or a future runtime must settle before
 * the affected readings are treated as canonical — RC4.7 itself settles
 * nothing.
 */
export type CrossValidationDisposition = "informational" | "advisory" | "requires_review";

/** Every {@link CrossValidationDisposition}, least demanding first. */
export const CROSS_VALIDATION_DISPOSITIONS = [
  "informational",
  "advisory",
  "requires_review",
] as const satisfies readonly CrossValidationDisposition[];

/** Runtime guard: whether a value is a known {@link CrossValidationDisposition}. */
export function isKnownCrossValidationDisposition(
  value: unknown,
): value is CrossValidationDisposition {
  return (
    typeof value === "string" &&
    (CROSS_VALIDATION_DISPOSITIONS as readonly string[]).includes(value)
  );
}

/**
 * The aspect an inconsistency or disagreement is about, so "inconsistent
 * units, currencies, dates, areas, prices, identities, and references" are
 * all addressable in one closed vocabulary. `value` is the explicit default
 * for a plain disagreement over a value with no more specific aspect.
 */
export type CrossValidationDimension =
  | "value"
  | "unit"
  | "currency"
  | "date"
  | "area"
  | "price"
  | "identity"
  | "reference"
  | "language";

/** Every {@link CrossValidationDimension}, in a stable declared order. */
export const CROSS_VALIDATION_DIMENSIONS = [
  "value",
  "unit",
  "currency",
  "date",
  "area",
  "price",
  "identity",
  "reference",
  "language",
] as const satisfies readonly CrossValidationDimension[];

/** Runtime guard: whether a value is a known {@link CrossValidationDimension}. */
export function isKnownCrossValidationDimension(value: unknown): value is CrossValidationDimension {
  return (
    typeof value === "string" && (CROSS_VALIDATION_DIMENSIONS as readonly string[]).includes(value)
  );
}

/**
 * The dimension a disagreement over one RC4.5 fact type is about, so a
 * conflict over `price` facts reads as a price disagreement and a conflict
 * over `completion_date` facts as a date disagreement.
 *
 * A deterministic total mapping over the reused RC4.5 vocabulary: monetary
 * types map to `price` (and the currency type to `currency`), area types to
 * `area`, date types to `date`, naming types to `identity`, and everything
 * else — including the explicit `unknown` — to the explicit `value` default.
 */
export function crossValidationDimensionForFactType(
  factType: ExtractionFactType,
): CrossValidationDimension {
  switch (factType) {
    case "price":
    case "price_per_sqm":
      return "price";
    case "currency":
      return "currency";
    case "internal_area":
    case "external_area":
    case "total_area":
    case "land_area":
      return "area";
    case "completion_date":
    case "document_date":
      return "date";
    case "project_name":
    case "developer":
      return "identity";
    default:
      return "value";
  }
}

/**
 * One traceability reference from a finding back to what it is about. Every
 * part is attached only where it applies (anti-fabrication): a fact-anchored
 * reference names the fact, its source, and its received revision; an
 * expectation-anchored reference names only the canonical path.
 */
export interface CrossValidationReference {
  /** The RC4.5 fact the finding traces to, when one is involved. */
  factId?: CrossFactId;
  /** The RC4.4 catalogued source the finding traces to, when one is involved. */
  sourceId?: CrossSourceRef;
  /** The received revision involved, when one is pinned. Reused shape. */
  sourceVersion?: CrossValidationSourceVersion;
  /** The canonical field path involved, when one is addressed. */
  path?: string;
}

/** One described observation about a batch of cross-source readings. */
export interface CrossValidationFinding {
  /** Stable surrogate id, e.g. `xfnd_coralina-conflict-1`. */
  id: string;
  kind: CrossValidationFindingKind;
  disposition: CrossValidationDisposition;
  /** Canonical id of the project the finding belongs to, e.g. `proj_coralina`. */
  projectId: string;
  /** The reused RC4.5 subject key the finding is about, when one subject is. */
  subjectKey?: string;
  /** The canonical field path the finding is about, when one is addressed. */
  path?: string;
  /** The aspect the finding is about, when a specific one applies. */
  dimension?: CrossValidationDimension;
  /** Human-readable statement of the observation. Describes, never resolves. */
  message: string;
  /**
   * Whether the sources involved are mutually independent (no declared RC4.4
   * relationship chain between them) — stated only where independence was
   * actually judged, i.e. on agreement and conflict findings.
   */
  independentSources?: boolean;
  /** The traceability references, in the module's deterministic order. */
  references: CrossValidationReference[];
  /** When the observation was described, supplied by the caller. */
  detectedAt?: ISODateTime;
}

/** Options accepted by {@link crossValidationFinding}. */
export interface CrossValidationFindingOptions {
  subjectKey?: string;
  path?: string;
  dimension?: CrossValidationDimension;
  independentSources?: boolean;
  references?: CrossValidationReference[];
  detectedAt?: ISODateTime;
}

/**
 * Build a {@link CrossValidationFinding}; optional facts are attached only
 * when supplied so an absent fact stays absent (anti-fabrication), and the
 * references default to the empty list — never an invented trace. The result
 * is deep-copied from the input, so it never aliases a caller value.
 */
export function crossValidationFinding(
  id: string,
  kind: CrossValidationFindingKind,
  disposition: CrossValidationDisposition,
  projectId: string,
  message: string,
  options: CrossValidationFindingOptions = {},
): CrossValidationFinding {
  const finding: CrossValidationFinding = {
    id,
    kind,
    disposition,
    projectId,
    message,
    references: options.references ?? [],
  };
  if (options.subjectKey !== undefined) finding.subjectKey = options.subjectKey;
  if (options.path !== undefined) finding.path = options.path;
  if (options.dimension !== undefined) finding.dimension = options.dimension;
  if (options.independentSources !== undefined) {
    finding.independentSources = options.independentSources;
  }
  if (options.detectedAt !== undefined) finding.detectedAt = options.detectedAt;
  // Deep-copy so the described finding never aliases the caller's input.
  return structuredClone(finding);
}

/** Whether a finding marks an unresolved uncertainty needing human review. */
export function crossValidationFindingRequiresReview(finding: CrossValidationFinding): boolean {
  return finding?.disposition === "requires_review";
}

/**
 * Comparator for the module's one deterministic finding order: by canonical
 * kind rank, then subject key (an unkeyed finding after keyed ones), then
 * path, then the first reference's fact id, then id.
 *
 * Suitable for `Array.prototype.sort`. Pure and total — malformed parts
 * compare through the total string comparison instead of throwing.
 */
export function compareCrossValidationFindings(
  a: CrossValidationFinding,
  b: CrossValidationFinding,
): number {
  return (
    crossValidationFindingKindRank(a?.kind) - crossValidationFindingKindRank(b?.kind) ||
    compareCrossValidationStrings(a?.subjectKey ?? "\uffff", b?.subjectKey ?? "\uffff") ||
    compareCrossValidationStrings(a?.path ?? "", b?.path ?? "") ||
    compareCrossValidationStrings(
      a?.references?.[0]?.factId ?? "",
      b?.references?.[0]?.factId ?? "",
    ) ||
    compareCrossValidationStrings(a?.id ?? "", b?.id ?? "")
  );
}

/**
 * A copy of the findings in the module's one deterministic order.
 *
 * Stable and immutable: fully tied findings keep their input order and the
 * input list is never mutated.
 */
export function sortCrossValidationFindings(
  findings: readonly CrossValidationFinding[],
): CrossValidationFinding[] {
  return [...findings].sort(compareCrossValidationFindings);
}
