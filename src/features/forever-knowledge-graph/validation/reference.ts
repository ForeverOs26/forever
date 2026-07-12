/**
 * Forever Knowledge Graph — reference validation.
 *
 * Structural guards over one {@link KnowledgeRef}: every declared part must
 * be a non-empty string (or, for the revision pin, the reused well-formed
 * version shape), and the reference must anchor to at least one thing — a
 * reference that names nothing traces to nothing, and the module's
 * traceability mandate makes that an error. A structurally absent part is
 * reported as missing, never dereferenced. All checks return issues; none
 * throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { KnowledgeRef } from "../reference";
import { isAnchoredKnowledgeRef } from "../reference";
import { knowledgeError } from "../types";
import type { KnowledgeIssue } from "../types";
import { isWellFormedKnowledgeSourceVersion } from "../version";

/** The string-valued parts of a reference, in declared field order. */
const KNOWLEDGE_REF_STRING_PARTS = [
  "projectId",
  "sourceId",
  "factId",
  "subjectKey",
  "fieldId",
  "path",
  "revisionId",
  "findingId",
] as const;

/**
 * Validate one reference. `base` locates it; e.g. `refs.0`.
 *
 * Never throws: a reference so hostile it cannot even be read (a throwing
 * accessor, an exotic proxy) settles into one structured issue.
 */
export function validateKnowledgeRef(ref: KnowledgeRef, base = "ref"): KnowledgeIssue[] {
  try {
    return validateKnowledgeRefUnguarded(ref, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "Knowledge reference behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateKnowledgeRefUnguarded(ref: KnowledgeRef, base: string): KnowledgeIssue[] {
  if (isAbsent(ref)) {
    return [knowledgeError("missing_ref", "Knowledge reference is absent", base)];
  }
  const issues: KnowledgeIssue[] = [];

  for (const part of KNOWLEDGE_REF_STRING_PARTS) {
    const value = ref[part];
    if (value !== undefined && !isNonEmptyString(value)) {
      issues.push(
        knowledgeError(
          "empty_ref_part",
          `Knowledge reference declares an empty ${part}`,
          `${base}.${part}`,
        ),
      );
    }
  }
  if (ref.sourceVersion !== undefined && !isWellFormedKnowledgeSourceVersion(ref.sourceVersion)) {
    issues.push(
      knowledgeError(
        "invalid_ref_version",
        "Knowledge reference pins a malformed source revision",
        `${base}.sourceVersion`,
      ),
    );
  }
  if (!isAnchoredKnowledgeRef(ref)) {
    issues.push(
      knowledgeError(
        "unanchored_ref",
        "Knowledge reference names nothing — it traces to nothing",
        base,
      ),
    );
  }

  return issues;
}
