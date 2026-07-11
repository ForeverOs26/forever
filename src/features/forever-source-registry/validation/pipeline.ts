/**
 * Forever Source Registry — the validation pipeline.
 *
 * Composes the individual guards (identity, version, capabilities, definition,
 * and entry) into one deterministic pass over a {@link SourceRegistry}. This is
 * the single entry point a caller uses before treating a catalogue as coherent.
 * It never throws — it returns a structured verdict.
 *
 * Cross-entry integrity is resolved here: a registry must have an id, and no two
 * entries may share a source id or a natural `type:slug` key, so a source can
 * never be registered twice under a different surrogate id.
 */

import type { SourceRegistry } from "../entry";
import { isNonEmptyString, sourceDefinitionKey } from "../helpers";
import { partitionSourceIssues, sourceError } from "../result";
import type { SourceError, SourceIssue, SourceWarning } from "../types";
import { validateSourceRegistryEntry } from "./entry";

/** The structured verdict of {@link validateSourceRegistry}. */
export interface SourceValidation {
  valid: boolean;
  issues: SourceIssue[];
  errors: SourceError[];
  warnings: SourceWarning[];
}

/**
 * Run the full validation suite over a registry.
 *
 * Validates the registry id, every entry, and the uniqueness of both surrogate
 * ids and natural `type:slug` keys across entries. Issues from every check are
 * merged in a stable order.
 */
export function validateSourceRegistry(registry: SourceRegistry): SourceValidation {
  const issues: SourceIssue[] = [];

  if (!isNonEmptyString(registry.id)) {
    issues.push(sourceError("missing_registry_id", "Source registry is missing an id", "id"));
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  registry.entries.forEach((entry, index) => {
    issues.push(...validateSourceRegistryEntry(entry));

    const id = entry.definition.identity.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          sourceError(
            "duplicate_source_id",
            `Source id "${id}" is registered more than once`,
            `entries.${index}.definition.identity.id`,
          ),
        );
      }
      seenIds.add(id);
    }

    const key = sourceDefinitionKey(entry.definition);
    if (seenKeys.has(key)) {
      issues.push(
        sourceError(
          "duplicate_source_key",
          `Source "${key}" is registered more than once`,
          `entries.${index}.definition.identity.slug`,
        ),
      );
    }
    seenKeys.add(key);
  });

  const { errors, warnings } = partitionSourceIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
