/**
 * Forever Pipeline — the pipeline provider contract.
 *
 * A {@link PipelineProvider} is the reusable seam between a concrete pipeline and
 * the registry: it exposes a {@link PipelineDefinition} that fully describes what
 * the pipeline is, what stages and steps it is composed of, and what foundations
 * it references. RC3.5 defines the contract only; later releases implement it for
 * the concrete import, sync, and export pipelines.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * execution. Running a stage, moving a record, and any IO live entirely outside
 * this contract, so a provider is trivially unit-testable and never touches the
 * network — mirroring the Forever Import (RC3.1) adapter, the Forever Sync
 * (RC3.2) connector, the Forever Source Registry (RC3.3) provider, and the
 * Forever Connectors (RC3.4) provider contracts.
 */

import type { SourceId } from "@/features/forever-source-registry";
import type { ConnectorId } from "@/features/forever-connectors";

import type { PipelineDefinition } from "../definition";
import {
  pipelineConnectorIds,
  pipelineSourceIds,
  pipelineStageCount,
  pipelineStepCount,
} from "../helpers";
import type { PipelineEntityKind } from "../types";

/** The contract every pipeline provider satisfies. */
export interface PipelineProvider {
  /** The declarative description of the pipeline this provider represents. */
  readonly definition: PipelineDefinition;
}

/**
 * Identity helper that pins an object to the {@link PipelineProvider} contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function definePipelineProvider<P extends PipelineProvider>(provider: P): P {
  return provider;
}

/** Whether a provider's pipeline declares that it handles the given entity kind. */
export function pipelineHandles(
  provider: PipelineProvider,
  kind: PipelineEntityKind,
): boolean {
  return provider.definition.entities.includes(kind);
}

/** The number of stages in a provider's pipeline. */
export function pipelineProviderStageCount(provider: PipelineProvider): number {
  return pipelineStageCount(provider.definition);
}

/** The number of steps in a provider's pipeline. */
export function pipelineProviderStepCount(provider: PipelineProvider): number {
  return pipelineStepCount(provider.definition);
}

/** Whether a provider's pipeline references the given RC3.3 source. */
export function pipelineUsesSource(provider: PipelineProvider, sourceId: SourceId): boolean {
  return pipelineSourceIds(provider.definition).includes(sourceId);
}

/** Whether a provider's pipeline references the given RC3.4 connector. */
export function pipelineUsesConnector(
  provider: PipelineProvider,
  connectorId: ConnectorId,
): boolean {
  return pipelineConnectorIds(provider.definition).includes(connectorId);
}
