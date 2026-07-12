/**
 * Forever Knowledge Graph — caller declarations.
 *
 * The two statement shapes a caller may put before the graph engine, and the
 * only way entity knowledge enters RC4.8:
 *
 * - a {@link KnowledgeEntityDeclaration} states that an entity (a developer,
 *   a location, a unit type, an amenity, a payment plan, a legal claim)
 *   exists under a caller-chosen slug — grounded in references to the
 *   sources, facts, or findings that mention it;
 * - a {@link KnowledgeRelationDeclaration} states that one of the declarable
 *   domain relationships holds between two nodes the graph already contains —
 *   likewise grounded.
 *
 * Declarations are statements, not commands: the engine admits a declaration
 * only when it is grounded and resolvable, and excludes it with a structured
 * issue otherwise — it never invents a missing endpoint, never resolves an
 * identity, and never upgrades a declaration's standing beyond what its
 * grounding evidence supports. RC4.8 refuses identity resolution the same way
 * RC4.6 and RC4.7 refuse value normalization: deciding that two spellings
 * name one developer is a human's (or a future runtime's) statement to make,
 * and it enters the graph only as one.
 */

import type { KnowledgeEdgeKind } from "./edge";
import type { KnowledgeEntityKind, KnowledgeNodeKind } from "./node";
import type { KnowledgeRef } from "./reference";

/** A caller's statement that an entity exists, grounded in references. */
export interface KnowledgeEntityDeclaration {
  /** The declarable entity kind. */
  kind: KnowledgeEntityKind;
  /** The caller-chosen stable slug identifying the entity, e.g. `sansiri`. */
  slug: string;
  /** Stated display name, when the caller states one. */
  name?: string;
  /**
   * Where the entity is stated: references into the reused RC4.4 sources,
   * RC4.5 facts, or RC4.7 findings that mention it. Required — an ungrounded
   * entity is excluded with a structured issue, never silently admitted.
   */
  refs: KnowledgeRef[];
}

/**
 * Addresses one node in the described graph by its kind and canonical key —
 * a *reference*, never a live handle: the engine resolves it against the
 * nodes the graph actually contains and excludes the declaration when it
 * resolves to nothing, rather than inventing an endpoint.
 */
export interface KnowledgeNodeLocator {
  kind: KnowledgeNodeKind;
  /** The node's canonical key within its kind, e.g. a source id or entity slug. */
  key: string;
}

/** A caller's statement that a domain relationship holds, grounded in references. */
export interface KnowledgeRelationDeclaration {
  /** The relationship kind; must be caller-declarable. */
  kind: KnowledgeEdgeKind;
  /** The node the relationship points from. */
  from: KnowledgeNodeLocator;
  /** The node the relationship points to. */
  to: KnowledgeNodeLocator;
  /**
   * Why the relationship is asserted: references into the reused sources,
   * facts, fields, revisions, or findings that state it. Required — an
   * ungrounded relation is excluded with a structured issue.
   */
  refs: KnowledgeRef[];
  /** The caller's stated note, when one is stated. */
  note?: string;
}
