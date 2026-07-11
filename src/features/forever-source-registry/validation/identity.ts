/**
 * Forever Source Registry — identity validation.
 *
 * Structural guards over a {@link SourceIdentity}: id, slug, and name must be
 * present; the type must be a known {@link SourceType}; and the declared category
 * must be the canonical one for that type. A category that disagrees with its
 * type is a warning, not a blocker — the type is authoritative, the category is
 * a denormalised convenience. All checks return issues; none throw.
 */

import { isKnownSourceType, sourceCategoryForType } from "../enums";
import { isNonEmptyString } from "../helpers";
import type { SourceIdentity } from "../identity";
import { sourceError, sourceWarning } from "../result";
import type { SourceIssue } from "../types";

/** Validate a source identity's required fields and type/category coherence. */
export function validateSourceIdentity(identity: SourceIdentity): SourceIssue[] {
  const issues: SourceIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      sourceError("missing_source_id", "Source identity is missing an id", "identity.id"),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      sourceError("missing_source_slug", "Source identity is missing a slug", "identity.slug"),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      sourceError("missing_source_name", "Source identity is missing a name", "identity.name"),
    );
  }
  if (!isKnownSourceType(identity.type)) {
    issues.push(
      sourceError(
        "unknown_source_type",
        `Source identity has an unknown type "${String(identity.type)}"`,
        "identity.type",
      ),
    );
    return issues;
  }
  const canonicalCategory = sourceCategoryForType(identity.type);
  if (identity.category !== canonicalCategory) {
    issues.push(
      sourceWarning(
        "category_mismatch",
        `Source category "${identity.category}" is not the canonical category "${canonicalCategory}" for type "${identity.type}"`,
        "identity.category",
      ),
    );
  }
  return issues;
}
