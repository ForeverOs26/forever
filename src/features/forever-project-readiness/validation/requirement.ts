/**
 * Forever Project Readiness — requirement validation.
 *
 * Structural guards over one {@link ReadinessRequirement}: the kind must be
 * vocabulary, every kind-essential parameter must be present and coherent (a
 * field statement addresses a path, a source statement names a known
 * document type, a confidence statement states a known rung), a stated bar
 * must be a known rung, a parameter foreign to the kind must not be stated
 * (the engine strips such statements at intake and reports them — a
 * described requirement never carries one), and a stated necessity or note
 * must say something. A structurally absent part is reported as missing,
 * never dereferenced. All checks return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { ReadinessRequirement } from "../requirement";
import {
  isKnownReadinessDocumentType,
  isKnownReadinessNecessity,
  isKnownReadinessRequirementKind,
  isKnownReadinessTrustLevel,
  isReadinessFieldRequirementKind,
} from "../requirement";
import { isKnownReadinessConfidenceLevel, readinessError } from "../types";
import type { ReadinessIssue } from "../types";

/**
 * Validate one requirement. `base` locates it; e.g. `requirements.0`.
 *
 * Never throws: a requirement so hostile it cannot even be read settles into
 * one structured issue.
 */
export function validateReadinessRequirement(
  requirement: ReadinessRequirement,
  base = "requirement",
): ReadinessIssue[] {
  try {
    return validateReadinessRequirementUnguarded(requirement, base);
  } catch {
    return [
      readinessError(
        "unvalidatable_input",
        "Requirement behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateReadinessRequirementUnguarded(
  requirement: ReadinessRequirement,
  base: string,
): ReadinessIssue[] {
  if (isAbsent(requirement)) {
    return [readinessError("missing_requirement", "Requirement is absent", base)];
  }
  const issues: ReadinessIssue[] = [];

  if (!isKnownReadinessRequirementKind(requirement.kind)) {
    issues.push(
      readinessError(
        "unknown_requirement_kind",
        `Requirement has an unknown kind "${String(requirement.kind)}"`,
        `${base}.kind`,
      ),
    );
    return issues;
  }

  // The canonical path: essential for field statements, an optional scope
  // for findings statements, foreign to source statements.
  if (isReadinessFieldRequirementKind(requirement.kind)) {
    if (!isNonEmptyString(requirement.path)) {
      issues.push(
        readinessError(
          "missing_requirement_path",
          `A "${requirement.kind}" requirement must address a canonical field path`,
          `${base}.path`,
        ),
      );
    }
  } else if (requirement.kind === "findings_clear") {
    if (requirement.path !== undefined && !isNonEmptyString(requirement.path)) {
      issues.push(
        readinessError(
          "empty_requirement_path",
          `A "findings_clear" requirement declares an empty path scope`,
          `${base}.path`,
        ),
      );
    }
  } else if (requirement.path !== undefined) {
    issues.push(
      readinessError(
        "extraneous_requirement_parameter",
        `A "${requirement.kind}" requirement addresses no canonical path`,
        `${base}.path`,
      ),
    );
  }

  // The document type: essential for source statements, foreign elsewhere.
  if (requirement.kind === "source_present") {
    if (!isKnownReadinessDocumentType(requirement.documentType)) {
      issues.push(
        readinessError(
          "unknown_requirement_document_type",
          `A "source_present" requirement must name a known document type, not "${String(
            requirement.documentType,
          )}"`,
          `${base}.documentType`,
        ),
      );
    }
  } else if (requirement.documentType !== undefined) {
    issues.push(
      readinessError(
        "extraneous_requirement_parameter",
        `A "${requirement.kind}" requirement names no document type`,
        `${base}.documentType`,
      ),
    );
  }

  // The confidence rung: essential for confidence statements, foreign
  // elsewhere.
  if (requirement.kind === "field_confidence") {
    if (!isKnownReadinessConfidenceLevel(requirement.minimumConfidence)) {
      issues.push(
        readinessError(
          "unknown_requirement_confidence",
          `A "field_confidence" requirement must state a known confidence rung, not "${String(
            requirement.minimumConfidence,
          )}"`,
          `${base}.minimumConfidence`,
        ),
      );
    }
  } else if (requirement.minimumConfidence !== undefined) {
    issues.push(
      readinessError(
        "extraneous_requirement_parameter",
        `A "${requirement.kind}" requirement grades no confidence`,
        `${base}.minimumConfidence`,
      ),
    );
  }

  // The trust rung: optional for source statements, foreign elsewhere — and
  // stated means known, never a no-bar.
  if (requirement.kind === "source_present") {
    if (
      requirement.minimumTrust !== undefined &&
      !isKnownReadinessTrustLevel(requirement.minimumTrust)
    ) {
      issues.push(
        readinessError(
          "unknown_requirement_trust",
          `A "source_present" requirement demands an unknown trust rung "${String(
            requirement.minimumTrust,
          )}"`,
          `${base}.minimumTrust`,
        ),
      );
    }
  } else if (requirement.minimumTrust !== undefined) {
    issues.push(
      readinessError(
        "extraneous_requirement_parameter",
        `A "${requirement.kind}" requirement grades no source trust`,
        `${base}.minimumTrust`,
      ),
    );
  }

  if (requirement.necessity !== undefined && !isKnownReadinessNecessity(requirement.necessity)) {
    issues.push(
      readinessError(
        "unknown_requirement_necessity",
        `Requirement has an unknown necessity "${String(requirement.necessity)}"`,
        `${base}.necessity`,
      ),
    );
  }
  if (requirement.note !== undefined && !isNonEmptyString(requirement.note)) {
    issues.push(
      readinessError(
        "empty_requirement_note",
        "Requirement declares an empty note",
        `${base}.note`,
      ),
    );
  }

  return issues;
}
