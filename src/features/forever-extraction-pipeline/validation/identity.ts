/**
 * Forever Extraction Pipeline — identity validation.
 *
 * Structural guards over an {@link ExtractionIdentity}: the required fields
 * must be present, and a slug that is not already normalized is flagged as a
 * warning (never rewritten — RC4.5 reports, it does not mutate). All checks
 * return issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import { normalizeExtractionSlug } from "../identity";
import type { ExtractionIdentity } from "../identity";
import { extractionError, extractionWarning } from "../types";
import type { ExtractionIssue } from "../types";

/** Validate an extraction identity's required fields and slug normalization. */
export function validateExtractionIdentity(
  identity: ExtractionIdentity,
  base = "identity",
): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      extractionError(
        "missing_extraction_id",
        "Extraction identity is missing an id",
        `${base}.id`,
      ),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      extractionError(
        "missing_extraction_slug",
        "Extraction identity is missing a slug",
        `${base}.slug`,
      ),
    );
  } else if (identity.slug !== normalizeExtractionSlug(identity.slug)) {
    issues.push(
      extractionWarning(
        "unnormalized_extraction_slug",
        `Extraction slug "${identity.slug}" is not normalized to the RC3.0 slug rule`,
        `${base}.slug`,
      ),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      extractionError(
        "missing_extraction_name",
        "Extraction identity is missing a name",
        `${base}.name`,
      ),
    );
  }
  return issues;
}
