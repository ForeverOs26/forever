/**
 * Forever Knowledge Graph — the knowledge edge.
 *
 * A {@link KnowledgeEdge} is one directed relationship between two nodes.
 * Every edge carries its {@link KnowledgeEdgeOrigin} — whether it was
 * *derived* from what a reused RC4.4/RC4.5/RC4.6/RC4.7 artifact itself
 * declares, or *declared* by the caller as a grounded statement — a
 * {@link KnowledgeStanding} that never exceeds the underlying evidence,
 * and `refs`: the traceability links that explain why the relationship is
 * asserted at all. An edge without an anchored reference is untraceable and
 * validation says so; the engine never emits one.
 *
 * The kind vocabulary is closed, and each kind fixes which node kinds may
 * stand at its ends ({@link KNOWLEDGE_EDGE_ENDPOINTS}) — so "a finding
 * affects a fact" is expressible and "a developer supersedes a revision" is
 * structurally rejected. The entity-facing kinds ({@link
 * DECLARABLE_KNOWLEDGE_EDGE_KINDS}) can *only* be declared by a caller:
 * deriving "project developed_by developer" from a raw fact value would be
 * identity resolution, which RC4.8 refuses — the fact stays the evidence a
 * declaration grounds in.
 */

import { compareKnowledgeStrings } from "./helpers";
import type { KnowledgeNodeKind } from "./node";
import type { KnowledgeRef } from "./reference";
import { knowledgeRefOrderKey } from "./reference";
import type { KnowledgeStanding } from "./standing";
import type { KnowledgeConfidence } from "./types";

/** Every kind of relationship a knowledge graph can represent. */
export type KnowledgeEdgeKind =
  | "describes"
  | "extracted_from"
  | "states"
  | "addresses"
  | "supports"
  | "contradicts"
  | "conflicts_with"
  | "supersedes"
  | "derived_from"
  | "translation_of"
  | "related_to"
  | "affects"
  | "developed_by"
  | "located_in"
  | "near"
  | "contains"
  | "offers"
  | "refers_to";

/** Every {@link KnowledgeEdgeKind}, in the canonical declared order. */
export const KNOWLEDGE_EDGE_KINDS = [
  "describes",
  "extracted_from",
  "states",
  "addresses",
  "supports",
  "contradicts",
  "conflicts_with",
  "supersedes",
  "derived_from",
  "translation_of",
  "related_to",
  "affects",
  "developed_by",
  "located_in",
  "near",
  "contains",
  "offers",
  "refers_to",
] as const satisfies readonly KnowledgeEdgeKind[];

/** Runtime guard: whether a value is a known {@link KnowledgeEdgeKind}. */
export function isKnownKnowledgeEdgeKind(value: unknown): value is KnowledgeEdgeKind {
  return typeof value === "string" && (KNOWLEDGE_EDGE_KINDS as readonly string[]).includes(value);
}

/**
 * Rank of an edge kind in the canonical declared order; an out-of-vocabulary
 * runtime value ranks after everything so a malformed edge never jumps the
 * deterministic order.
 */
export function knowledgeEdgeKindRank(kind: KnowledgeEdgeKind): number {
  const rank = (KNOWLEDGE_EDGE_KINDS as readonly KnowledgeEdgeKind[]).indexOf(kind);
  return rank === -1 ? KNOWLEDGE_EDGE_KINDS.length : rank;
}

/**
 * Which node kinds may stand at each end of each edge kind — the structural
 * grammar of the graph. `supersedes` and `derived_from` additionally require
 * both ends to be the *same* kind (a source supersedes a source, a fact a
 * fact, a revision a revision), which graph validation enforces on top of
 * this table.
 */
export const KNOWLEDGE_EDGE_ENDPOINTS: Record<
  KnowledgeEdgeKind,
  { from: readonly KnowledgeNodeKind[]; to: readonly KnowledgeNodeKind[] }
> = {
  describes: { from: ["source"], to: ["project"] },
  extracted_from: { from: ["fact"], to: ["source"] },
  states: { from: ["fact"], to: ["claim"] },
  addresses: { from: ["claim"], to: ["field"] },
  supports: { from: ["fact", "source"], to: ["field", "claim"] },
  contradicts: { from: ["claim"], to: ["claim"] },
  conflicts_with: { from: ["fact"], to: ["fact", "field"] },
  supersedes: {
    from: ["source", "fact", "revision"],
    to: ["source", "fact", "revision"],
  },
  derived_from: { from: ["source", "fact"], to: ["source", "fact"] },
  translation_of: { from: ["source"], to: ["source"] },
  related_to: { from: ["source"], to: ["source"] },
  affects: { from: ["finding"], to: ["fact", "source", "claim", "field"] },
  developed_by: { from: ["project"], to: ["developer"] },
  located_in: { from: ["project"], to: ["location"] },
  near: { from: ["project"], to: ["location"] },
  contains: { from: ["project"], to: ["unit_type"] },
  offers: { from: ["project"], to: ["amenity", "payment_plan"] },
  refers_to: {
    from: ["source"],
    to: ["project", "developer", "location", "unit_type", "amenity", "payment_plan", "legal_claim"],
  },
};

