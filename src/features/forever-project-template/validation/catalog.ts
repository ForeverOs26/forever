/**
 * Forever Project Template — the catalogue validation pipeline.
 *
 * Composes the package guard into one deterministic pass over a
 * {@link ProjectCatalog}. This is the single entry point a caller uses before
 * treating a catalogue as coherent. It never throws — it returns a structured
 * verdict.
 *
 * Cross-entry integrity is resolved here: a catalogue must have an id, each
 * entry's `enabled` flag must be a boolean, and no two entries may share a package
 * id or a natural `scope:slug` key, so a project can never be registered twice
 * under a different surrogate id.
 */

import type { ProjectCatalog, ProjectCatalogEntry } from "../catalog";
import { isNonEmptyString, projectPackageKey } from "../helpers";
import {
  partitionProjectTemplateIssues,
  projectTemplateError,
} from "../types";
import type {
  ProjectTemplateError,
  ProjectTemplateIssue,
  ProjectTemplateWarning,
} from "../types";
import { validateProjectPackage } from "./package";

/** The structured verdict of {@link validateProjectCatalog}. */
export interface ProjectTemplateValidation {
  valid: boolean;
  issues: ProjectTemplateIssue[];
  errors: ProjectTemplateError[];
  warnings: ProjectTemplateWarning[];
}

/** Validate one catalogue entry's flag and its package. */
export function validateProjectCatalogEntry(
  entry: ProjectCatalogEntry,
): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  if (typeof entry.enabled !== "boolean") {
    issues.push(
      projectTemplateError(
        "invalid_enabled_flag",
        `Catalogue entry has a non-boolean enabled flag "${String(entry.enabled)}"`,
        "enabled",
      ),
    );
  }
  issues.push(...validateProjectPackage(entry.package));
  return issues;
}

/**
 * Run the full validation suite over a catalogue.
 *
 * Validates the catalogue id, every entry, and the uniqueness of both surrogate
 * ids and natural `scope:slug` keys across entries. Issues from every check are
 * merged in a stable order.
 */
export function validateProjectCatalog(catalog: ProjectCatalog): ProjectTemplateValidation {
  const issues: ProjectTemplateIssue[] = [];

  if (!isNonEmptyString(catalog.id)) {
    issues.push(
      projectTemplateError("missing_catalog_id", "Project catalogue is missing an id", "id"),
    );
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
  entries.forEach((entry, index) => {
    issues.push(...validateProjectCatalogEntry(entry));

    const id = entry.package.identity.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          projectTemplateError(
            "duplicate_package_id",
            `Package id "${id}" is registered more than once`,
            `entries.${index}.package.identity.id`,
          ),
        );
      }
      seenIds.add(id);
    }

    const key = projectPackageKey(entry.package);
    if (seenKeys.has(key)) {
      issues.push(
        projectTemplateError(
          "duplicate_package_key",
          `Package "${key}" is registered more than once`,
          `entries.${index}.package.identity.slug`,
        ),
      );
    }
    seenKeys.add(key);
  });

  const { errors, warnings } = partitionProjectTemplateIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
