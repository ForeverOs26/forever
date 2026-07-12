/**
 * Forever Cross-Source Validation — catalogue validation.
 *
 * Structural guards over the catalogue data model: an entry must carry a
 * coherent report, a boolean enablement, and coherent optional registration
 * facts; a catalogue must carry an id and must not catalogue the same report
 * id twice. A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import type { CrossValidationCatalog, CrossValidationCatalogEntry } from "../catalog";
import { isAbsent, isNonEmptyString } from "../helpers";
import { crossValidationError } from "../types";
import type { CrossValidationIssue } from "../types";
import { validateCrossValidationReport } from "./report";

/** Validate one catalogue entry. `base` locates it; e.g. `entries.0`. */
export function validateCrossValidationCatalogEntry(
  entry: CrossValidationCatalogEntry,
  base = "entry",
): CrossValidationIssue[] {
  if (isAbsent(entry)) {
    return [crossValidationError("missing_entry", "Catalog entry is absent", base)];
  }
  const issues: CrossValidationIssue[] = [];

  if (isAbsent(entry.report)) {
    issues.push(
      crossValidationError(
        "missing_entry_report",
        "Catalog entry carries no report",
        `${base}.report`,
      ),
    );
  } else {
    issues.push(...validateCrossValidationReport(entry.report, `${base}.report`));
  }
  if (typeof entry.enabled !== "boolean") {
    issues.push(
      crossValidationError(
        "invalid_entry_enabled",
        "Catalog entry does not state whether it is enabled",
        `${base}.enabled`,
      ),
    );
  }
  if (entry.registeredAt !== undefined && !isNonEmptyString(entry.registeredAt)) {
    issues.push(
      crossValidationError(
        "empty_entry_time",
        "Catalog entry declares an empty registration time",
        `${base}.registeredAt`,
      ),
    );
  }
  if (entry.notes !== undefined && !isNonEmptyString(entry.notes)) {
    issues.push(
      crossValidationError(
        "empty_entry_notes",
        "Catalog entry declares empty notes",
        `${base}.notes`,
      ),
    );
  }

  return issues;
}

/** Validate a whole catalogue. `base` locates it; empty when standalone. */
export function validateCrossValidationCatalog(
  catalog: CrossValidationCatalog,
  base = "",
): CrossValidationIssue[] {
  const at = (path: string) => (base === "" ? path : `${base}.${path}`);
  if (isAbsent(catalog)) {
    return [
      crossValidationError(
        "missing_catalog",
        "Cross-validation catalogue is absent",
        base === "" ? "catalog" : base,
      ),
    ];
  }
  const issues: CrossValidationIssue[] = [];

  if (!isNonEmptyString(catalog.id)) {
    issues.push(crossValidationError("missing_catalog_id", "Catalog is missing an id", at("id")));
  }
  if (!Array.isArray(catalog.entries)) {
    issues.push(
      crossValidationError(
        "invalid_catalog_entries",
        "Catalog entries must be a list",
        at("entries"),
      ),
    );
    return issues;
  }

  const seenReportIds = new Set<string>();
  catalog.entries.forEach((entry, index) => {
    const entryBase = at(`entries.${index}`);
    issues.push(...validateCrossValidationCatalogEntry(entry, entryBase));
    const reportId = entry?.report?.id;
    if (isNonEmptyString(reportId)) {
      if (seenReportIds.has(reportId)) {
        issues.push(
          crossValidationError(
            "duplicate_report_id",
            `Catalog registers the report "${reportId}" more than once`,
            `${entryBase}.report.id`,
          ),
        );
      }
      seenReportIds.add(reportId);
    }
  });

  return issues;
}
