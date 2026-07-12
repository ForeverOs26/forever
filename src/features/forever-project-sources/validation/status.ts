/**
 * Forever Project Sources — status validation.
 *
 * Guards that a {@link ProjectSourceStatus} is a known vocabulary value. All
 * checks return issues; none throw.
 */

import type { ProjectSourceStatus } from "../status";
import { isKnownProjectSourceStatus } from "../status";
import { projectSourceError } from "../types";
import type { ProjectSourceIssue } from "../types";

/** Validate that a status is a known {@link ProjectSourceStatus}. */
export function validateProjectSourceStatus(
  status: ProjectSourceStatus,
  path = "status",
): ProjectSourceIssue[] {
  return isKnownProjectSourceStatus(status)
    ? []
    : [
        projectSourceError(
          "unknown_source_status",
          `Source has an unknown status "${String(status)}"`,
          path,
        ),
      ];
}
