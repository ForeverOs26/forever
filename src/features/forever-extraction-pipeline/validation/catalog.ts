/**
 * Forever Extraction Pipeline — the catalogue validation pipeline.
 *
 * Composes the definition guard into one deterministic pass over an
 * {@link ExtractionCatalog}. This is the single entry point a caller uses
 * before treating a catalogue as coherent. It never throws — it returns a
 * structured {@link ExtractionValidation} verdict, and a structurally absent
 * part (`null` or `undefined`) is reported as missing, never dereferenced.
 *
 * Cross-entry integrity is resolved here: a catalogue must have an id, each
 * entry's `enabled` flag must be a boolean, and no two entries may share a
 * definition id or a natural slug key, so a pipeline can never be registered
 * twice under a different surrogate id.
 */

import type { ExtractionCatalog, ExtractionCatalogEntry } from "../catalog";
import { extractionDefinitionKey, isAbsent, isNonEmptyString } from "../helpers";
import { extractionError, partitionExtractionIssues } from "../types";
import type { ExtractionError, ExtractionIssue, ExtractionWarning } from "../types";
import { validateExtractionDefinition } from "./definition";

/** The structured verdict of {@link validateExtractionCatalog}. */
export interface ExtractionValidation {
  valid: boolean;
  issues: ExtractionIssue[];
  errors: ExtractionError[];
  warnings: ExtractionWarning[];
}

/** Validate one catalogue entry's flag and its definition. */
export function validateExtractionCatalogEntry(entry: ExtractionCatalogEntry): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];
  if (typeof entry?.enabled !== "boolean") {
    issues.push(
      extractionError(
        "invalid_enabled_flag",
        `Catalogue entry has a non-boolean enabled flag "${String(entry?.enabled)}"`,
        "enabled",
      ),
    );
  }
  if (isAbsent(entry?.definition)) {
    issues.push(
      extractionError(
        "missing_entry_definition",
        "Catalogue entry is missing its definition",
        "definition",
      ),
    );
  } else {
    issues.push(...validateExtractionDefinition(entry.definition));
  }
  return issues;
}

/**
 * Run the full validation suite over a catalogue.
 *
 * Validates the catalogue id, the entries list shape, every entry, and the
 * uniqueness of both surrogate ids and natural slug keys across entries.
 * Issues from every check are merged in a stable order.
 */
export function validateExtractionCatalog(catalog: ExtractionCatalog): ExtractionValidation {
  const issues: ExtractionIssue[] = [];

  if (!isNonEmptyString(catalog.id)) {
    issues.push(
      extractionError("missing_catalog_id", "Extraction catalogue is missing an id", "id"),
    );
  }

  if (!Array.isArray(catalog.entries)) {
    issues.push(
      extractionError("invalid_entries", "Extraction catalogue entries must be a list", "entries"),
    );
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  entries.forEach((entry, index) => {
    issues.push(...validateExtractionCatalogEntry(entry));

    const definition = entry?.definition;
    if (isAbsent(definition) || isAbsent(definition.identity)) {
      return;
    }

    const id = definition.identity.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          extractionError(
            "duplicate_extraction_id",
            `Extraction definition id "${id}" is registered more than once`,
            `entries.${index}.definition.identity.id`,
          ),
        );
      }
      seenIds.add(id);
    }

    const key = extractionDefinitionKey(definition);
    if (isNonEmptyString(key)) {
      if (seenKeys.has(key)) {
        issues.push(
          extractionError(
            "duplicate_extraction_key",
            `Extraction definition "${key}" is registered more than once`,
            `entries.${index}.definition.identity.slug`,
          ),
        );
      }
      seenKeys.add(key);
    }
  });

  const { errors, warnings } = partitionExtractionIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
