/**
 * Forever Pipeline — deterministic helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: a strict string
 * guard used by validation, stable key builders for identities and definitions,
 * structural counters, reference collectors over the reused foundations, a stats
 * combiner, and a deterministic dependency ordering for a stage's steps. Given
 * the same input they always return the same output — no randomness, no clocks,
 * no locale — so the whole module stays deterministic and these helpers never
 * need re-implementing per call site.
 *
 * The ordering here is *architecture*, not execution: `orderStageSteps` computes
 * the order a future runtime *would* follow from the declared `dependsOn` graph,
 * and `stageStepCycle` reports a dependency cycle. Neither runs a step.
 */

import type { SourceId } from "@/features/forever-source-registry";
import type { ConnectorId } from "@/features/forever-connectors";

import type { PipelineDefinition } from "./definition";
import type { PipelineIdentity } from "./identity";
import { emptyPipelineStats } from "./result";
import type { PipelineStage } from "./stage";
import type { PipelineStep } from "./step";
import type { PipelineEntityKind, PipelineStats } from "./types";

/** True only for a non-empty, non-whitespace string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Stable key for an identity, independent of its surrogate id: `mode:slug`. Two
 * identities of the same mode under the same slug share a key.
 */
export function pipelineIdentityKey(identity: PipelineIdentity): string {
  return `${identity.mode}:${identity.slug}`;
}

/** Stable natural key for a definition, derived from its identity. */
export function pipelineDefinitionKey(definition: PipelineDefinition): string {
  return pipelineIdentityKey(definition.identity);
}

/** The number of stages in a definition. */
export function pipelineStageCount(definition: PipelineDefinition): number {
  return definition.stages.length;
}

/** The total number of steps across every stage of a definition. */
export function pipelineStepCount(definition: PipelineDefinition): number {
  return definition.stages.reduce((total, stage) => total + stage.steps.length, 0);
}

/** Every step of a definition, flattened in stage-then-step declared order. */
export function listPipelineSteps(definition: PipelineDefinition): PipelineStep[] {
  return definition.stages.flatMap((stage) => stage.steps);
}

/** The distinct source ids referenced by a definition's steps, in first-seen order. */
export function pipelineSourceIds(definition: PipelineDefinition): SourceId[] {
  const seen = new Set<SourceId>();
  const ids: SourceId[] = [];
  for (const step of listPipelineSteps(definition)) {
    if (step.sourceId !== undefined && !seen.has(step.sourceId)) {
      seen.add(step.sourceId);
      ids.push(step.sourceId);
    }
  }
  return ids;
}

/** The distinct connector ids referenced by a definition's steps, in first-seen order. */
export function pipelineConnectorIds(definition: PipelineDefinition): ConnectorId[] {
  const seen = new Set<ConnectorId>();
  const ids: ConnectorId[] = [];
  for (const step of listPipelineSteps(definition)) {
    if (step.connectorId !== undefined && !seen.has(step.connectorId)) {
      seen.add(step.connectorId);
      ids.push(step.connectorId);
    }
  }
  return ids;
}

/** The distinct entity kinds referenced by a definition's steps, in first-seen order. */
export function pipelineStepEntityKinds(definition: PipelineDefinition): PipelineEntityKind[] {
  const seen = new Set<PipelineEntityKind>();
  const kinds: PipelineEntityKind[] = [];
  for (const step of listPipelineSteps(definition)) {
    if (step.entityKind !== undefined && !seen.has(step.entityKind)) {
      seen.add(step.entityKind);
      kinds.push(step.entityKind);
    }
  }
  return kinds;
}

/**
 * Detect a dependency cycle among a stage's steps.
 *
 * Returns the ids on the first cycle found (iterating steps and their
 * `dependsOn` in declared order, so the result is deterministic), or `undefined`
 * when the `dependsOn` graph is acyclic. Dependencies that point outside the
 * stage are ignored here — reference existence is a validation concern.
 */
export function stageStepCycle(stage: PipelineStage): string[] | undefined {
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
 * ignored. If the graph contains a cycle, the steps still blocked are appended
 * in declared order so the function is total and never loops. This describes an
 * order; it runs nothing.
 */
export function orderStageSteps(stage: PipelineStage): PipelineStep[] {
  const ids = new Set(stage.steps.map((step) => step.id));
  const remaining = new Map<string, number>();
  for (const step of stage.steps) {
    const deps = (step.dependsOn ?? []).filter((id) => ids.has(id) && id !== step.id);
    remaining.set(step.id, new Set(deps).size);
  }

  const ordered: PipelineStep[] = [];
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
        const deps = new Set((other.dependsOn ?? []).filter((id) => ids.has(id) && id !== other.id));
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

/** Add two stat counters field-by-field into a fresh {@link PipelineStats}. */
export function mergePipelineStats(a: PipelineStats, b: PipelineStats): PipelineStats {
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

/** Sum a list of stats into one, starting from an empty {@link PipelineStats}. */
export function sumPipelineStats(stats: readonly PipelineStats[]): PipelineStats {
  return stats.reduce<PipelineStats>((acc, next) => mergePipelineStats(acc, next), emptyPipelineStats());
}
