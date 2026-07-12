/**
 * Forever Project Integration — identity validation.
 *
 * Structural guards over a {@link ProjectIntegrationIdentity}: id, slug, and name
 * must be present, and the `scope` must be a known {@link ProjectIntegrationScope}.
 * All checks return issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import {
  isKnownProjectIntegrationScope,
  type ProjectIntegrationIdentity,
} from "../identity";
import { projectIntegrationError } from "../result";
import type { ProjectIntegrationIssue } from "../types";

/** Validate an integration identity's required fields and scope. */
export function validateProjectIntegrationIdentity(
  identity: ProjectIntegrationIdentity,
): ProjectIntegrationIssue[] {
  const issues: ProjectIntegrationIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      projectIntegrationError(
        "missing_integration_id",
        "Integration identity is missing an id",
        "identity.id",
      ),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      projectIntegrationError(
        "missing_integration_slug",
        "Integration identity is missing a slug",
        "identity.slug",
      ),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      projectIntegrationError(
        "missing_integration_name",
        "Integration identity is missing a name",
        "identity.name",
      ),
    );
  }
  if (!isKnownProjectIntegrationScope(identity.scope)) {
    issues.push(
      projectIntegrationError(
        "unknown_integration_scope",
        `Integration identity has an unknown scope "${String(identity.scope)}"`,
        "identity.scope",
      ),
    );
  }
  return issues;
}
