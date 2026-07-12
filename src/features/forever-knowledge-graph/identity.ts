/**
 * Forever Knowledge Graph — graph, node, and edge identity.
 *
 * The deterministic naming helpers reuse the RC4.6 slug rule (itself the
 * RC4.5/RC4.4/RC4.2/RC3.0 `slugify` rule) and the RC4.2 `proj_` project-id
 * convention rather than restating any identity logic. They take no clock,
 * counter, or randomness, and therefore always produce byte-identical ids —
 * which is what makes a knowledge graph safe to regenerate, diff, and
 * validate.
 *
 * A graph is addressed by the project it represents, with an optional
 * caller-stated batch slug participating so repeated descriptions of the same
 * project never collide — the batch is a caller's statement, never an
 * invented discriminator. A node is addressed by its kind and its canonical
 * key within that kind (a source id, fact id, subject key, field path,
 * revision id, finding id, or declared entity slug), so the same artifact
 * always derives the same node id. An edge is addressed *within* its graph by
 * its kind and its 1-based position among edges of that kind in the graph's
 * one deterministic order — the RC4.7 finding-id convention, reused.
 */

import {
  normalizeProjectDatabaseSlug,
  projectDatabaseProjectId,
} from "@/features/forever-project-database";

// Reuse the RC4.6 slug rule (itself RC4.5/RC4.4/RC4.2/RC3.0 `slugify`) under a
// knowledge-graph-facing name — one normalization rule across the whole
// system, never a local variant.
export { normalizeProjectDatabaseSlug as normalizeKnowledgeSlug };

// Reuse the RC4.2 `proj_` convention (through the RC4.6 re-export — the very
// same function) so a graph's project id is byte-identical to the id every
// other foundation derives for the same slug.
export { projectDatabaseProjectId as knowledgeProjectId };

/** The id prefix conventions RC4.8 derives its ids from. */
export const KNOWLEDGE_GRAPH_ID_PREFIXES = {
  graph: "kgr_",
  node: "kgn_",
  edge: "kge_",
} as const;

/**
 * Deterministic graph id for a project slug and optional caller-stated batch
 * slug, e.g. (`coralina`) → `kgr_coralina` and (`coralina`, `2026-07`) →
 * `kgr_coralina-2026-07`.
 *
 * The batch participates in the id only when the caller states one, so two
 * descriptions the caller distinguishes never collide — and an unstated batch
 * is never fabricated into the name.
 */
export function knowledgeGraphIdFor(projectSlug: string, batch?: string): string {
  const base = `${KNOWLEDGE_GRAPH_ID_PREFIXES.graph}${normalizeProjectDatabaseSlug(projectSlug)}`;
  return batch === undefined ? base : `${base}-${normalizeProjectDatabaseSlug(batch)}`;
}

/**
 * Deterministic node id for a project slug, node kind, and the node's
 * canonical key within that kind, e.g. (`coralina`, `source`,
 * `psrc_coralina-price-list-v1-0-0`) →
 * `kgn_coralina-source-psrc-coralina-price-list-v1-0-0`.
 *
 * The key is the artifact's own canonical address (a reused RC4.4 source id,
 * RC4.5 fact id or subject key, RC4.6 field path or revision id, RC4.7
 * finding id, or a caller-declared entity slug) — normalized, never invented
 * — so the same artifact always derives the same node id.
 */
export function knowledgeNodeIdFor(projectSlug: string, kind: string, key: string): string {
  return `${KNOWLEDGE_GRAPH_ID_PREFIXES.node}${normalizeProjectDatabaseSlug(
    projectSlug,
  )}-${normalizeProjectDatabaseSlug(kind)}-${normalizeProjectDatabaseSlug(key)}`;
}

/**
 * Deterministic edge id for a project slug, edge kind, and the edge's 1-based
 * position among edges of the same kind in the graph's deterministic order,
 * e.g. (`coralina`, `describes`, 1) → `kge_coralina-describes-1`.
 *
 * The ordinal participates so two edges of one kind never collide, and
 * because the graph's edge order is itself deterministic, the same input
 * always derives the same edge ids — the RC4.7 finding-id convention, reused.
 */
export function knowledgeEdgeIdFor(projectSlug: string, kind: string, ordinal: number): string {
  return `${KNOWLEDGE_GRAPH_ID_PREFIXES.edge}${normalizeProjectDatabaseSlug(
    projectSlug,
  )}-${normalizeProjectDatabaseSlug(kind)}-${ordinal}`;
}