/**
 * The edge kinds only a caller may declare — the entity-facing domain
 * relationships RC4.8 can never derive, because deriving them from raw fact
 * values would be identity resolution.
 */
export const DECLARABLE_KNOWLEDGE_EDGE_KINDS = [
  "developed_by",
  "located_in",
  "near",
  "contains",
  "offers",
  "refers_to",
] as const satisfies readonly KnowledgeEdgeKind[];

/** Runtime guard: whether an edge kind is caller-declarable. */
export function isDeclarableKnowledgeEdgeKind(value: unknown): value is KnowledgeEdgeKind {
  return (
    typeof value === "string" &&
    (DECLARABLE_KNOWLEDGE_EDGE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Where an edge came from: `derived` re-expresses what a reused artifact
 * itself declares; `declared` re-expresses a caller's grounded statement.
 * Nothing else exists — an edge is never guessed into being.
 */
export type KnowledgeEdgeOrigin = "derived" | "declared";

/** Every {@link KnowledgeEdgeOrigin}, in a stable declared order. */
export const KNOWLEDGE_EDGE_ORIGINS = [
  "derived",
  "declared",
] as const satisfies readonly KnowledgeEdgeOrigin[];

/** Runtime guard: whether a value is a known {@link KnowledgeEdgeOrigin}. */
export function isKnownKnowledgeEdgeOrigin(value: unknown): value is KnowledgeEdgeOrigin {
  return typeof value === "string" && (KNOWLEDGE_EDGE_ORIGINS as readonly string[]).includes(value);
}

/** One directed relationship between two knowledge nodes. */
export interface KnowledgeEdge {
  /** Stable surrogate id, e.g. `kge_coralina-describes-1`. */
  id: string;
  kind: KnowledgeEdgeKind;
  /** The id of the node the relationship points from. */
  fromId: string;
  /** The id of the node the relationship points to. */
  toId: string;
  /** Canonical id of the project the edge belongs to, e.g. `proj_coralina`. */
  projectId: string;
  origin: KnowledgeEdgeOrigin;
  /** What the graph knows about the relationship — never more than stated. */
  standing: KnowledgeStanding;
  /**
   * The reused RC4.5 confidence the single grounding fact carried, attached
   * only when that fact stated a coherent one — never a re-graded copy, never
   * an aggregate.
   */
  confidence?: KnowledgeConfidence;
  /** The traceability links back to what states this edge. Never empty. */
  refs: KnowledgeRef[];
  /** The caller's stated note on a declared edge, when one was stated. */
  note?: string;
}

/** Options accepted by {@link knowledgeEdge}. */
export interface KnowledgeEdgeOptions {
  confidence?: KnowledgeConfidence;
  refs?: KnowledgeRef[];
  note?: string;
}

/**
 * Build a {@link KnowledgeEdge}; optional facts are attached only when
 * supplied so an absent fact stays absent (anti-fabrication), and the refs
 * default to the empty list — a stated blank the validator flags, never an
 * invented trace. The result is deep-copied from the input, so it never
 * aliases a caller value.
 */
export function knowledgeEdge(
  id: string,
  kind: KnowledgeEdgeKind,
  fromId: string,
  toId: string,
  projectId: string,
  origin: KnowledgeEdgeOrigin,
  standing: KnowledgeStanding,
  options: KnowledgeEdgeOptions = {},
): KnowledgeEdge {
  const edge: KnowledgeEdge = {
    id,
    kind,
    fromId,
    toId,
    projectId,
    origin,
    standing,
    refs: options.refs ?? [],
  };
  if (options.confidence !== undefined) edge.confidence = options.confidence;
  if (options.note !== undefined) edge.note = options.note;
  // Deep-copy so the described edge never aliases the caller's input.
  return structuredClone(edge);
}

/**
 * Comparator for the module's one deterministic edge order: by canonical kind
 * rank, then from-node id, then to-node id, then the first reference's order
 * key, then id.
 *
 * Suitable for `Array.prototype.sort`. Pure and total — malformed parts
 * compare through the total string comparison instead of throwing.
 */
export function compareKnowledgeEdges(a: KnowledgeEdge, b: KnowledgeEdge): number {
  return (
    knowledgeEdgeKindRank(a?.kind) - knowledgeEdgeKindRank(b?.kind) ||
    compareKnowledgeStrings(a?.fromId, b?.fromId) ||
    compareKnowledgeStrings(a?.toId, b?.toId) ||
    compareKnowledgeStrings(
      knowledgeRefOrderKey(a?.refs?.[0]),
      knowledgeRefOrderKey(b?.refs?.[0]),
    ) ||
    compareKnowledgeStrings(a?.id, b?.id)
  );
}

/**
 * A copy of the edges in the module's one deterministic order.
 *
 * Stable and immutable: fully tied edges keep their input order and the input
 * list is never mutated.
 */
export function sortKnowledgeEdges(edges: readonly KnowledgeEdge[]): KnowledgeEdge[] {
  return [...edges].sort(compareKnowledgeEdges);
}
