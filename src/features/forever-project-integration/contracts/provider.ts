/**
 * Forever Project Integration — the integration provider contract.
 *
 * A {@link ProjectIntegrationProvider} is the reusable seam between a concrete
 * integration and the registry: it exposes a {@link ProjectIntegrationDefinition}
 * that fully describes what the integration is, what stages and steps it is
 * composed of, and what foundations it references. RC4.0 defines the contract
 * only; later releases implement it for the concrete project, developer, and
 * portfolio integrations.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * execution. Running a stage, driving a pipeline, moving a record, and any IO
 * live entirely outside this contract, so a provider is trivially unit-testable
 * and never touches the network — mirroring the Forever Import (RC3.1) adapter,
 * the Forever Sync (RC3.2) connector, the Forever Source Registry (RC3.3)
 * provider, the Forever Connectors (RC3.4) provider, and the Forever Pipeline
 * (RC3.5) provider contracts.
 */

import type { SyncSystem } from "@/features/forever-sync";
import type { SourceId } from "@/features/forever-source-registry";
import type { ConnectorId } from "@/features/forever-connectors";
import type { PipelineId } from "@/features/forever-pipeline";

import type { ProjectIntegrationDefinition } from "../definition";
import {
  projectIntegrationConnectorIds,
  projectIntegrationPipelineIds,
  projectIntegrationSourceIds,
  projectIntegrationStageCount,
  projectIntegrationStepCount,
  projectIntegrationSystems,
} from "../helpers";
import type { ProjectIntegrationEntityKind } from "../types";

/** The contract every integration provider satisfies. */
export interface ProjectIntegrationProvider {
  /** The declarative description of the integration this provider represents. */
  readonly definition: ProjectIntegrationDefinition;
}

/**
 * Identity helper that pins an object to the {@link ProjectIntegrationProvider}
 * contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineProjectIntegrationProvider<P extends ProjectIntegrationProvider>(
  provider: P,
): P {
  return provider;
}

/** Whether a provider's integration declares that it handles the given entity kind. */
export function projectIntegrationHandles(
  provider: ProjectIntegrationProvider,
  kind: ProjectIntegrationEntityKind,
): boolean {
  return provider.definition.entities.includes(kind);
}

/** The number of stages in a provider's integration. */
export function projectIntegrationProviderStageCount(
  provider: ProjectIntegrationProvider,
): number {
  return projectIntegrationStageCount(provider.definition);
}

/** The number of steps in a provider's integration. */
export function projectIntegrationProviderStepCount(
  provider: ProjectIntegrationProvider,
): number {
  return projectIntegrationStepCount(provider.definition);
}

/** Whether a provider's integration references the given RC3.3 source. */
export function projectIntegrationUsesSource(
  provider: ProjectIntegrationProvider,
  sourceId: SourceId,
): boolean {
  return projectIntegrationSourceIds(provider.definition).includes(sourceId);
}

/** Whether a provider's integration references the given RC3.4 connector. */
export function projectIntegrationUsesConnector(
  provider: ProjectIntegrationProvider,
  connectorId: ConnectorId,
): boolean {
  return projectIntegrationConnectorIds(provider.definition).includes(connectorId);
}

/** Whether a provider's integration references the given RC3.5 pipeline. */
export function projectIntegrationUsesPipeline(
  provider: ProjectIntegrationProvider,
  pipelineId: PipelineId,
): boolean {
  return projectIntegrationPipelineIds(provider.definition).includes(pipelineId);
}

/** Whether a provider's integration reconciles with the given RC3.2 system. */
export function projectIntegrationUsesSystem(
  provider: ProjectIntegrationProvider,
  system: SyncSystem,
): boolean {
  return projectIntegrationSystems(provider.definition).includes(system);
}
