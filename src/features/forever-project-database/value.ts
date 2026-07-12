/**
 * Forever Canonical Project Database — the canonical value.
 *
 * A {@link ProjectFieldValue} is one entry in a canonical field's append-only
 * value history: the representation it carries (or the absence it states),
 * its standing, its confidence, and the references that make it traceable —
 * the RC4.5 fact that produced it, the RC4.4 sources it came from, its
 * evidence and provenance chains (both reused RC4.5 shapes, verbatim), the
 * revision that introduced it, and the caller-supplied time it was recorded.
 * RC4.6 reads no clock, so a timestamp only ever appears because a caller
 * proved one — never fabricated.
 *
 * {@link projectFieldValueFromFact} is the deterministic bridge from RC4.5:
 * it re-describes one extracted fact as the canonical value it would settle
 * into, copying the fact's value, unit, language, confidence, evidence, and
 * provenance without normalizing, re-grading, or inventing anything — an
 * unavailable fact settles into an explicit `missing` entry, because stated
 * absence is data too. It is pure and deep-copies its output, so a canonical
 * value never aliases the fact it came from (anti-aliasing).
 */

import type { ISODateTime } from "@/features/forever-database";
import type { ExtractionFact } from "@/features/forever-extraction-pipeline";

import type { ProjectValueStatus } from "./status";
import type {
  ProjectConfidence,
  ProjectEvidence,
  ProjectFactId,
  ProjectProvenance,
  ProjectSourceRef,
  ProjectStructuredValue,
} from "./types";
import { unknownProjectConfidence } from "./types";

/** One entry in a canonical field's append-only value history. */
export interface ProjectFieldValue {
  /** Where this value stands: current, superseded, removed, missing, unknown. */
  status: ProjectValueStatus;
  /** The value exactly as observed at its source, verbatim. */
  rawValue?: string;
  /** The typed counterpart of the raw value, when one was structured. */
  structuredValue?: ProjectStructuredValue;
  /** Unit of the value where applicable, e.g. `sqm`. */
  unit?: string;
  /** Language of the observed value, e.g. `en` or `th`, when known. */
  language?: string;
  /** How sure the system is of this value; explicitly `unknown` when never assessed. */
  confidence: ProjectConfidence;
  /** The RC4.5 extracted fact this value settled from, when one produced it. */
  factId?: ProjectFactId;
  /** The RC4.4 catalogued sources this value traces to, in declared order. */
  sourceIds?: ProjectSourceRef[];
  /** Where the value was observed. Reused RC4.5 evidence, kept verbatim. */
  evidence?: ProjectEvidence[];
  /** The chain back to source, revision, method, and time. Reused RC4.5 shape. */
  provenance?: ProjectProvenance;
  /** The canonical revision that introduced this entry, when one did. */
  revisionId?: string;
  /** When the entry was recorded, supplied by the caller — never a clock read. */
  recordedAt?: ISODateTime;
  /** The fact whose value replaced this one, when it was superseded. */
  supersededBy?: ProjectFactId;
  /** Free-text note about this entry. */
  note?: string;
}

/** Options accepted by {@link projectFieldValue}. */
export interface ProjectFieldValueOptions {
  rawValue?: string;
  structuredValue?: ProjectStructuredValue;
  unit?: string;
  language?: string;
  /** Confidence; defaults to the explicit `unknown` grade. */
  confidence?: ProjectConfidence;
  factId?: ProjectFactId;
  sourceIds?: ProjectSourceRef[];
  evidence?: ProjectEvidence[];
  provenance?: ProjectProvenance;
  revisionId?: string;
  recordedAt?: ISODateTime;
  supersededBy?: ProjectFactId;
  note?: string;
}

/**
 * Build a {@link ProjectFieldValue}; optional facts are attached only when
 * supplied so an absent fact stays absent (anti-fabrication), and the
 * confidence defaults to the explicit `unknown` grade — never a fabricated
 * one. The result is deep-copied from the input, so it never aliases a
 * caller value.
 */
