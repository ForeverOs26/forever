/**
 * Forever Extraction Pipeline — fact validation.
 *
 * Composes the confidence, evidence, and provenance guards and adds the
 * checks that span a whole {@link ExtractionFact}: the identity references
 * must be present, the fact type must be a supported vocabulary value, the
 * pinned revision must be well-formed (the reused RC4.4 guard), evidence and
 * provenance are mandatory, the raw/structured/derived value representations
 * must each be coherent with the declared value kind, and the three lifecycle
 * vocabularies must not contradict each other — a verified fact that failed
 * validation or review, or an unavailable fact that somehow carries a value,
 * is flagged, never repaired. A structurally absent part (`null` or
 * `undefined`) is reported as missing, never dereferenced. All checks return
 * issues; none throw.
 */

import type { ExtractionFact } from "../fact";
import { isKnownExtractionFactType } from "../facttype";
import { isAbsent, isNonEmptyString } from "../helpers";
import {
  isKnownExtractionFactStatus,
  isKnownExtractionReviewStatus,
  isKnownExtractionValidationStatus,
} from "../status";
import { extractionError, extractionWarning } from "../types";
import type { ExtractionIssue } from "../types";
import { isExtractionStructuredValue, isKnownExtractionValueKind } from "../value";
import { validateExtractionConfidence } from "./confidence";
import { validateExtractionEvidence } from "./evidence";
import { validateExtractionProvenance } from "./provenance";
import { validateExtractionVersion } from "./version";

/**
 * Conventional language-tag shape: `en`, `th`, `en-GB`. Mirrors the RC4.4
 * descriptor convention (the pattern is internal there, so direct reuse is
 * impossible); deviations warn, they never block.
 */
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

