/**
 * Forever Canonical Project Database — the registry validation pipeline.
 *
 * One deterministic pass over a {@link ProjectRegistry}: every registered
 * record is judged by the shared records-integrity rule the database and
 * catalogue pipelines use — each record individually coherent, and no two
 * sharing a project id, surrogate id, or natural slug key. The registry's
 * own keying already prevents double-registering a project at wiring time;
 * this pipeline additionally judges what was registered, so a registry over
 * incoherent records is reported, never trusted. It never throws — it
 * returns a structured {@link ProjectValidation} verdict.
 */

import { isAbsent } from "../helpers";
import type { ProjectRegistry } from "../registry";
import { projectDatabaseError } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import type { ProjectValidation } from "./database";
import { projectValidationVerdict, validateProjectRecordsIntegrity } from "./database";

/** Run the full validation suite over a registry's registered records. */
export function validateProjectRegistry(registry: ProjectRegistry): ProjectValidation {
  if (isAbsent(registry) || typeof registry.list !== "function") {
    return projectValidationVerdict([
      projectDatabaseError("missing_registry", "Project registry is absent", "registry"),
    ]);
  }
  const issues: ProjectDatabaseIssue[] = validateProjectRecordsIntegrity(
    registry.list(),
    "records",
  );
  return projectValidationVerdict(issues);
}
