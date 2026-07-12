/**
 * Forever Knowledge Graph — graph validation.
 *
 * Structural guards over one {@link KnowledgeGraph}: the identity references
 * must be present, every node and edge must be individually coherent, no
 * node id, node kind-and-key pair, or edge id may repeat, every node and
 * edge must belong to the graph's project, every edge must connect nodes the
 * graph actually contains, every edge's endpoints must satisfy the kind's
 * structural grammar (with succession and derivation additionally connecting
 * same-kind nodes, and contradiction connecting claims of one subject), and
 * the source roster must mirror the source nodes. A structurally absent part
 * is reported as missing, never dereferenced. All checks return issues; none
 * throw.
 */

import { KNOWLEDGE_EDGE_ENDPOINTS, isKnownKnowledgeEdgeKind } from "../edge";
import type { KnowledgeGraph } from "../graph";
import { isAbsent, isNonEmptyString } from "../helpers";
import type { KnowledgeNode } from "../node";
import { isKnownKnowledgeNodeKind } from "../node";
import { knowledgeError } from "../types";
import type { KnowledgeIssue } from "../types";
import { validateKnowledgeEdge } from "./edge";
import { validateKnowledgeNode } from "./node";

function at(base: string, path: string): string {
  return base === "" ? path : `${base}.${path}`;
}

/** The edge kinds whose two endpoints must be nodes of one kind. */
const SAME_KIND_EDGE_KINDS = ["supersedes", "derived_from"] as const;

