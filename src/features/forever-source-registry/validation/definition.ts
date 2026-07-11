/**
 * Forever Source Registry — definition validation.
 *
 * Composes the identity, version, and capability guards and adds the checks that
 * span a whole {@link SourceDefinition}: its lifecycle, priority, and trust must
 * be known values, and a source must declare at least one supported entity kind
 * (a source that supplies nothing is meaningless). All checks return issues;
 * none throw.
 */

import type { SourceDefinition } from "../definition";
import { isKnownSourceLifecycle } from "../lifecycle";
import { isKnownSourcePriority } from "../priority";
import { sourceError } from "../result";
import { isKnownSourceTrustLevel } from "../trust";
import type { SourceIssue } from "../types";
import { validateSourceCapabilities } from "./capability";
import { validateSourceIdentity } from "./identity";
import { validateSourceVersion } from "./version";

/** Validate a whole source definition, composing every sub-guard. */
export function validateSourceDefinition(definition: SourceDefinition): SourceIssue[] {
  const issues: SourceIssue[] = [];
  issues.push(...validateSourceIdentity(definition.identity));
  issues.push(...validateSourceVersion(definition.version));
  issues.push(...validateSourceCapabilities(definition.capabilities));

  if (!isKnownSourceLifecycle(definition.lifecycle)) {
    issues.push(
      sourceError(
        "unknown_lifecycle",
        `Source has an unknown lifecycle "${String(definition.lifecycle)}"`,
        "lifecycle",
      ),
    );
  }
  if (!isKnownSourcePriority(definition.priority)) {
    issues.push(
      sourceError(
        "unknown_priority",
        `Source has an unknown priority "${String(definition.priority)}"`,
        "priority",
      ),
    );
  }
  if (!isKnownSourceTrustLevel(definition.trustLevel)) {
    issues.push(
      sourceError(
        "unknown_trust_level",
        `Source has an unknown trust level "${String(definition.trustLevel)}"`,
        "trustLevel",
      ),
    );
  }
  if (definition.supportedEntities.length === 0) {
    issues.push(
      sourceError(
        "no_supported_entities",
        "Source must supply at least one canonical entity kind",
        "supportedEntities",
      ),
    );
  }
  return issues;
}
