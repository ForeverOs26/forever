/**
 * Forever Sync — job and endpoint validation.
 *
 * Structural guards over a {@link SyncJob} and its endpoints: ids and labels
 * must be present, and a job may not sync an endpoint to itself. All checks
 * return issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import { syncError } from "../result";
import type { SyncEndpoint, SyncIssue, SyncJob } from "../types";

/** Validate one endpoint (source or target) for required identity fields. */
export function validateSyncEndpoint(
  endpoint: SyncEndpoint | undefined,
  label: string,
): SyncIssue[] {
  const issues: SyncIssue[] = [];
  if (!endpoint) {
    issues.push(syncError("missing_endpoint", `The ${label} endpoint is missing`, label));
    return issues;
  }
  if (!isNonEmptyString(endpoint.id)) {
    issues.push(
      syncError("missing_endpoint_id", `The ${label} endpoint is missing an id`, `${label}.id`),
    );
  }
  if (!isNonEmptyString(endpoint.label)) {
    issues.push(
      syncError(
        "missing_endpoint_label",
        `The ${label} endpoint is missing a label`,
        `${label}.label`,
      ),
    );
  }
  return issues;
}

/**
 * Validate a job's identity, endpoints, and self-consistency.
 *
 * A job needs a non-empty id and name, two valid endpoints, and distinct source
 * and target endpoints — syncing an endpoint to itself is a blocking error.
 */
export function validateSyncJob(job: SyncJob): SyncIssue[] {
  const issues: SyncIssue[] = [];
  if (!isNonEmptyString(job.id)) {
    issues.push(syncError("missing_job_id", "Sync job is missing an id", "job.id"));
  }
  if (!isNonEmptyString(job.name)) {
    issues.push(syncError("missing_job_name", "Sync job is missing a name", "job.name"));
  }
  issues.push(...validateSyncEndpoint(job.source, "source"));
  issues.push(...validateSyncEndpoint(job.target, "target"));
  if (job.source && job.target && job.source.id === job.target.id) {
    issues.push(
      syncError(
        "identical_endpoints",
        "Sync source and target must be different endpoints",
        "target.id",
      ),
    );
  }
  return issues;
}
