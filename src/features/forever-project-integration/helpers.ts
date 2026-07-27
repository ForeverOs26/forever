/**
 * Forever Project Integration — deterministic helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: a strict string
 * guard used by validation, stable key builders for identities and definitions,
 * structural counters, reference collectors over the reused foundations (source,
 * connector, pipeline, system, and entity references), a stats combiner, and a
 * deterministic dependency ordering for a stage's steps. Given the same input
 * they always return the same output — no randomness, no clocks, no locale — so
 * the whole module stays deterministic and these helpers never need
 * re-implementing per call site.
 *
 * The ordering here is *architecture*, not execution: `orderIntegrationStageSteps`
 * computes the order a future runtime *would* follow from the declared
 * `dependsOn` graph, and `integrationStageStepCycle` reports a dependency cycle.
 * Neither runs a step.
 */

import type { SyncSystem } from "@/features/forever-sync";
import type { SourceId } from "@/features/forever-source-registry";
import type { ConnectorId } from "@/features/forever-connectors";
import type { PipelineId } from "@/features/forever-pipeline";

import type { ProjectIntegrationDefinition } from "./definition";
import type { ProjectIntegrationIdentity } from "./identity";
import { emptyProjectIntegrationStats } from "./result";
import type { ProjectIntegrationStage } from "./stage";
import type { ProjectIntegrationStep } from "./step";
import type { ProjectIntegrationEntityKind, ProjectIntegrationStats } from "./types";

/** True only for a non-empty, non-whitespace string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Stable key for an identity, independent of its surrogate id: `scope:slug`. Two
 * identities of the same scope under the same slug share a key.
 */
export function projectIntegrationIdentityKey(identity: ProjectIntegrationIdentity): string {
  return `${identity.scope}:${identity.slug}`;
}

/** Stable natural key for a definition, derived from its identity. */
export function projectIntegrationDefinitionKey(
  definition: ProjectIntegrationDefinition,
): string {
  return projectIntegrationIdentityKey(definition.identity);
}

/** The number of stages in a definition. */
export function projectIntegrationStageCount(definition: ProjectIntegrationDefinition): number {
  return definition.stages.length;
}

/** The total number of steps across every stage of a definition. */
export function projectIntegrationStepCount(definition: ProjectIntegrationDefinition): number {
  return definition.stages.reduce((total, stage) => total + stage.steps.length, 0);
}

/** Every step of a definition, flattened in stage-then-step declared order. */
export function listProjectIntegrationSteps(
  definition: ProjectIntegrationDefinition,
): ProjectIntegrationStep[] {
  return definition.stages.flatMap((stage) => stage.steps);
}

