/**
 * Forever Knowledge Graph — the graph provider contract.
 *
 * A {@link KnowledgeGraphProvider} is the reusable seam between one described
 * graph and the registry: it exposes a {@link KnowledgeGraph} that fully
 * describes what the description represented. RC4.8 defines the contract
 * only; a future release implements it to plug a concrete description into
 * the registry without any existing code changing.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * execution. Building a graph, resolving a dispute, approving a statement,
 * and any IO live entirely outside this contract — mirroring the Import
 * (RC3.1), Sync (RC3.2), Source Registry (RC3.3), Connectors (RC3.4),
 * Pipeline (RC3.5), Project Integration (RC4.0), Project Template (RC4.2),
 * Project Factory (RC4.3), Project Sources (RC4.4), Extraction Pipeline
 * (RC4.5), Canonical Project Database (RC4.6), and Cross-Source Validation
 * (RC4.7) provider contracts.
 */

import type { KnowledgeGraph } from "../graph";
import { knowledgeGraphRequiresReview } from "../graph";

/** The contract every knowledge-graph provider satisfies. */
export interface KnowledgeGraphProvider {
  /** The described graph this provider represents. */
  readonly graph: KnowledgeGraph;
}

/**
 * Identity helper that pins an object to the {@link KnowledgeGraphProvider}
 * contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineKnowledgeGraphProvider<P extends KnowledgeGraphProvider>(provider: P): P {
  return provider;
}

/** The canonical `proj_` id of the project a provider's graph represents. */
export function knowledgeGraphProviderProjectId(provider: KnowledgeGraphProvider): string {
  return provider.graph.projectId;
}

/** The number of nodes a provider's graph represents. */
export function knowledgeGraphProviderNodeCount(provider: KnowledgeGraphProvider): number {
  return provider.graph.nodes.length;
}

/** The number of edges a provider's graph represents. */
export function knowledgeGraphProviderEdgeCount(provider: KnowledgeGraphProvider): number {
  return provider.graph.edges.length;
}

/** Whether a provider's graph carries unresolved disagreements for review. */
export function knowledgeGraphProviderRequiresReview(provider: KnowledgeGraphProvider): boolean {
  return knowledgeGraphRequiresReview(provider.graph);
}
