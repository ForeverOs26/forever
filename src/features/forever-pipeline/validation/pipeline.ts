/**
 * Forever Pipeline — the validation pipeline.
 *
 * Composes the individual guards (identity, version, policy, stage, step,
 * definition, and entry) into one deterministic pass over a
 * {@link PipelineRegistry}. This is the single entry point a caller uses before
 * treating a catalogue as coherent. It never throws — it returns a structured
 * verdict.
 *
 * Cross-entry integrity is resolved here: a registry must have an id, and no two
 * entries may share a pipeline id or a natural `mode:slug` key, so a pipeline can
 * never be registered twice under a different surrogate id.
 *
 * "Pipeline validation" names two distinct things that must not be conflated:
 * the data pipelines this foundation *describes* (stages and steps), and this
 * *validation* pass — a deterministic sequence of guards, never an executing
 * runtime.
 */

import type { PipelineRegistry } from "../entry";
import { pipelineDefinitionKey, isNonEmptyString } from "../helpers";
import { partitionPipelineIssues, pipelineError } from "../result";
import type { PipelineError, PipelineIssue, PipelineWarning } from "../types";
import { validatePipelineRegistryEntry } from "./entry";

/** The structured verdict of {@link validatePipelineRegistry}. */
export interface PipelineValidation {
  valid: boolean;
  issues: PipelineIssue[];
  errors: PipelineError[];
  warnings: PipelineWarning[];
}

/**
 * Run the full validation suite over a registry.
 *
 * Validates the registry id, every entry, and the uniqueness of both surrogate
 * ids and natural `mode:slug` keys across entries. Issues from every check are
 * merged in a stable order.
 */
export function validatePipelineRegistry(registry: PipelineRegistry): PipelineValidation {
  const issues: PipelineIssue[] = [];

  if (!isNonEmptyString(registry.id)) {
    issues.push(
      pipelineError("missing_registry_id", "Pipeline registry is missing an id", "id"),
    );
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  registry.entries.forEach((entry, index) => {
    issues.push(...validatePipelineRegistryEntry(entry));

    const id = entry.definition.identity.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          pipelineError(
            "duplicate_pipeline_id",
            `Pipeline id "${id}" is registered more than once`,
            `entries.${index}.definition.identity.id`,
          ),
        );
      }
      seenIds.add(id);
    }

    const key = pipelineDefinitionKey(entry.definition);
    if (seenKeys.has(key)) {
      issues.push(
        pipelineError(
          "duplicate_pipeline_key",
          `Pipeline "${key}" is registered more than once`,
          `entries.${index}.definition.identity.slug`,
        ),
      );
    }
    seenKeys.add(key);
  });

  const { errors, warnings } = partitionPipelineIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
