/**
 * Forever Project Integration — step validation.
 *
 * Structural guards over a single {@link ProjectIntegrationStep}: id and name
 * must be present, `kind` must be a known {@link ProjectIntegrationStepKind},
 * `system` (when present) must be a known Forever Sync (RC3.2) system,
 * `direction` (when present) must be a known RC3.2 direction, and `dependsOn`
 * must not name the step itself or repeat an id. Cross-step concerns — that a
 * dependency resolves to a sibling and that the graph is acyclic — belong to the
 * stage validator, which can see every sibling. All checks return issues; none
 * throw.
 *
 * RC3.2 exposes {@link SyncSystem} and {@link SyncDirection} as types only (no
 * runtime constant lists), so the guard lists here are pinned to those types with
 * `satisfies` — every entry must be a valid RC3.2 value, keeping the runtime
 * guards coupled to the shared vocabulary rather than inventing a parallel one.
 */

import type { SyncDirection, SyncSystem } from "@/features/forever-sync";

import { isNonEmptyString } from "../helpers";
import { projectIntegrationError } from "../result";
import {
  isKnownProjectIntegrationStepKind,
  type ProjectIntegrationStep,
} from "../step";
import type { ProjectIntegrationIssue } from "../types";

/** The RC3.2 systems, mirrored for runtime guarding and pinned to the type. */
const KNOWN_SYSTEMS = [
  "website",
  "crm",
  "forever_database",
  "marketplace",
  "ai_agents",
  "manual",
  "api",
] as const satisfies readonly SyncSystem[];

/** The RC3.2 directions, mirrored for runtime guarding and pinned to the type. */
const KNOWN_DIRECTIONS = [
  "pull",
  "push",
  "bidirectional",
] as const satisfies readonly SyncDirection[];

function isKnownSystem(value: unknown): boolean {
  return typeof value === "string" && (KNOWN_SYSTEMS as readonly string[]).includes(value);
}

function isKnownDirection(value: unknown): boolean {
  return typeof value === "string" && (KNOWN_DIRECTIONS as readonly string[]).includes(value);
}

/** Validate one step's own fields, with paths rooted at the enclosing stage. */
export function validateProjectIntegrationStep(
  step: ProjectIntegrationStep,
  stageIndex: number,
  stepIndex: number,
): ProjectIntegrationIssue[] {
  const issues: ProjectIntegrationIssue[] = [];
  const base = `stages.${stageIndex}.steps.${stepIndex}`;

  if (!isNonEmptyString(step.id)) {
    issues.push(
      projectIntegrationError("missing_step_id", "Integration step is missing an id", `${base}.id`),
    );
  }
  if (!isNonEmptyString(step.name)) {
    issues.push(
      projectIntegrationError(
        "missing_step_name",
        "Integration step is missing a name",
        `${base}.name`,
      ),
    );
  }
  if (!isKnownProjectIntegrationStepKind(step.kind)) {
    issues.push(
      projectIntegrationError(
        "unknown_step_kind",
        `Integration step has an unknown kind "${String(step.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (step.system !== undefined && !isKnownSystem(step.system)) {
    issues.push(
      projectIntegrationError(
        "unknown_step_system",
        `Integration step has an unknown system "${String(step.system)}"`,
        `${base}.system`,
      ),
    );
  }
  if (step.direction !== undefined && !isKnownDirection(step.direction)) {
    issues.push(
      projectIntegrationError(
        "unknown_step_direction",
        `Integration step has an unknown direction "${String(step.direction)}"`,
        `${base}.direction`,
      ),
    );
  }

  if (step.dependsOn !== undefined) {
    const seen = new Set<string>();
    step.dependsOn.forEach((depId, depIndex) => {
      if (depId === step.id) {
        issues.push(
          projectIntegrationError(
            "self_dependency",
            `Integration step "${step.id}" depends on itself`,
            `${base}.dependsOn.${depIndex}`,
          ),
        );
      }
      if (seen.has(depId)) {
        issues.push(
          projectIntegrationError(
            "duplicate_dependency",
            `Integration step "${step.id}" declares dependency "${depId}" more than once`,
            `${base}.dependsOn.${depIndex}`,
          ),
        );
      }
      seen.add(depId);
    });
  }

  return issues;
}