export function projectFieldValue(
  status: ProjectValueStatus,
  options: ProjectFieldValueOptions = {},
): ProjectFieldValue {
  const value: ProjectFieldValue = {
    status,
    confidence: options.confidence ?? unknownProjectConfidence(),
  };
  if (options.rawValue !== undefined) value.rawValue = options.rawValue;
  if (options.structuredValue !== undefined) value.structuredValue = options.structuredValue;
  if (options.unit !== undefined) value.unit = options.unit;
  if (options.language !== undefined) value.language = options.language;
  if (options.factId !== undefined) value.factId = options.factId;
  if (options.sourceIds !== undefined) value.sourceIds = options.sourceIds;
  if (options.evidence !== undefined) value.evidence = options.evidence;
  if (options.provenance !== undefined) value.provenance = options.provenance;
  if (options.revisionId !== undefined) value.revisionId = options.revisionId;
  if (options.recordedAt !== undefined) value.recordedAt = options.recordedAt;
  if (options.supersededBy !== undefined) value.supersededBy = options.supersededBy;
  if (options.note !== undefined) value.note = options.note;
  // Deep-copy so the described value never aliases the caller's input.
  return structuredClone(value);
}

/** Options accepted by {@link projectFieldValueFromFact}. */
export interface ProjectFieldValueFromFactOptions {
  /** When the canonical entry was recorded, supplied by the caller. */
  recordedAt?: ISODateTime;
  /** The canonical revision that introduces the entry, when one is described. */
  revisionId?: string;
}

/**
 * Re-describe one RC4.5 extracted fact as the canonical value it would settle
 * into.
 *
 * Pure and total: the same fact always yields a byte-identical value. Nothing
 * is normalized, re-graded, or invented — the raw and structured values, the
 * unit, language, confidence, evidence, and provenance are the fact's own,
 * deep-copied so the canonical value never aliases the fact (anti-aliasing).
 * A fact whose status is `unavailable` settles into an explicit `missing`
 * entry carrying no value representation: the source was read and the value
 * was not there, and that stated absence is preserved as data. Every other
 * fact settles into a `current` entry. The recorded time comes only from the
 * caller — the fact's own extraction time stays where it belongs, inside the
 * reused provenance chain.
 */
export function projectFieldValueFromFact(
  fact: ExtractionFact,
  options: ProjectFieldValueFromFactOptions = {},
): ProjectFieldValue {
  const missing = fact.status === "unavailable";
  return projectFieldValue(missing ? "missing" : "current", {
    ...(missing || fact.rawValue === undefined ? {} : { rawValue: fact.rawValue }),
    ...(missing || fact.structuredValue === undefined
      ? {}
      : { structuredValue: fact.structuredValue }),
    ...(fact.unit === undefined ? {} : { unit: fact.unit }),
    ...(fact.language === undefined ? {} : { language: fact.language }),
    confidence: fact.confidence,
    factId: fact.id,
    sourceIds: [fact.sourceId],
    ...(fact.evidence === undefined ? {} : { evidence: [fact.evidence] }),
    ...(fact.provenance === undefined ? {} : { provenance: fact.provenance }),
    ...(options.revisionId === undefined ? {} : { revisionId: options.revisionId }),
    ...(options.recordedAt === undefined ? {} : { recordedAt: options.recordedAt }),
  });
}

/**
 * Stable signature of the representation a canonical value carries, used only
 * to tell readings apart — in merge description and conflict detection.
 * Byte-level: two structured values that differ in key order are treated as
 * different readings — RC4.6 compares, it never normalizes.
 *
 * Total: a representation that cannot be serialized (a circular structure, a
 * symbol-keyed exotic) collapses to one stable unserializable marker instead
 * of throwing — such a representation is already reported as invalid by the
 * value guard, and the signature merely stays comparable.
 */
export function projectFieldValueSignature(value: ProjectFieldValue): string {
  try {
    return JSON.stringify(
      {
        rawValue: value?.rawValue,
        structuredValue: value?.structuredValue,
        unit: value?.unit,
      },
      (_key, candidate) => (typeof candidate === "bigint" ? `${candidate}n` : candidate),
    );
  } catch {
    return "\u0000unserializable";
  }
}
