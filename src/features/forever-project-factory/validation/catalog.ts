/**
 * Forever Project Factory — the catalogue validation pipeline.
 *
 * Composes the definition guard into one deterministic pass over a
 * {@link FactoryCatalog}. This is the single entry point a caller uses before
 * treating a catalogue as coherent. It never throws — it returns a structured
 * verdict.
 *
 * Cross-entry integrity is resolved here: a catalogue must have an id, each
 * entry's `enabled` flag must be a boolean, and no two entries may share a
 * factory id or a natural `scope:slug` key, so a factory can never be
 * registered twice under a different surrogate id.
 */

import type { FactoryCatalog, FactoryCatalogEntry } from "../catalog";
import { factoryDefinitionKey, isNonEmptyString } from "../helpers";
import { factoryError, partitionFactoryIssues } from "../types";
import type { FactoryError, FactoryIssue, FactoryWarning } from "../types";
import { validateFactoryDefinition } from "./definition";

/** The structured verdict of {@link validateFactoryCatalog}. */
export interface FactoryValidation {
  valid: boolean;
  issues: FactoryIssue[];
  errors: FactoryError[];
  warnings: FactoryWarning[];
}

/** Validate one catalogue entry's flag and its definition. */
export function validateFactoryCatalogEntry(entry: FactoryCatalogEntry): FactoryIssue[] {
  const issues: FactoryIssue[] = [];
  if (typeof entry.enabled !== "boolean") {
    issues.push(
      factoryError(
        "invalid_enabled_flag",
        `Catalogue entry has a non-boolean enabled flag "${String(entry.enabled)}"`,
        "enabled",
      ),
    );
  }
  issues.push(...validateFactoryDefinition(entry.definition));
  return issues;
}

/**
 * Run the full validation suite over a catalogue.
 *
 * Validates the catalogue id, every entry, and the uniqueness of both surrogate
 * ids and natural `scope:slug` keys across entries. Issues from every check are
 * merged in a stable order.
 */
export function validateFactoryCatalog(catalog: FactoryCatalog): FactoryValidation {
  const issues: FactoryIssue[] = [];

  if (!isNonEmptyString(catalog.id)) {
    issues.push(factoryError("missing_catalog_id", "Factory catalogue is missing an id", "id"));
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  entries.forEach((entry, index) => {
    issues.push(...validateFactoryCatalogEntry(entry));

    const id = entry.definition.identity.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          factoryError(
            "duplicate_factory_id",
            `Factory id "${id}" is registered more than once`,
            `entries.${index}.definition.identity.id`,
          ),
        );
      }
      seenIds.add(id);
    }

    const key = factoryDefinitionKey(entry.definition);
    if (seenKeys.has(key)) {
      issues.push(
        factoryError(
          "duplicate_factory_key",
          `Factory "${key}" is registered more than once`,
          `entries.${index}.definition.identity.slug`,
        ),
      );
    }
    seenKeys.add(key);
  });

  const { errors, warnings } = partitionFactoryIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