function distinctBy<V>(
  definition: ProjectIntegrationDefinition,
  pick: (step: ProjectIntegrationStep) => V | undefined,
): V[] {
  const seen = new Set<V>();
  const values: V[] = [];
  for (const step of listProjectIntegrationSteps(definition)) {
    const value = pick(step);
    if (value !== undefined && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

/** The distinct source ids referenced by a definition's steps, in first-seen order. */
export function projectIntegrationSourceIds(
  definition: ProjectIntegrationDefinition,
): SourceId[] {
  return distinctBy(definition, (step) => step.sourceId);
}

/** The distinct connector ids referenced by a definition's steps, in first-seen order. */
export function projectIntegrationConnectorIds(
  definition: ProjectIntegrationDefinition,
): ConnectorId[] {
  return distinctBy(definition, (step) => step.connectorId);
}

/** The distinct pipeline ids referenced by a definition's steps, in first-seen order. */
export function projectIntegrationPipelineIds(
  definition: ProjectIntegrationDefinition,
): PipelineId[] {
  return distinctBy(definition, (step) => step.pipelineId);
}

/** The distinct sync systems referenced by a definition's steps, in first-seen order. */
export function projectIntegrationSystems(
  definition: ProjectIntegrationDefinition,
): SyncSystem[] {
  return distinctBy(definition, (step) => step.system);
}

/** The distinct entity kinds referenced by a definition's steps, in first-seen order. */
export function projectIntegrationStepEntityKinds(
  definition: ProjectIntegrationDefinition,
): ProjectIntegrationEntityKind[] {
  return distinctBy(definition, (step) => step.entityKind);
}

/**
 * Detect a dependency cycle among a stage's steps.
 *
 * Returns the ids on the first cycle found (iterating steps and their
 * `dependsOn` in declared order, so the result is deterministic), or `undefined`
 * when the `dependsOn` graph is acyclic. Dependencies that point outside the
 * stage are ignored here — reference existence is a validation concern.
 */
export function integrationStageStepCycle(
  stage: ProjectIntegrationStage,
): string[] | undefined {
  const ids = new Set(stage.steps.map((step) => step.id));
  const deps = new Map<string, string[]>();
  for (const step of stage.steps) {
    deps.set(step.id, (step.dependsOn ?? []).filter((id) => ids.has(id)));
  }

  const VISITING = 1;
  const DONE = 2;
  const marks = new Map<string, number>();
  const stack: string[] = [];

  function visit(id: string): string[] | undefined {
    const mark = marks.get(id);
    if (mark === DONE) return undefined;
    if (mark === VISITING) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    marks.set(id, VISITING);
    stack.push(id);
    for (const next of deps.get(id) ?? []) {
      const found = visit(next);
      if (found !== undefined) return found;
    }
    stack.pop();
    marks.set(id, DONE);
    return undefined;
  }

  for (const step of stage.steps) {
    const found = visit(step.id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The order a future runtime would follow through a stage's steps, honouring the
 * declared `dependsOn` graph (a stable topological sort — Kahn's algorithm over
 * the steps in declared order). Dependencies pointing outside the stage are
 * ignored. If the graph contains a cycle, the steps still blocked are appended in
 * declared order so the function is total and never loops. This describes an
 * order; it runs nothing.
 */
export function orderIntegrationStageSteps(
  stage: ProjectIntegrationStage,
): ProjectIntegrationStep[] {
  const ids = new Set(stage.steps.map((step) => step.id));
  const remaining = new Map<string, number>();
  for (const step of stage.steps) {
    const deps = (step.dependsOn ?? []).filter((id) => ids.has(id) && id !== step.id);
    remaining.set(step.id, new Set(deps).size);
  }

  const ordered: ProjectIntegrationStep[] = [];
  const placed = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const step of stage.steps) {
      if (placed.has(step.id)) continue;
      if ((remaining.get(step.id) ?? 0) > 0) continue;
      ordered.push(step);
      placed.add(step.id);
      progressed = true;
      for (const other of stage.steps) {
        if (placed.has(other.id)) continue;
        const deps = new Set(
          (other.dependsOn ?? []).filter((id) => ids.has(id) && id !== other.id),
        );
        if (deps.has(step.id)) remaining.set(other.id, (remaining.get(other.id) ?? 1) - 1);
      }
    }
  }

  // Any steps left are part of a cycle; append them in declared order.
  for (const step of stage.steps) {
    if (!placed.has(step.id)) ordered.push(step);
  }
  return ordered;
}

/** Add two stat counters field-by-field into a fresh {@link ProjectIntegrationStats}. */
export function mergeProjectIntegrationStats(
  a: ProjectIntegrationStats,
  b: ProjectIntegrationStats,
): ProjectIntegrationStats {
  return {
    stages: a.stages + b.stages,
    steps: a.steps + b.steps,
    completed: a.completed + b.completed,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
    warnings: a.warnings + b.warnings,
    errors: a.errors + b.errors,
  };
}

/** Sum a list of stats into one, starting from an empty {@link ProjectIntegrationStats}. */
export function sumProjectIntegrationStats(
  stats: readonly ProjectIntegrationStats[],
): ProjectIntegrationStats {
  return stats.reduce<ProjectIntegrationStats>(
    (acc, next) => mergeProjectIntegrationStats(acc, next),
    emptyProjectIntegrationStats(),
  );
}
