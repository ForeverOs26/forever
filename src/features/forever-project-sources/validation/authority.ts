/**
 * Forever Project Sources — authority validation.
 *
 * Structural guards over a {@link ProjectSourceAuthority}: the kind must be a
 * known issuer, the trust must be a known RC3.3 trust level, and `verifiedBy`
 * — when present — must be non-empty. All checks return issues; none throw.
 */

import type { ProjectSourceAuthority } from "../authority";
import { isKnownProjectSourceAuthorityKind, isKnownProjectSourceTrustLevel } from "../authority";
import { isNonEmptyString } from "../helpers";
import { projectSourceError } from "../types";
import type { ProjectSourceIssue } from "../types";

/** Validate an authority's kind, trust level, and optional attribution. */
export function validateProjectSourceAuthority(
  authority: ProjectSourceAuthority,
  base = "authority",
): ProjectSourceIssue[] {
  const issues: ProjectSourceIssue[] = [];
  if (!isKnownProjectSourceAuthorityKind(authority.kind)) {
    issues.push(
      projectSourceError(
        "unknown_authority_kind",
        `Source authority has an unknown kind "${String(authority.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (!isKnownProjectSourceTrustLevel(authority.trust)) {
    issues.push(
      projectSourceError(
        "unknown_trust_level",
        `Source authority has an unknown trust level "${String(authority.trust)}"`,
        `${base}.trust`,
      ),
    );
  }
  if (authority.verifiedBy !== undefined && !isNonEmptyString(authority.verifiedBy)) {
    issues.push(
      projectSourceError(
        "empty_verified_by",
        "Source authority declares an empty verifiedBy",
        `${base}.verifiedBy`,
      ),
    );
  }
  return issues;
}
