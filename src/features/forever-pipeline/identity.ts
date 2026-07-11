/**
 * Forever Pipeline — pipeline identity.
 *
 * A {@link PipelineIdentity} is the stable, human- and machine-addressable name
 * of a pipeline: its id, its URL-safe slug, a display name, and the
 * {@link PipelineMode} that classifies what the pipeline is for. It reuses the
 * RC3.0 `Slug` and id types so a pipeline is addressed the same way every other
 * canonical Forever entity is — never a parallel scheme.
 *
 * Identity carries no behaviour and no connection detail — the stages, steps,
 * and policy live on the {@link import("./definition").PipelineDefinition} and,
 * ultimately, outside RC3.5.
 */

import type { Slug } from "@/features/forever-database";

import type { PipelineId } from "./types";

/**
 * The overall intent of a pipeline.
 *
 * `import` acquires and lands external data, `sync` reconciles Forever with
 * another system, `export` publishes canonical data outward, and `composite`
 * spans more than one of those in a single orchestration.
 */
export type PipelineMode = "import" | "sync" | "export" | "composite";

/** Every {@link PipelineMode}, in a stable declared order. */
export const PIPELINE_MODES = [
  "import",
  "sync",
  "export",
  "composite",
] as const satisfies readonly PipelineMode[];

/** Runtime guard: whether a value is a known {@link PipelineMode}. */
export function isKnownPipelineMode(value: unknown): value is PipelineMode {
  return typeof value === "string" && (PIPELINE_MODES as readonly string[]).includes(value);
}

/** The stable identity of a pipeline. */
export interface PipelineIdentity {
  /** Stable surrogate id, e.g. `pipe_coralina_import`. */
  id: PipelineId;
  /** URL- and file-safe identifier, e.g. `coralina-import`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Coralina Import`. */
  name: string;
  /** What the pipeline is for. */
  mode: PipelineMode;
}
