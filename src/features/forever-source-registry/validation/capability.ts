/**
 * Forever Source Registry — capability validation.
 *
 * Guards that a source's capability list is well-formed: every entry names a
 * known {@link SourceCapabilityKind}, and no kind is declared twice (a duplicate
 * is ambiguous — a source cannot both support and not support the same kind).
 * All checks return issues; none throw.
 */

import { isKnownCapabilityKind, type SourceCapability } from "../capability";
import { sourceError } from "../result";
import type { SourceIssue } from "../types";

/** Validate a capability list for known kinds and no duplicates. */
export function validateSourceCapabilities(
  capabilities: readonly SourceCapability[],
): SourceIssue[] {
  const issues: SourceIssue[] = [];
  const seen = new Set<string>();
  capabilities.forEach((capability, index) => {
    if (!isKnownCapabilityKind(capability.kind)) {
      issues.push(
        sourceError(
          "unknown_capability_kind",
          `Unknown capability kind "${String(capability.kind)}"`,
          `capabilities.${index}.kind`,
        ),
      );
      return;
    }
    if (seen.has(capability.kind)) {
      issues.push(
        sourceError(
          "duplicate_capability",
          `Capability "${capability.kind}" is declared more than once`,
          `capabilities.${index}.kind`,
        ),
      );
    }
    seen.add(capability.kind);
  });
  return issues;
}