/** Validate a whole fact. `base` locates it, e.g. `facts.0`; empty when standalone. */
export function validateExtractionFact(fact: ExtractionFact, base = ""): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];

  if (!isNonEmptyString(fact.id)) {
    issues.push(extractionError("missing_fact_id", "Fact is missing an id", at(base, "id")));
  }
  if (!isNonEmptyString(fact.projectId)) {
    issues.push(
      extractionError("missing_project_id", "Fact is missing a project id", at(base, "projectId")),
    );
  }
  if (!isNonEmptyString(fact.sourceId)) {
    issues.push(
      extractionError(
        "missing_fact_source",
        "Fact names no catalogued source",
        at(base, "sourceId"),
      ),
    );
  }

  if (isAbsent(fact.sourceVersion)) {
    issues.push(
      extractionError(
        "missing_source_version",
        "Fact pins no source revision",
        at(base, "sourceVersion"),
      ),
    );
  } else {
    issues.push(
      ...validateExtractionVersion(fact.sourceVersion).map((issue) => ({
        ...issue,
        path: at(base, "sourceVersion"),
      })),
    );
  }

  if (!isKnownExtractionFactType(fact.factType)) {
    issues.push(
      extractionError(
        "unsupported_fact_type",
        `Fact has an unsupported fact type "${String(fact.factType)}"`,
        at(base, "factType"),
      ),
    );
  }

  if (fact.fieldPath !== undefined && !isNonEmptyString(fact.fieldPath)) {
    issues.push(
      extractionError(
        "empty_field_path",
        "Fact declares an empty field path",
        at(base, "fieldPath"),
      ),
    );
  }

  // Value coherence: the declared value kind must be honest about which
  // representations the fact actually carries, and an unavailable fact may
  // carry none at all — a value on an unavailable fact is a fabrication.
  if (!isKnownExtractionValueKind(fact.valueKind)) {
    issues.push(
      extractionError(
        "unknown_value_kind",
        `Fact has an unknown value kind "${String(fact.valueKind)}"`,
        at(base, "valueKind"),
      ),
    );
  }
  if (fact.rawValue !== undefined && typeof fact.rawValue !== "string") {
    issues.push(
      extractionError(
        "invalid_raw_value",
        "Fact raw value must be the observed text, verbatim",
        at(base, "rawValue"),
      ),
    );
  }
  if (fact.structuredValue !== undefined && !isExtractionStructuredValue(fact.structuredValue)) {
    issues.push(
      extractionError(
        "invalid_structured_value",
        "Fact structured value is not a scalar, scalar list, Money, or GeoPoint",
        at(base, "structuredValue"),
      ),
    );
  }
  if (fact.status === "unavailable") {
    if (fact.rawValue !== undefined || fact.structuredValue !== undefined) {
      issues.push(
        extractionError(
          "unavailable_with_value",
          "Fact is unavailable but carries a value — missing data must remain absent",
          at(base, "status"),
        ),
      );
    }
  } else {
    if (fact.valueKind === "raw" && fact.rawValue === undefined) {
      issues.push(
        extractionError(
          "missing_raw_value",
          "Fact declares a raw value kind but carries no raw value",
          at(base, "rawValue"),
        ),
      );
    }
    if (fact.valueKind === "structured" && fact.structuredValue === undefined) {
      issues.push(
        extractionError(
          "missing_structured_value",
          "Fact declares a structured value kind but carries no structured value",
          at(base, "structuredValue"),
        ),
      );
    }
  }
  if (
    fact.valueKind === "derived" &&
    (isAbsent(fact.provenance) ||
      !Array.isArray(fact.provenance.derivedFrom) ||
      fact.provenance.derivedFrom.length === 0)
  ) {
    issues.push(
      extractionError(
        "derived_without_chain",
        "Fact declares a derived value but its provenance chains to no other fact",
        at(base, "provenance.derivedFrom"),
      ),
    );
  }

  if (fact.unit !== undefined && !isNonEmptyString(fact.unit)) {
    issues.push(extractionError("empty_unit", "Fact declares an empty unit", at(base, "unit")));
  }
  if (fact.language !== undefined) {
    if (!isNonEmptyString(fact.language)) {
      issues.push(
        extractionError("empty_language", "Fact declares an empty language", at(base, "language")),
      );
    } else if (!LANGUAGE_PATTERN.test(fact.language)) {
      issues.push(
        extractionWarning(
          "unconventional_language",
          `Fact language "${fact.language}" does not match the conventional tag shape`,
          at(base, "language"),
        ),
      );
    }
  }

  if (isAbsent(fact.confidence)) {
    issues.push(
      extractionError(
        "missing_confidence",
        "Fact carries no confidence — an unassessed confidence must say `unknown` explicitly",
        at(base, "confidence"),
      ),
    );
  } else {
    issues.push(...validateExtractionConfidence(fact.confidence, at(base, "confidence")));
  }

  if (isAbsent(fact.evidence)) {
    issues.push(
      extractionError("missing_evidence", "Fact carries no evidence", at(base, "evidence")),
    );
  } else {
    issues.push(
      ...validateExtractionEvidence(
        fact.evidence,
        { sourceId: fact.sourceId, sourceVersion: fact.sourceVersion ?? undefined },
        at(base, "evidence"),
      ),
    );
  }

  if (isAbsent(fact.provenance)) {
    issues.push(
      extractionError(
        "missing_provenance",
        "Fact carries no provenance — every fact must be traceable",
        at(base, "provenance"),
      ),
    );
  } else {
    issues.push(
      ...validateExtractionProvenance(
        fact.provenance,
        {
          factId: isNonEmptyString(fact.id) ? fact.id : undefined,
          sourceId: fact.sourceId,
          sourceVersion: fact.sourceVersion ?? undefined,
        },
        at(base, "provenance"),
      ),
    );
  }

  if (!isKnownExtractionFactStatus(fact.status)) {
    issues.push(
      extractionError(
        "unknown_fact_status",
        `Fact has an unknown status "${String(fact.status)}"`,
        at(base, "status"),
      ),
    );
  }
  if (!isKnownExtractionReviewStatus(fact.reviewStatus)) {
    issues.push(
      extractionError(
        "unknown_review_status",
        `Fact has an unknown review status "${String(fact.reviewStatus)}"`,
        at(base, "reviewStatus"),
      ),
    );
  }
  if (!isKnownExtractionValidationStatus(fact.validationStatus)) {
    issues.push(
      extractionError(
        "unknown_validation_status",
        `Fact has an unknown validation status "${String(fact.validationStatus)}"`,
        at(base, "validationStatus"),
      ),
    );
  }

  // Contradictory lifecycle states: the three vocabularies answer different
  // questions, but some combinations cannot all be true at once.
  if (fact.status === "verified" && fact.validationStatus === "invalid") {
    issues.push(
      extractionError(
        "verified_but_invalid",
        "Fact is verified but its validation status says invalid",
        at(base, "status"),
      ),
    );
  }
  if (fact.status === "verified" && fact.reviewStatus === "rejected") {
    issues.push(
      extractionError(
        "verified_but_rejected",
        "Fact is verified but its review status says rejected",
        at(base, "status"),
      ),
    );
  }

  // A superseded or disputed fact should say what replaced or contradicts it,
  // so the chain stays walkable — a missing reference is reported, never
  // fabricated.
  if (fact.status === "superseded" && fact.supersededBy === undefined) {
    issues.push(
      extractionWarning(
        "superseded_without_reference",
        "Fact is superseded but names no superseding fact",
        at(base, "supersededBy"),
      ),
    );
  }
  if (
    fact.status === "disputed" &&
    (fact.conflictsWith === undefined ||
      !Array.isArray(fact.conflictsWith) ||
      fact.conflictsWith.length === 0)
  ) {
    issues.push(
      extractionWarning(
        "disputed_without_reference",
        "Fact is disputed but names no conflicting fact",
        at(base, "conflictsWith"),
      ),
    );
  }

  if (fact.supersededBy !== undefined) {
    if (!isNonEmptyString(fact.supersededBy)) {
      issues.push(
        extractionError(
          "empty_fact_reference",
          "Fact declares an empty supersededBy reference",
          at(base, "supersededBy"),
        ),
      );
    } else if (fact.supersededBy === fact.id) {
      issues.push(
        extractionError(
          "self_fact_reference",
          "Fact names itself as its superseding fact",
          at(base, "supersededBy"),
        ),
      );
    }
  }
  if (fact.conflictsWith !== undefined && !Array.isArray(fact.conflictsWith)) {
    issues.push(
      extractionError(
        "invalid_conflicts_list",
        "Fact declares a non-list conflictsWith value",
        at(base, "conflictsWith"),
      ),
    );
  } else if (fact.conflictsWith !== undefined) {
    const seen = new Set<string>();
    fact.conflictsWith.forEach((id, index) => {
      if (!isNonEmptyString(id)) {
        issues.push(
          extractionError(
            "empty_fact_reference",
            "Fact declares an empty conflictsWith reference",
            at(base, `conflictsWith.${index}`),
          ),
        );
        return;
      }
      if (seen.has(id)) {
        issues.push(
          extractionError(
            "duplicate_conflict_reference",
            `Fact repeats the conflictsWith reference "${id}"`,
            at(base, `conflictsWith.${index}`),
          ),
        );
      }
      seen.add(id);
      if (id === fact.id) {
        issues.push(
          extractionError(
            "self_fact_reference",
            "Fact lists itself as a conflicting fact",
            at(base, `conflictsWith.${index}`),
          ),
        );
      }
    });
  }

  if (fact.issues !== undefined && !Array.isArray(fact.issues)) {
    issues.push(
      extractionError(
        "invalid_fact_issues",
        "Fact declares a non-list issues value",
        at(base, "issues"),
      ),
    );
  }

  return issues;
}
