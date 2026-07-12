/**
 * Forever Knowledge Graph — the knowledge node.
 *
 * A {@link KnowledgeNode} is one identity the graph speaks about. The kinds
 * split into two families, and the split is the anti-fabrication line:
 *
 * - **Artifact kinds** (`project`, `source`, `fact`, `claim`, `field`,
 *   `revision`, `finding`) re-express identities the neighbouring foundations
 *   already hold — an RC4.2 `proj_` project, an RC4.4 catalogued source, an
 *   RC4.5 extracted fact, an RC4.6 canonical field or revision, an RC4.7
 *   validation finding, or a *claim*: one distinct reading of one reused
 *   RC4.5 subject, fingerprinted by the reused RC4.6 value signature. These
 *   are derived, never invented.
 * - **Entity kinds** (`developer`, `location`, `unit_type`, `amenity`,
 *   `payment_plan`, `legal_claim`) are caller-declared identities — RC4.8
 *   performs no identity resolution and never manufactures an entity from a
 *   raw value, because deciding that two spellings name one developer is
 *   normalization, and normalization is refused across the whole intake
 *   chain. A declared entity must be grounded in references or it is
 *   excluded with a structured issue.
 *
 * Every node carries `refs` — the traceability links back to what states it —
 * and only `claim` nodes carry a {@link KnowledgeStanding}: a claim is a
 * statement and can be corroborated or disputed; an identity is not, and
 * attaching certainty to it would fabricate a judgement nothing made.
 */

import { compareKnowledgeStrings } from "./helpers";
import type { KnowledgeRef } from "./reference";
import type { KnowledgeStanding } from "./standing";

/** Every kind of identity a knowledge graph can speak about. */
export type KnowledgeNodeKind =
  | "project"
  | "developer"
  | "location"
  | "unit_type"
  | "amenity"
  | "payment_plan"
  | "legal_claim"
  | "source"
  | "fact"
  | "claim"
  | "field"
  | "revision"
  | "finding";

/** Every {@link KnowledgeNodeKind}, in the canonical declared order. */
export const KNOWLEDGE_NODE_KINDS = [
  "project",
  "developer",
  "location",
  "unit_type",
  "amenity",
  "payment_plan",
  "legal_claim",
  "source",
  "fact",
  "claim",
  "field",
  "revision",
  "finding",
] as const satisfies readonly KnowledgeNodeKind[];

/** Runtime guard: whether a value is a known {@link KnowledgeNodeKind}. */
export function isKnownKnowledgeNodeKind(value: unknown): value is KnowledgeNodeKind {
  return typeof value === "string" && (KNOWLEDGE_NODE_KINDS as readonly string[]).includes(value);
}

/**
 * Rank of a node kind in the canonical declared order; an out-of-vocabulary
 * runtime value ranks after everything so a malformed node never jumps the
 * deterministic order.
 */
export function knowledgeNodeKindRank(kind: KnowledgeNodeKind): number {
  const rank = (KNOWLEDGE_NODE_KINDS as readonly KnowledgeNodeKind[]).indexOf(kind);
  return rank === -1 ? KNOWLEDGE_NODE_KINDS.length : rank;
}

/**
 * The caller-declarable entity kinds — the node kinds RC4.8 can never derive
 * from an artifact, because deriving them would be identity resolution.
 */
export type KnowledgeEntityKind =
  | "developer"
  | "location"
  | "unit_type"
  | "amenity"
  | "payment_plan"
  | "legal_claim";

/** Every {@link KnowledgeEntityKind}, in the canonical declared order. */
export const KNOWLEDGE_ENTITY_KINDS = [
  "developer",
  "location",
  "unit_type",
  "amenity",
  "payment_plan",
  "legal_claim",
] as const satisfies readonly KnowledgeEntityKind[];

