/**
 * Forever Project Sources — the catalogue validation pipeline.
 *
 * Composes the definition guard into one deterministic pass over a
 * {@link ProjectSourceCatalog}. This is the single entry point a caller uses
 * before treating a catalogue as coherent. It never throws — it returns a
 * structured {@link ProjectSourceValidation} verdict, and a structurally
 * absent part (`null` or `undefined`) is reported as missing, never
 * dereferenced.
 *
 * Cross-entry integrity is resolved here: a catalogue must have an id, each
 * entry's `enabled` flag must be a boolean, no two entries may share a source
 * id or a natural `projectId:slug@version` revision key, and — as a warning —
 * no document should have more than one current revision, so a version chain
 * always has a single tip. Multiple *revisions* of the same document are
 * explicitly legal; only re-registering the same revision is a clash.
 */

import type { ProjectSourceCatalog, ProjectSourceCatalogEntry } from "../catalog";
import {
  isAbsent,
  isNonEmptyString,
  projectSourceDefinitionKey,
  projectSourceDocumentKey,
} from "../helpers";
import { isCurrentProjectSourceStatus, isKnownProjectSourceStatus } from "../status";
import { partitionProjectSourceIssues, projectSourceError, projectSourceWarning } from "../types";
import type { ProjectSourceError, ProjectSourceIssue, ProjectSourceWarning } from "../types";
import { validateProjectSourceDefinition } from "./definition";

/** The structured verdict of {@link validateProjectSourceCatalog}. */
export interface ProjectSourceValidation {
  valid: boolean;
  issues: ProjectSourceIssue[];
  errors: ProjectSourceError[];
  warnings: ProjectSourceWarning[];
}

/** Validate one catalogue entry's flag and its definition. */
export function validateProjectSourceCatalogEntry(
  entry: ProjectSourceCatalogEntry,
): ProjectSourceIssue[] {
  const issues: ProjectSourceIssue[] = [];
  if (typeof entry?.enabled !== "boolean") {
    issues.push(
      projectSourceError(
        "invalid_enabled_flag",
        `Catalogue entry has a non-boolean enabled flag "${String(entry?.enabled)}"`,
        "enabled",
      ),
    );
  }
  if (isAbsent(entry?.definition)) {
    issues.push(
      projectSourceError(
        "missing_entry_definition",
        "Catalogue entry is missing its definition",
        "definition",
      ),
    );
  } else {
    issues.push(...validateProjectSourceDefinition(entry.definition));
  }
  return issues;
}

/**
 * Run the full validation suite over a catalogue.
 *
 * Validates the catalogue id, the entries list shape, every entry, the
 * uniqueness of both surrogate ids and natural revision keys across entries,
 * and — as a warning — that no document carries more than one enabled,
 * current revision. Issues from every check are merged in a stable order.
 */
export function validateProjectSourceCatalog(
  catalog: ProjectSourceCatalog,
): ProjectSourceValidation {
  const issues: ProjectSourceIssue[] = [];

  if (!isNonEmptyString(catalog.id)) {
    issues.push(
      projectSourceError("missing_catalog_id", "Source catalogue is missing an id", "id"),
    );
  }

  if (!Array.isArray(catalog.entries)) {
    issues.push(
      projectSourceError("invalid_entries", "Source catalogue entries must be a list", "entries"),
    );
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const currentByDocument = new Map<string, number>();
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  entries.forEach((entry, index) => {
    issues.push(...validateProjectSourceCatalogEntry(entry));

    const definition = entry?.definition;
    if (isAbsent(definition) || isAbsent(definition.identity)) {
      return;
    }

    const id = definition.identity.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          projectSourceError(
            "duplicate_source_id",
            `Source id "${id}" is registered more than once`,
            `entries.${index}.definition.identity.id`,
          ),
        );
      }
      seenIds.add(id);
    }

    if (!isAbsent(definition.version)) {
      const key = projectSourceDefinitionKey(definition);
      if (seenKeys.has(key)) {
        issues.push(
          projectSourceError(
            "duplicate_source_revision",
            `Source revision "${key}" is registered more than once`,
            `entries.${index}.definition.identity.slug`,
          ),
        );
      }
      seenKeys.add(key);
    }

    if (
      entry.enabled === true &&
      isKnownProjectSourceStatus(definition.status) &&
      isCurrentProjectSourceStatus(definition.status)
    ) {
      const documentKey = projectSourceDocumentKey(definition.identity);
      const count = (currentByDocument.get(documentKey) ?? 0) + 1;
      currentByDocument.set(documentKey, count);
      if (count === 2) {
        issues.push(
          projectSourceWarning(
            "multiple_current_revisions",
            `Document "${documentKey}" has more than one enabled, current revision`,
            `entries.${index}.definition.status`,
          ),
        );
      }
    }
  });

  const { errors, warnings } = partitionProjectSourceIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
