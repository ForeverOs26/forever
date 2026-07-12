/**
 * Forever Project Sources — relationships validation.
 *
 * Structural guards over a {@link ProjectSourceRelationships}: every reference
 * — when present — must be a non-empty id, the `related` list must not repeat
 * an id, and no reference may point a source at itself. Whether a referenced
 * source actually exists is deliberately *not* checked here — resolving
 * references against a live catalogue stays a future runtime's concern,
 * mirroring the RC4.2 reference contract. All checks return issues; none
 * throw.
 */

import { isNonEmptyString } from "../helpers";
import type { ProjectSourceRelationships } from "../relationships";
import { projectSourceError } from "../types";
import type { ProjectSourceId, ProjectSourceIssue } from "../types";

const REFERENCE_FIELDS = [
  "registeredSourceId",
  "supersedes",
  "supersededBy",
  "derivedFrom",
  "translationOf",
] as const;

/** The reference fields that point at another *catalogued* source. */
const SELF_REFERENCE_FIELDS = [
  "supersedes",
  "supersededBy",
  "derivedFrom",
  "translationOf",
] as const;

/**
 * Validate a relationships value's references.
 *
 * When `sourceId` is supplied, references pointing the source at itself are
 * flagged as errors.
 */
export function validateProjectSourceRelationships(
  relationships: ProjectSourceRelationships,
  sourceId?: ProjectSourceId,
  base = "relationships",
): ProjectSourceIssue[] {
  const issues: ProjectSourceIssue[] = [];

  for (const field of REFERENCE_FIELDS) {
    const value = relationships[field];
    if (value !== undefined && !isNonEmptyString(value)) {
      issues.push(
        projectSourceError(
          "empty_relationship_reference",
          `Source relationships declare an empty ${field} reference`,
          `${base}.${field}`,
        ),
      );
    }
  }

  if (sourceId !== undefined) {
    for (const field of SELF_REFERENCE_FIELDS) {
      if (relationships[field] === sourceId) {
        issues.push(
          projectSourceError(
            "self_relationship",
            `Source relationships point ${field} at the source itself`,
            `${base}.${field}`,
          ),
        );
      }
    }
  }

  if (relationships.related !== undefined && !Array.isArray(relationships.related)) {
    issues.push(
      projectSourceError(
        "invalid_related_list",
        "Source relationships declare a non-list related value",
        `${base}.related`,
      ),
    );
  } else if (relationships.related !== undefined) {
    const seen = new Set<string>();
    const related = relationships.related;
    related.forEach((id, index) => {
      if (!isNonEmptyString(id)) {
        issues.push(
          projectSourceError(
            "empty_relationship_reference",
            "Source relationships declare an empty related reference",
            `${base}.related.${index}`,
          ),
        );
        return;
      }
      if (seen.has(id)) {
        issues.push(
          projectSourceError(
            "duplicate_related_reference",
            `Source relationships repeat the related reference "${id}"`,
            `${base}.related.${index}`,
          ),
        );
      }
      seen.add(id);
      if (sourceId !== undefined && id === sourceId) {
        issues.push(
          projectSourceError(
            "self_relationship",
            "Source relationships list the source itself as related",
            `${base}.related.${index}`,
          ),
        );
      }
    });
  }

  return issues;
}
