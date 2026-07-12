/**
 * Forever Canonical Project Database — the database validation pipeline.
 *
 * Composes the record guard into one deterministic pass over a
 * {@link ProjectDatabase}. This is the single entry point a caller uses
 * before treating a database as coherent. It never throws — it returns a
 * structured {@link ProjectValidation} verdict, and a structurally absent
 * part (`null` or `undefined`) is reported as missing, never dereferenced.
 *
 * Cross-record integrity is resolved here — it is where the foundation's
 * core rule is enforced: every project has exactly one canonical record, so
 * no two records may share a project id, a surrogate id, or a natural slug
 * key. A project described twice is flagged, never silently deduplicated.
 */

import type { ProjectDatabase } from "../database";
import { isAbsent, isNonEmptyString, projectRecordKey } from "../helpers";
import type { ProjectRecord } from "../record";
import { partitionProjectDatabaseIssues, projectDatabaseError } from "../types";
import type { ProjectDatabaseError, ProjectDatabaseIssue, ProjectDatabaseWarning } from "../types";
import { validateProjectRecord } from "./record";

/** The structured verdict of the database, catalogue, and registry pipelines. */
export interface ProjectValidation {
  valid: boolean;
  issues: ProjectDatabaseIssue[];
  errors: ProjectDatabaseError[];
  warnings: ProjectDatabaseWarning[];
}

/** Assemble a {@link ProjectValidation} verdict from raised issues. */
export function projectValidationVerdict(issues: ProjectDatabaseIssue[]): ProjectValidation {
  const { errors, warnings } = partitionProjectDatabaseIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}

/**
 * Validate a list of canonical records: each record individually, plus the
 * cross-record integrity rule — no two records may share a project id (every
 * project has exactly one canonical record), a surrogate id, or a natural
 * slug key. Shared by the database, catalogue, and registry pipelines so one
 * rule judges canonical uniqueness everywhere.
 */
export function validateProjectRecordsIntegrity(
  records: readonly ProjectRecord[],
  base = "records",
): ProjectDatabaseIssue[] {
  if (!Array.isArray(records)) {
    return [projectDatabaseError("invalid_records", "Records must be a list", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];
  const seenIds = new Set<string>();
  const seenProjects = new Set<string>();
  const seenKeys = new Set<string>();

  records.forEach((record, index) => {
    issues.push(...validateProjectRecord(record, `${base}.${index}`));
    if (isAbsent(record) || isAbsent(record.identity)) return;

    const id = record.identity.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          projectDatabaseError(
            "duplicate_record_id",
            `Record id "${id}" is described more than once`,
            `${base}.${index}.identity.id`,
          ),
        );
      }
      seenIds.add(id);
    }

    const projectId = record.identity.projectId;
    if (isNonEmptyString(projectId)) {
      if (seenProjects.has(projectId)) {
        issues.push(
          projectDatabaseError(
            "duplicate_project_record",
            `Project "${projectId}" is described by more than one canonical record — every project has exactly one`,
            `${base}.${index}.identity.projectId`,
          ),
        );
      }
      seenProjects.add(projectId);
    }

    const key = projectRecordKey(record);
    if (isNonEmptyString(key)) {
      if (seenKeys.has(key)) {
        issues.push(
          projectDatabaseError(
            "duplicate_record_key",
            `Record slug "${key}" is described more than once`,
            `${base}.${index}.identity.slug`,
          ),
        );
      }
      seenKeys.add(key);
    }
  });

  return issues;
}

/**
 * Run the full validation suite over a canonical database.
 *
 * Validates the database id, the records list shape, every record, and the
 * cross-record uniqueness of project ids, surrogate ids, and natural slug
 * keys. Issues from every check are merged in a stable order.
 */
export function validateProjectDatabase(database: ProjectDatabase): ProjectValidation {
  const issues: ProjectDatabaseIssue[] = [];

  if (isAbsent(database)) {
    return projectValidationVerdict([
      projectDatabaseError("missing_database", "Canonical database is absent", "database"),
    ]);
  }

  if (!isNonEmptyString(database.id)) {
    issues.push(
      projectDatabaseError("missing_database_id", "Canonical database is missing an id", "id"),
    );
  }
  if (database.name !== undefined && !isNonEmptyString(database.name)) {
    issues.push(
      projectDatabaseError(
        "empty_database_name",
        "Canonical database declares an empty name",
        "name",
      ),
    );
  }

  issues.push(...validateProjectRecordsIntegrity(database.records, "records"));

  return projectValidationVerdict(issues);
}