/**
 * Validate a whole graph. `base` locates it; empty when standalone.
 *
 * Never throws: a graph so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateKnowledgeGraph(graph: KnowledgeGraph, base = ""): KnowledgeIssue[] {
  try {
    return validateKnowledgeGraphUnguarded(graph, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "Knowledge graph behaved in a way that could not be validated",
        base === "" ? "graph" : base,
      ),
    ];
  }
}

function validateKnowledgeGraphUnguarded(graph: KnowledgeGraph, base: string): KnowledgeIssue[] {
  if (isAbsent(graph)) {
    return [
      knowledgeError("missing_graph", "Knowledge graph is absent", base === "" ? "graph" : base),
    ];
  }
  const issues: KnowledgeIssue[] = [];

  if (!isNonEmptyString(graph.id)) {
    issues.push(knowledgeError("missing_graph_id", "Graph is missing an id", at(base, "id")));
  }
  if (!isNonEmptyString(graph.projectId)) {
    issues.push(
      knowledgeError(
        "missing_graph_project",
        "Graph names no canonical project",
        at(base, "projectId"),
      ),
    );
  }
  if (!isNonEmptyString(graph.projectSlug)) {
    issues.push(
      knowledgeError(
        "missing_graph_slug",
        "Graph carries no project slug",
        at(base, "projectSlug"),
      ),
    );
  }
  if (graph.batch !== undefined && !isNonEmptyString(graph.batch)) {
    issues.push(
      knowledgeError(
        "empty_graph_batch",
        "Graph declares an empty batch discriminator",
        at(base, "batch"),
      ),
    );
  }
  if (graph.describedAt !== undefined && !isNonEmptyString(graph.describedAt)) {
    issues.push(
      knowledgeError(
        "empty_graph_time",
        "Graph declares an empty description time",
        at(base, "describedAt"),
      ),
    );
  }

  const nodesById = new Map<string, KnowledgeNode>();
  const nodeKindKeys = new Set<string>();
  const sourceNodeKeys = new Set<string>();
  if (!Array.isArray(graph.nodes)) {
    issues.push(
      knowledgeError("invalid_graph_nodes", "Graph nodes must be a list", at(base, "nodes")),
    );
  } else {
    for (let index = 0; index < graph.nodes.length; index += 1) {
      const node = graph.nodes[index];
      issues.push(...validateKnowledgeNode(node, at(base, `nodes.${index}`)));
      if (isAbsent(node)) continue;
      if (isNonEmptyString(node.id)) {
        if (nodesById.has(node.id)) {
          issues.push(
            knowledgeError(
              "duplicate_node_id",
              `Graph carries the node id "${node.id}" more than once`,
              at(base, `nodes.${index}.id`),
            ),
          );
        }
        nodesById.set(node.id, node);
      }
      if (isKnownKnowledgeNodeKind(node.kind) && isNonEmptyString(node.key)) {
        const kindKey = `${node.kind}\u0000${node.key}`;
        if (nodeKindKeys.has(kindKey)) {
          issues.push(
            knowledgeError(
              "duplicate_node_key",
              `Graph represents the ${node.kind} "${node.key}" more than once`,
              at(base, `nodes.${index}.key`),
            ),
          );
        }
        nodeKindKeys.add(kindKey);
        if (node.kind === "source") sourceNodeKeys.add(node.key);
      }
      if (
        isNonEmptyString(node.projectId) &&
        isNonEmptyString(graph.projectId) &&
        node.projectId !== graph.projectId
      ) {
        issues.push(
          knowledgeError(
            "foreign_node",
            `Node belongs to "${node.projectId}", not "${graph.projectId}"`,
            at(base, `nodes.${index}.projectId`),
          ),
        );
      }
    }
  }

  const edgeIds = new Set<string>();
  if (!Array.isArray(graph.edges)) {
    issues.push(
      knowledgeError("invalid_graph_edges", "Graph edges must be a list", at(base, "edges")),
    );
  } else {
    for (let index = 0; index < graph.edges.length; index += 1) {
      const edge = graph.edges[index];
      issues.push(...validateKnowledgeEdge(edge, at(base, `edges.${index}`)));
      if (isAbsent(edge)) continue;
      if (isNonEmptyString(edge.id)) {
        if (edgeIds.has(edge.id)) {
          issues.push(
            knowledgeError(
              "duplicate_edge_id",
              `Graph carries the edge id "${edge.id}" more than once`,
              at(base, `edges.${index}.id`),
            ),
          );
        }
        edgeIds.add(edge.id);
      }
      if (
        isNonEmptyString(edge.projectId) &&
        isNonEmptyString(graph.projectId) &&
        edge.projectId !== graph.projectId
      ) {
        issues.push(
          knowledgeError(
            "foreign_edge",
            `Edge belongs to "${edge.projectId}", not "${graph.projectId}"`,
            at(base, `edges.${index}.projectId`),
          ),
        );
      }
      if (!Array.isArray(graph.nodes)) continue;
      const fromNode = isNonEmptyString(edge.fromId) ? nodesById.get(edge.fromId) : undefined;
      const toNode = isNonEmptyString(edge.toId) ? nodesById.get(edge.toId) : undefined;
      if (isNonEmptyString(edge.fromId) && fromNode === undefined) {
        issues.push(
          knowledgeError(
            "unknown_node_reference",
            `Edge points from "${edge.fromId}", which the graph does not contain`,
            at(base, `edges.${index}.fromId`),
          ),
        );
      }
      if (isNonEmptyString(edge.toId) && toNode === undefined) {
        issues.push(
          knowledgeError(
            "unknown_node_reference",
            `Edge points to "${edge.toId}", which the graph does not contain`,
            at(base, `edges.${index}.toId`),
          ),
        );
      }
      if (fromNode === undefined || toNode === undefined) continue;
      if (!isKnownKnowledgeEdgeKind(edge.kind)) continue;
      if (!isKnownKnowledgeNodeKind(fromNode.kind) || !isKnownKnowledgeNodeKind(toNode.kind)) {
        continue;
      }
      const endpoints = KNOWLEDGE_EDGE_ENDPOINTS[edge.kind];
      if (!endpoints.from.includes(fromNode.kind) || !endpoints.to.includes(toNode.kind)) {
        issues.push(
          knowledgeError(
            "incompatible_edge_endpoints",
            `A ${edge.kind} edge cannot connect a ${fromNode.kind} to a ${toNode.kind}`,
            at(base, `edges.${index}`),
          ),
        );
        continue;
      }
      if (
        (SAME_KIND_EDGE_KINDS as readonly string[]).includes(edge.kind) &&
        fromNode.kind !== toNode.kind
      ) {
        issues.push(
          knowledgeError(
            "mixed_kind_succession",
            `A ${edge.kind} edge must connect nodes of one kind, not a ${fromNode.kind} to a ${toNode.kind}`,
            at(base, `edges.${index}`),
          ),
        );
      }
      if (edge.kind === "contradicts") {
        if (
          isNonEmptyString(fromNode.subjectKey) &&
          isNonEmptyString(toNode.subjectKey) &&
          fromNode.subjectKey !== toNode.subjectKey
        ) {
          issues.push(
            knowledgeError(
              "cross_subject_contradiction",
              `A contradicts edge must connect claims of one subject, not "${fromNode.subjectKey}" to "${toNode.subjectKey}"`,
              at(base, `edges.${index}`),
            ),
          );
        }
        if (fromNode.id === toNode.id) {
          issues.push(
            knowledgeError(
              "self_contradiction",
              "A contradicts edge cannot connect a claim to itself",
              at(base, `edges.${index}`),
            ),
          );
        }
      }
    }
  }

  if (!Array.isArray(graph.sourceIds)) {
    issues.push(
      knowledgeError(
        "invalid_graph_sources",
        "Graph source ids must be a list",
        at(base, "sourceIds"),
      ),
    );
  } else {
    const seenSources = new Set<string>();
    for (let index = 0; index < graph.sourceIds.length; index += 1) {
      const sourceId = graph.sourceIds[index];
      if (!isNonEmptyString(sourceId)) {
        issues.push(
          knowledgeError(
            "empty_source_reference",
            "Graph references an empty source id",
            at(base, `sourceIds.${index}`),
          ),
        );
        continue;
      }
      if (seenSources.has(sourceId)) {
        issues.push(
          knowledgeError(
            "duplicate_source_reference",
            `Graph references source "${sourceId}" more than once`,
            at(base, `sourceIds.${index}`),
          ),
        );
      }
      seenSources.add(sourceId);
      if (Array.isArray(graph.nodes) && !sourceNodeKeys.has(sourceId)) {
        issues.push(
          knowledgeError(
            "unknown_source_reference",
            `Graph references source "${sourceId}", which no source node represents`,
            at(base, `sourceIds.${index}`),
          ),
        );
      }
    }
  }

  return issues;
}