/** Runtime guard: whether a value is a known {@link KnowledgeEntityKind}. */
export function isKnownKnowledgeEntityKind(value: unknown): value is KnowledgeEntityKind {
  return typeof value === "string" && (KNOWLEDGE_ENTITY_KINDS as readonly string[]).includes(value);
}

/** One identity the graph speaks about. */
export interface KnowledgeNode {
  /** Stable surrogate id, e.g. `kgn_coralina-source-psrc-coralina-price-list-v1-0-0`. */
  id: string;
  kind: KnowledgeNodeKind;
  /**
   * The node's canonical key within its kind: the project slug, a reused
   * RC4.4 source id, RC4.5 fact id, RC4.6 field path or revision id, RC4.7
   * finding id, a claim key (`subjectKey#ordinal`), or a declared entity
   * slug. Derived from the artifact's own address, never invented.
   */
  key: string;
  /** Canonical id of the project the node belongs to, e.g. `proj_coralina`. */
  projectId: string;
  /** Stated display name, only where one was stated — never derived. */
  label?: string;
  /** The reused RC4.5 subject key, on `claim` nodes. */
  subjectKey?: string;
  /**
   * The reused RC4.6 value signature of the reading a `claim` node carries —
   * the very fingerprint the canonical merge and the cross-source examination
   * compare by, so a claim here can never disagree with the judgement there.
   * Absent on a claim that states nothing (a subject nothing addresses).
   */
  signature?: string;
  /**
   * What the graph knows about the statement, on `claim` nodes only — mapped
   * from the reused RC4.7 consensus and RC4.5 fact statuses, never invented.
   * Identities carry no standing: certainty about a statement is a judgement,
   * certainty about an identity would be a fabrication.
   */
  standing?: KnowledgeStanding;
  /** The traceability links back to what states this node. Never empty. */
  refs: KnowledgeRef[];
}

/** Options accepted by {@link knowledgeNode}. */
export interface KnowledgeNodeOptions {
  label?: string;
  subjectKey?: string;
  signature?: string;
  standing?: KnowledgeStanding;
  refs?: KnowledgeRef[];
}

/**
 * Build a {@link KnowledgeNode}; optional facts are attached only when
 * supplied so an absent fact stays absent (anti-fabrication), and the refs
 * default to the empty list — a stated blank the validator flags, never an
 * invented trace. The result is deep-copied from the input, so it never
 * aliases a caller value.
 */
export function knowledgeNode(
  id: string,
  kind: KnowledgeNodeKind,
  key: string,
  projectId: string,
  options: KnowledgeNodeOptions = {},
): KnowledgeNode {
  const node: KnowledgeNode = {
    id,
    kind,
    key,
    projectId,
    refs: options.refs ?? [],
  };
  if (options.label !== undefined) node.label = options.label;
  if (options.subjectKey !== undefined) node.subjectKey = options.subjectKey;
  if (options.signature !== undefined) node.signature = options.signature;
  if (options.standing !== undefined) node.standing = options.standing;
  // Deep-copy so the described node never aliases the caller's input.
  return structuredClone(node);
}

/**
 * Comparator for the module's one deterministic node order: by canonical kind
 * rank, then key, then id.
 *
 * Suitable for `Array.prototype.sort`. Pure and total — malformed parts
 * compare through the total string comparison instead of throwing.
 */
export function compareKnowledgeNodes(a: KnowledgeNode, b: KnowledgeNode): number {
  return (
    knowledgeNodeKindRank(a?.kind) - knowledgeNodeKindRank(b?.kind) ||
    compareKnowledgeStrings(a?.key, b?.key) ||
    compareKnowledgeStrings(a?.id, b?.id)
  );
}

/**
 * A copy of the nodes in the module's one deterministic order.
 *
 * Stable and immutable: fully tied nodes keep their input order and the input
 * list is never mutated.
 */
export function sortKnowledgeNodes(nodes: readonly KnowledgeNode[]): KnowledgeNode[] {
  return [...nodes].sort(compareKnowledgeNodes);
}
