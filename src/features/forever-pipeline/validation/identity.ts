/**
 * Forever Pipeline — identity validation.
 *
 * Structural guards over a {@link PipelineIdentity}: id, slug, and name must be
 * present, and the `mode` must be a known {@link PipelineMode}. All checks return
 * issues; none throw.
 */

import { isNonEmptyString } from "../helpers";
import { isKnownPipelineMode, type PipelineIdentity } from "../identity";
import { pipelineError } from "../result";
import type { PipelineIssue } from "../types";

/** Validate a pipeline identity's required fields and mode. */
export function validatePipelineIdentity(identity: PipelineIdentity): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  if (!isNonEmptyString(identity.id)) {
    issues.push(
      pipelineError("missing_pipeline_id", "Pipeline identity is missing an id", "identity.id"),
    );
  }
  if (!isNonEmptyString(identity.slug)) {
    issues.push(
      pipelineError(
        "missing_pipeline_slug",
        "Pipeline identity is missing a slug",
        "identity.slug",
      ),
    );
  }
  if (!isNonEmptyString(identity.name)) {
    issues.push(
      pipelineError(
        "missing_pipeline_name",
        "Pipeline identity is missing a name",
        "identity.name",
      ),
    );
  }
  if (!isKnownPipelineMode(identity.mode)) {
    issues.push(
      pipelineError(
        "unknown_pipeline_mode",
        `Pipeline identity has an unknown mode "${String(identity.mode)}"`,
        "identity.mode",
      ),
    );
  }
  return issues;
}
