/**
 * Forever Project Sources — definition validation.
 *
 * Composes the identity, descriptor, version, authority, status,
 * relationships, and policy guards and adds the checks that span a whole
 * {@link ProjectSourceDefinition}: the version and authority must be present,
 * the origin must be a known RC3.3 source-system type, and — as a warning — a
 * terminal-status source that a future revision superseded should carry the
 * `supersededBy` reference. The version and policy guards are the reused
 * RC3.3/RC4.0 ones; nothing is restated. A structurally absent part (`null` or
 * `undefined`) is reported as missing, never dereferenced. All checks return
 * issues; none throw.
 */

import type { ProjectSourceDefinition } from "../definition";
import { isAbsent } from "../helpers";
import { isKnownProjectSourceOriginType, projectSourceError, projectSourceWarning } from "../types";
import type { ProjectSourceIssue } from "../types";
import { validateProjectSourceAuthority } from "./authority";
import { validateProjectSourceDescriptor } from "./descriptor";
import { validateProjectSourceIdentity } from "./identity";
import { validateProjectSourcePolicy } from "./policy";
import { validateProjectSourceRelationships } from "./relationships";
import { validateProjectSourceStatus } from "./status";
import { validateProjectSourceVersion } from "./version";

/** Validate a whole source definition, composing every sub-guard. */
export function validateProjectSourceDefinition(
  definition: ProjectSourceDefinition,
): ProjectSourceIssue[] {
  const issues: ProjectSourceIssue[] = [];

  if (isAbsent(definition.identity)) {
    issues.push(
      projectSourceError("missing_source_identity", "Source is missing an identity", "identity"),
    );
  } else {
    issues.push(...validateProjectSourceIdentity(definition.identity));
  }

  if (isAbsent(definition.descriptor)) {
    issues.push(
      projectSourceError(
        "missing_source_descriptor",
        "Source is missing a descriptor",
        "descriptor",
      ),
    );
  } else {
    issues.push(...validateProjectSourceDescriptor(definition.descriptor));
  }

  if (isAbsent(definition.version)) {
    issues.push(
      projectSourceError("missing_source_version", "Source is missing a version", "version"),
    );
  } else {
    issues.push(...validateProjectSourceVersion(definition.version));
  }

  if (isAbsent(definition.authority)) {
    issues.push(
      projectSourceError("missing_source_authority", "Source is missing an authority", "authority"),
    );
  } else {
    issues.push(...validateProjectSourceAuthority(definition.authority));
  }

  issues.push(...validateProjectSourceStatus(definition.status));

  if (!isKnownProjectSourceOriginType(definition.origin)) {
    issues.push(
      projectSourceError(
        "unknown_source_origin",
        `Source has an unknown origin type "${String(definition.origin)}"`,
        "origin",
      ),
    );
  }

  if (!isAbsent(definition.relationships)) {
    issues.push(
      ...validateProjectSourceRelationships(definition.relationships, definition.identity?.id),
    );
  }

  if (!isAbsent(definition.policy)) {
    issues.push(...validateProjectSourcePolicy(definition.policy));
  }

  // A superseded source should say what replaced it, so a version chain stays
  // walkable — a missing back-reference is reported, never fabricated.
  if (definition.status === "superseded" && definition.relationships?.supersededBy === undefined) {
    issues.push(
      projectSourceWarning(
        "superseded_without_reference",
        "Source is superseded but names no superseding source",
        "relationships.supersededBy",
      ),
    );
  }

  return issues;
}
