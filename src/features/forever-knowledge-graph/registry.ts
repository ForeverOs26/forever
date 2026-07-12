/**
 * Forever Knowledge Graph — the in-memory graph registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link KnowledgeGraph} under its graph id and resolve it later. Keying by
 * graph id is what enforces the module's naming contract at the seam: a
 * graph id is derived from the project (and the caller-stated batch), so
 * registering two graphs under one id clashes at wiring time instead of
 * silently shadowing — a caller distinguishing runs states a batch. This is
 * the open/closed seam of RC4.8 — a new description plugs in without any
 * existing code changing — and it mirrors the Forever Import (RC3.1), Sync
 * (RC3.2), Source Registry (RC3.3), Connectors (RC3.4), Pipeline (RC3.5),
 * Project Integration (RC4.0), Project Template (RC4.2), Project Factory
 * (RC4.3), Project Sources (RC4.4), Extraction Pipeline (RC4.5), Canonical
 * Project Database (RC4.6), and Cross-Source Validation (RC4.7) registries
 * so all the foundations behave identically.
 *
 * It is *not* a runtime store: it self-populates nothing, reads no clock or
 * disk, persists nothing, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors. It is deliberately not
 * a source, extraction, record, or report registry either — catalogued
 * documents stay in the RC4.4 registry, pipelines in the RC4.5 one, canonical
 * records in the RC4.6 one, and examinations in the RC4.7 one; this one holds
 * only the described graphs that connect them.
 */

import type { KnowledgeGraph } from "./graph";
import { knowledgeGraphRequiresReview } from "./graph";
import type { KnowledgeNodeKind } from "./node";

/** In-memory registry of described graphs keyed by their graph id. */
export class KnowledgeGraphRegistry {
  private readonly graphs = new Map<string, KnowledgeGraph>();

  /**
   * Register a graph under its id. Re-registering the same id throws so a
   * second graph for one project-and-batch is caught at wiring time rather
   * than silently shadowing — distinguishable runs state a batch.
   */
  register(graph: KnowledgeGraph): this {
    if (this.graphs.has(graph.id)) {
      throw new Error(`A knowledge graph is already registered for ${graph.id}`);
    }
    this.graphs.set(graph.id, graph);
    return this;
  }

  /** Resolve the graph for a graph id, or `undefined`. */
  resolve(graphId: string): KnowledgeGraph | undefined {
    return this.graphs.get(graphId);
  }

  /** Whether a graph is registered for a graph id. */
  has(graphId: string): boolean {
    return this.graphs.has(graphId);
  }

  /** Every registered graph, in insertion order. */
  list(): KnowledgeGraph[] {
    return [...this.graphs.values()];
  }

  /** Every registered graph representing one project, in insertion order. */
  listByProject(projectId: string): KnowledgeGraph[] {
    return this.list().filter((graph) => graph.projectId === projectId);
  }

  /** Every registered graph containing a node of one kind, in insertion order. */
  listByNodeKind(kind: KnowledgeNodeKind): KnowledgeGraph[] {
    return this.list().filter((graph) => graph.nodes.some((node) => node.kind === kind));
  }

  /** Every registered graph with unresolved disagreements, in insertion order. */
  listRequiringReview(): KnowledgeGraph[] {
    return this.list().filter((graph) => knowledgeGraphRequiresReview(graph));
  }
}
