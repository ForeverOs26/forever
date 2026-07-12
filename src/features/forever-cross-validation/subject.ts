/**
 * Forever Cross-Source Validation — the validated subject.
 *
 * A {@link CrossValidationSubject} names one statement the examination is
 * about: the project, the RC4.5 fact type, and the canonical field path when
 * one is declared. Its key *is* the RC4.5
 * {@link import("@/features/forever-extraction-pipeline").extractionFactSubjectKey}
 * value, reused directly — facts group under exactly the subject rule the
 * extraction pipeline already speaks, so a subject here addresses the same
 * statement a fact group there does, never a parallel keying scheme.
 *
 * Subjects are derived from the facts themselves (or, for an expected-but-
 * uncovered path, from the caller's stated expectation with the explicit
 * `unknown` fact type — a stated vocabulary value, never a guessed type).
 * RC4.7 derives, it never invents: a fact without a field path yields a
 * subject without one.
 */

import type { ExtractionFact, ExtractionFactType } from "@/features/forever-extraction-pipeline";
import { extractionFactSubjectKey } from "@/features/forever-extraction-pipeline";

// Reuse the RC4.5 subject key rule and grouping under cross-validation names —
// one subject definition across extraction and cross-validation, and nothing
// to drift out of sync.
export {
  extractionFactSubjectKey as crossValidationFactSubjectKey,
  groupExtractionFactsBySubject as groupCrossValidationFactsBySubject,
} from "@/features/forever-extraction-pipeline";

/** One statement a cross-source examination is about. */
export interface CrossValidationSubject {
  /** The reused RC4.5 subject key, e.g. `proj_coralina:price:pricing.basePrice`. */
  key: string;
  /** Canonical id of the project the subject belongs to, e.g. `proj_coralina`. */
  projectId: string;
  /** The RC4.5 fact type the subject is about. Reused vocabulary. */
  factType: ExtractionFactType;
  /** Dotted canonical field path, when the subject declares one. */
  fieldPath?: string;
}

/**
 * Derive the {@link CrossValidationSubject} a fact speaks about.
 *
 * Pure and total: the key comes from the reused RC4.5 subject rule, and the
 * parts are the fact's own — the field path is attached only when the fact
 * declares one (anti-fabrication).
 */
export function crossValidationSubjectFor(fact: ExtractionFact): CrossValidationSubject {
  const subject: CrossValidationSubject = {
    key: extractionFactSubjectKey(fact),
    projectId: fact.projectId,
    factType: fact.factType,
  };
  if (fact.fieldPath !== undefined) subject.fieldPath = fact.fieldPath;
  return subject;
}

/**
 * Derive the subject an expected-but-uncovered canonical path addresses.
 *
 * The fact type is the explicit RC4.5 `unknown` — no reading exists to say
 * what type would cover the path, and none is guessed — and the key is
 * derived through the very same reused RC4.5 subject rule covered subjects
 * use, so expected subjects sort and compare exactly like covered ones.
 */
export function crossValidationExpectedSubjectFor(
  projectId: string,
  fieldPath: string,
): CrossValidationSubject {
  const parts = { projectId, factType: "unknown", fieldPath } as ExtractionFact;
  return {
    key: extractionFactSubjectKey(parts),
    projectId,
    factType: "unknown",
    fieldPath,
  };
}
