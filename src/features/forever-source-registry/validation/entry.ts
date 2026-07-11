/**
 * Forever Source Registry — entry validation.
 *
 * Guards over a single {@link SourceRegistryEntry}: its status must be a known
 * {@link SourceStatus}, and its definition must pass full definition validation.
 * All checks return issues; none throw.
 */

import type { SourceRegistryEntry } from "../entry";
import { isKnownSourceStatus } from "../lifecycle";
import { sourceError } from "../result";
import type { SourceIssue } from "../types";
import { validateSourceDefinition } from "./definition";

/** Validate one registry entry's status and its definition. */
export function validateSourceRegistryEntry(entry: SourceRegistryEntry): SourceIssue[] {
  const issues: SourceIssue[] = [];
  if (!isKnownSourceStatus(entry.status)) {
    issues.push(
      sourceError(
        "unknown_status",
        `Registry entry has an unknown status "${String(entry.status)}"`,
        "status",
      ),
    );
  }
  issues.push(...validateSourceDefinition(entry.definition));
  return issues;
}
