/**
 * Forever Project Sources — source relationships.
 *
 * A {@link ProjectSourceRelationships} records how one catalogued document
 * relates to the rest of the ecosystem: which registered RC3.3 source *system*
 * delivered it, which catalogued revision it supersedes or is superseded by,
 * what it was derived or translated from, and which other sources it relates
 * to. Every field is an id reference — a vocabulary value, never a live handle
 * — and every field is optional and attached only when the fact exists
 * (anti-fabrication).
 *
 * The supersession pair is what lets the registry describe multiple versions
 * of the same document without implementing storage: each received revision is
 * its own catalogued source, chained to its neighbours by id. RC4.4 resolves
 * nothing against a live registry — closing a reference stays a future
 * runtime's concern, mirroring the RC4.2 reference contract.
 */

import type { SourceId } from "@/features/forever-source-registry";

import type { ProjectSourceId } from "./types";

/** How one catalogued document relates to its neighbours. */
export interface ProjectSourceRelationships {
  /** The RC3.3 registered source *system* that delivered this document. */
  registeredSourceId?: SourceId;
  /** The catalogued revision this one replaces. */
  supersedes?: ProjectSourceId;
  /** The catalogued revision that replaced this one. */
  supersededBy?: ProjectSourceId;
  /** The catalogued source this one was derived from, e.g. an extracted page. */
  derivedFrom?: ProjectSourceId;
  /** The catalogued source this one is a translation of. */
  translationOf?: ProjectSourceId;
  /** Other catalogued sources this one relates to, in declared order. */
  related?: ProjectSourceId[];
}

/** Options accepted by {@link projectSourceRelationships}. */
export type ProjectSourceRelationshipsOptions = ProjectSourceRelationships;

/**
 * Build a {@link ProjectSourceRelationships}; every reference is attached only
 * when supplied so an absent fact stays absent (anti-fabrication).
 */
export function projectSourceRelationships(
  options: ProjectSourceRelationshipsOptions = {},
): ProjectSourceRelationships {
  const relationships: ProjectSourceRelationships = {};
  if (options.registeredSourceId !== undefined) {
    relationships.registeredSourceId = options.registeredSourceId;
  }
  if (options.supersedes !== undefined) relationships.supersedes = options.supersedes;
  if (options.supersededBy !== undefined) relationships.supersededBy = options.supersededBy;
  if (options.derivedFrom !== undefined) relationships.derivedFrom = options.derivedFrom;
  if (options.translationOf !== undefined) relationships.translationOf = options.translationOf;
  if (options.related !== undefined) relationships.related = options.related;
  return relationships;
}

/**
 * Every catalogued source a relationships value points at, in declared field
 * order with duplicates removed. The RC3.3 system reference is deliberately
 * excluded — it points at a source *system*, not a catalogued document.
 */
export function listProjectSourceRelationshipTargets(
  relationships: ProjectSourceRelationships,
): ProjectSourceId[] {
  const seen = new Set<ProjectSourceId>();
  const targets: ProjectSourceId[] = [];
  const candidates = [
    relationships.supersedes,
    relationships.supersededBy,
    relationships.derivedFrom,
    relationships.translationOf,
    ...(relationships.related ?? []),
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && !seen.has(candidate)) {
      seen.add(candidate);
      targets.push(candidate);
    }
  }
  return targets;
}
