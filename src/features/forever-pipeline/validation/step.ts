/**
 * Forever Pipeline — step validation.
 *
 * Structural guards over a single {@link PipelineStep}: id and name must be
 * present, `kind` must be a known {@link PipelineStepKind}, `direction` (when
 * present) must be a known Forever Sync (RC3.2) direction, and `dependsOn` must
 * not name the step itself or repeat an id. Cross-step concerns — that a
 * dependency resolves to a sibling and that the graph is acyclic — belong to the
 * stage validator, which can see every sibling. All checks return issues; none
 * throw.
 *
 * RC3.2 exposes {@link SyncDirection} as a type only (no runtime constant list),
 * so the guard list here is pinned to that type with `satisfies` — every entry
 * must be a valid RC3.2 direction, keeping the runtime guard coupled to the
 * shared vocabulary rather than inventing a parallel one.
 */

import type { SyncDirection } from "@/features/forever-sync";

import { isNonEmptyString } from "../helpers";
import { pipelineError } from "../result";
import { isKnownPipelineStepKind, type PipelineStep } from "../step";
import type { PipelineIssue } from "../types";

/** The RC3.2 directions, mirrored for runtime guarding and pinned to the type. */
const KNOWN_DIRECTIONS = [
  "pull",
  "push",
  "bidirectional",
] as const satisfies readonly SyncDirection[];

function isKnownDirection(value: unknown): boolean {
  return typeof value === "string" && (KNOWN_DIRECTIONS as readonly string[]).includes(value);
}

/** Validate one step's own fields, with paths rooted at the enclosing stage. */
export function validatePipelineStep(
  step: PipelineStep,
  stageIndex: number,
  stepIndex: number,
): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const base = `stages.${stageIndex}.steps.${stepIndex}`;

  if (!isNonEmptyString(step.id)) {
    issues.push(pipelineError("missing_step_id", "Pipeline step is missing an id", `${base}.id`));
  }
  if (!isNonEmptyString(step.name)) {
    issues.push(
      pipelineError("missing_step_name", "Pipeline step is missing a name", `${base}.name`),
    );
  }
  if (!isKnownPipelineStepKind(step.kind)) {
    issues.push(
      pipelineError(
        "unknown_step_kind",
        `Pipeline step has an unknown kind "${String(step.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (step.direction !== undefined && !isKnownDirection(step.direction)) {
    issues.push(
      pipelineError(
        "unknown_step_direction",
        `Pipeline step has an unknown direction "${String(step.direction)}"`,
        `${base}.direction`,
      ),
    );
  }

  if (step.dependsOn !== undefined) {
    const seen = new Set<string>();
    step.dependsOn.forEach((depId, depIndex) => {
      if (depId === step.id) {
        issues.push(
          pipelineError(
            "self_dependency",
            `Pipeline step "${step.id}" depends on itself`,
            `${base}.dependsOn.${depIndex}`,
          ),
        );
      }
      if (seen.has(depId)) {
        issues.push(
          pipelineError(
            "duplicate_dependency",
            `Pipeline step "${step.id}" declares dependency "${depId}" more than once`,
            `${base}.dependsOn.${depIndex}`,
          ),
        );
      }
      seen.add(depId);
    });
  }

  return issues;
}
