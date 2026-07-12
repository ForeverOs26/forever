/**
 * Forever Project Readiness — catalogue validation.
 *
 * Structural guards over the catalogue data model: an entry must carry a
 * coherent report, a boolean enablement, and coherent optional registration
 * facts; a catalogue must carry an id and must not catalogue the same report
 * id twice. A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import type { ReadinessCatalog, ReadinessCatalogEntry } from "../catalog";
import { isAbsent, isNonEmptyString } from "../helpers";
import { readinessError } from "../types";
import type { ReadinessIssue } from "../types";
import { validateReadinessReport } from "./report";

/**
 * Validate one catalogue entry. `base` locates it; e.g. `entries.0`.
 *
 * Never throws: an entry so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateReadinessCatalogEntry(
  entry: ReadinessCatalogEntry,
  base = "entry",
): ReadinessIssue[] {
  try {
    return validateReadinessCatalogEntryUnguarded(entry, base);
  } catch {
    return [
      readinessError(
        "unvalidatable_input",
        "Catalog entry behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateReadinessCatalogEntryUnguarded(
  entry: ReadinessCatalogEntry,
  base: string,
): ReadinessIssue[] {
  if (isAbsent(entry)) {
    return [readinessError("missing_entry", "Catalog entry is absent", base)];
  }
  const issues: ReadinessIssue[] = [];

  if (isAbsent(entry.report)) {
    issues.push(
      readinessError("missing_entry_report", "Catalog entry carries no report", `${base}.report`),
    );
  } else {
    issues.push(...validateReadinessReport(entry.report, `${base}.report`));
  }
  if (typeof entry.enabled !== "boolean") {
    issues.push(
      readinessError(
        "invalid_entry_enabled",
        "Catalog entry does not state whether it is enabled",
        `${base}.enabled`,
      ),
    );
  }
  if (entry.registeredAt !== undefined && !isNonEmptyString(entry.registeredAt)) {
    issues.push(
      readinessError(
        "empty_entry_time",
        "Catalog entry declares an empty registration time",
        `${base}.registeredAt`,
      ),
    );
  }
  if (entry.notes !== undefined && !isNonEmptyString(entry.notes)) {
    issues.push(
      readinessError("empty_entry_notes", "Catalog entry declares empty notes", `${base}.notes`),
    );
  }

  return issues;
}

/**
 * Validate a whole catalogue. `base` locates it; empty when standalone.
 *
 * Never throws: a catalogue so hostile it cannot even be read settles into
 * one structured issue.
 */
export function validateReadinessCatalog(catalog: ReadinessCatalog, base = ""): ReadinessIssue[] {
  try {
    return validateReadinessCatalogUnguarded(catalog, base);
  } catch {
    return [
      readinessError(
        "unvalidatable_input",
        "Readiness catalogue behaved in a way that could not be validated",
        base === "" ? "catalog" : base,
      ),
    ];
  }
}

function validateReadinessCatalogUnguarded(
  catalog: ReadinessCatalog,
  base: string,
): ReadinessIssue[] {
  const at = (path: string) => (base === "" ? path : `${base}.${path}`);
  if (isAbsent(catalog)) {
    return [
      readinessError(
        "missing_catalog",
        "Readiness catalogue is absent",
        base === "" ? "catalog" : base,
      ),
    ];
  }
  const issues: ReadinessIssue[] = [];

  if (!isNonEmptyString(catalog.id)) {
    issues.push(readinessError("missing_catalog_id", "Catalog is missing an id", at("id")));
  }
  if (!Array.isArray(catalog.entries)) {
    issues.push(
      readinessError("invalid_catalog_entries", "Catalog entries must be a list", at("entries")),
    );
    return issues;
  }

  const seenReportIds = new Set<string>();
  // Indexed — never a hole-skipping iterator — so an absent slot is reported
  // as a missing entry instead of vanishing silently.
  for (let index = 0; index < catalog.entries.length; index += 1) {
    const entry = catalog.entries[index];
    const entryBase = at(`entries.${index}`);
    issues.push(...validateReadinessCatalogEntry(entry, entryBase));
    const reportId = entry?.report?.id;
    if (isNonEmptyString(reportId)) {
      if (seenReportIds.has(reportId)) {
        issues.push(
          readinessError(
            "duplicate_report_id",
            `Catalog registers the report "${reportId}" more than once`,
            `${entryBase}.report.id`,
          ),
        );
      }
      seenReportIds.add(reportId);
    }
  }

  return issues;
}
