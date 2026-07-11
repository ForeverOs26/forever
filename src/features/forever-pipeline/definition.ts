/**
 * Forever Pipeline — pipeline definition.
 *
 * A {@link PipelineDefinition} is the complete, declarative description of one
 * pipeline: its identity and version, the ordered stages (and their steps) it is
 * composed of, which canonical entities it handles, the optional behavioural
 * policy that governs it, and optional descriptive metadata. It is the unit the
 * registry stores and the validation pipeline judges.
 *
 * The definition reuses the neighbouring foundations rather than restating them:
 * `entities` are the Forever Import (RC3.1) entity kinds, its steps reference
 * Forever Source Registry (RC3.3) sources and Forever Connectors (RC3.4)
 * connectors by id, and its policy reuses the Forever Sync (RC3.2) retry shape.
 * It carries no live handle, connection, credential, or data — it describes what
 * a run *would* do, never a run itself.
 */

import type { PipelineIdentity } from "./identity";
import type { PipelineMetadata } from "./metadata";
import type { PipelinePolicy } from "./policy";
import type { PipelineStage } from "./stage";
import type { PipelineEntityKind } from "./types";
import type { PipelineVersion } from "./version";

/** The full declarative description of one pipeline. */
export interface PipelineDefinition {
  identity: PipelineIdentity;
  version: PipelineVersion;
  /** The ordered stages this pipeline is composed of. */
  stages: PipelineStage[];
  /** Canonical entity kinds this pipeline handles. Reuses the RC3.1 kinds. */
  entities: PipelineEntityKind[];
  /** Optional behavioural contract governing the pipeline. */
  policy?: PipelinePolicy;
  metadata?: PipelineMetadata;
}

/**
 * Identity helper that pins an object to the {@link PipelineDefinition} shape.
 *
 * Gives call sites full type-checking and inference without forcing a factory;
 * the returned value is the definition unchanged.
 */
export function definePipeline(definition: PipelineDefinition): PipelineDefinition {
  return definition;
}
