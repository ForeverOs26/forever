/**
 * Forever Project Factory — identity validation.
 *
 * Structural guards over a {@link FactoryIdentity}: the required fields must be
 * present, the `scope` must be a known scope, and a slug that is not already
 * normalized is flagged as a warning (never rewritten — RC4.3 reports, it does
 * not mutate). All checks return issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import { normalizeFactorySlug } from "../identity";
import type { FactoryIdentity } from "../identity";
import { factoryError, factoryWarning, isKnownFactoryScope } from "../types";
import type { FactoryIssue } from "../types";

/** Validate a factory identity's required fields, scope, and slug normalization. */
export function validateFactoryIdentity(
  identity: FactoryIdentity,
  base = "identity",
): FactoryIssue[] {
  const issues: FactoryIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      factoryError("missing_factory_id", "Factory identity is missing an id", `${base}.id`),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      factoryError("missing_factory_slug", "Factory identity is missing a slug", `${base}.slug`),
    );
  } else if (identity.slug !== normalizeFactorySlug(identity.slug)) {
    issues.push(
      factoryWarning(
        "unnormalized_factory_slug",
        `Factory slug "${identity.slug}" is not normalized to the RC3.0 slug rule`,
        `${base}.slug`,
      ),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      factoryError("missing_factory_name", "Factory identity is missing a name", `${base}.name`),
    );
  }
  if (!isKnownFactoryScope(identity.scope)) {
    issues.push(
      factoryError(
        "unknown_factory_scope",
        `Factory identity has an unknown scope "${String(identity.scope)}"`,
        `${base}.scope`,
      ),
    );
  }
  return issues;
}
