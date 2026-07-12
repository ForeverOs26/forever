/**
 * Forever Canonical Project Database — the catalogue validation pipeline.
 *
 * Composes the record guard into one deterministic pass over a
 * {@link ProjectCatalog}. This is the single entry point a caller uses before
 * treating a catalogue as coherent. It never throws — it returns a structured
 * {@link ProjectValidation} verdict, and a structurally absent part (`null`
 * or `undefined`) is reported as missing, never dereferenced.
 *
 * Cross-entry integrity is resolved here by the same rule the database
 * pipeline uses: a catalogue must have an id, each entry's `enabled` flag
 * must be a boolean, and no two entries may catalogue the same project,
 * record id, or natural slug key — a project can never be catalogued twice
 * under a different surrogate id.
 */

import type { ProjectCatalog, ProjectCatalogEntry } from "../catalog";
import { isAbsent, isNonEmptyString } from "../helpers";
import { projectDatabaseError } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import type { ProjectValidation } from "./database";
import { projectValidationVerdict, validateProjectRecordsIntegrity } from "./database";
import { projectTimestampIssues } from "./value";

/** Validate one catalogue entry's standing flags. */
export function validateProjectDatabaseCatalogEntry(
  entry: ProjectCatalogEntry,
  base = "",
): ProjectDatabaseIssue[] {
  const issues: ProjectDatabaseIssue[] = [];
  const at = (path: string) => (base === "" ? path : `${base}.${path}`);
  if (typeof entry?.enabled !== "boolean") {
    issues.push(
      projectDatabaseError(
        "invalid_enabled_flag",
        `Catalogue entry has a non-boolean enabled flag "${String(entry?.enabled)}"`,
        at("enabled"),
      ),
    );
  }
  if (isAbsent(entry?.record)) {
    issues.push(
      projectDatabaseError(
        "missing_entry_record",
        "Catalogue entry is missing its record",
        at("record"),
      ),
    );
  }
  if (entry?.registeredAt !== undefined) {
    issues.push(
      ...projectTimestampIssues(
        entry.registeredAt,
        "registered_time",
        "Catalogue entry declares an empty registered time",
        at("registeredAt"),
      ),
    );
  }
  if (entry?.notes !== undefined && !isNonEmptyString(entry.notes)) {
    issues.push(
      projectDatabaseError(
        "empty_entry_notes",
        "Catalogue entry declares empty notes",
        at("notes"),
      ),
    );
  }
  return issues;
}

/**
 * Run the full validation suite over a catalogue.
 *
 * Validates the catalogue id, the entries list shape, every entry's flags,
 * and — through the shared records-integrity rule — every record and the
 * cross-entry uniqueness of project ids, surrogate ids, and natural slug
 * keys. Issues from every check are merged in a stable order.
 */
export function validateProjectDatabaseCatalog(catalog: ProjectCatalog): ProjectValidation {
  const issues: ProjectDatabaseIssue[] = [];

  if (isAbsent(catalog)) {
    return projectValidationVerdict([
      projectDatabaseError("missing_catalog", "Project catalogue is absent", "catalog"),
    ]);
  }

  if (!isNonEmptyString(catalog.id)) {
    issues.push(
      projectDatabaseError("missing_catalog_id", "Project catalogue is missing an id", "id"),
    );
  }

  if (!Array.isArray(catalog.entries)) {
    issues.push(
      projectDatabaseError(
        "invalid_entries",
        "Project catalogue entries must be a list",
        "entries",
      ),
    );
    return projectValidationVerdict(issues);
  }

  catalog.entries.forEach((entry, index) => {
    issues.push(...validateProjectDatabaseCatalogEntry(entry, `entries.${index}`));
  });

  // The catalogued records are judged by the very rule the database pipeline
  // uses — one definition of canonical uniqueness across the module. An
  // absent record is already reported by the entry guard, so its bare
  // `missing_record` duplicate is dropped, and the remaining paths are
  // re-rooted to locate records inside their entries.
  const records = catalog.entries.map((entry) => entry?.record as never);
  issues.push(
    ...validateProjectRecordsIntegrity(records, "entries")
      .filter((issue) => issue.code !== "missing_record")
      .map((issue) => ({
        ...issue,
        path: issue.path?.replace(/^entries\.(\d+)/, "entries.$1.record"),
      })),
  );

  return projectValidationVerdict(issues);
}
