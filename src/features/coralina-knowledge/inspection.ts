/**
 * Coralina knowledge inspection — the application-facing view of the RC5.0
 * vertical slice.
 *
 * As of RC5.1 the row shapes and derivation live in the project-agnostic
 * engine (`@/features/forever-project-knowledge`); this module re-exports the
 * shapes under their RC5.0 names and delegates, passing Coralina's stated
 * page copy through. Every row preserves traceability (fact ids, source ids,
 * pages, excerpts) and honesty (consensus, standings, withheld facts,
 * disputes, and missing information are shown exactly as the foundations
 * judged them — nothing is smoothed over for display).
 */

import {
  describeProjectKnowledgeInspection,
  type ProjectKnowledgeChainStageRow,
  type ProjectKnowledgeDisputeClaimRow,
  type ProjectKnowledgeDisputeRow,
  type ProjectKnowledgeFactRow,
  type ProjectKnowledgeFieldRow,
  type ProjectKnowledgeFindingRow,
  type ProjectKnowledgeGraphSummary,
  type ProjectKnowledgeInspection,
  type ProjectKnowledgeMissingRow,
  type ProjectKnowledgeReadinessRow,
  type ProjectKnowledgeReadinessSummary,
  type ProjectKnowledgeSourceRow,
  type ProjectKnowledgeWithheldRow,
} from "@/features/forever-project-knowledge";

import { CORALINA_KNOWLEDGE_DEFINITION } from "./definition";
import { buildCoralinaKnowledgeSlice, type CoralinaKnowledgeSlice } from "./slice";

export type CoralinaChainStageRow = ProjectKnowledgeChainStageRow;
export type CoralinaSourceRow = ProjectKnowledgeSourceRow;
export type CoralinaFactRow = ProjectKnowledgeFactRow;
export type CoralinaFieldRow = ProjectKnowledgeFieldRow;
export type CoralinaDisputeClaimRow = ProjectKnowledgeDisputeClaimRow;
export type CoralinaDisputeRow = ProjectKnowledgeDisputeRow;
export type CoralinaMissingRow = ProjectKnowledgeMissingRow;
export type CoralinaWithheldRow = ProjectKnowledgeWithheldRow;
export type CoralinaFindingRow = ProjectKnowledgeFindingRow;
export type CoralinaGraphSummary = ProjectKnowledgeGraphSummary;
export type CoralinaReadinessRow = ProjectKnowledgeReadinessRow;
export type CoralinaReadinessSummary = ProjectKnowledgeReadinessSummary;

/** Serialisable, application-facing view of the Coralina RC4.4→RC4.9 result. */
export type CoralinaKnowledgeInspection = ProjectKnowledgeInspection;

/** Derive the application-facing inspection view from a built slice. */
export function describeCoralinaKnowledgeInspection(
  slice: CoralinaKnowledgeSlice,
): CoralinaKnowledgeInspection {
  return describeProjectKnowledgeInspection(slice, CORALINA_KNOWLEDGE_DEFINITION.copy);
}

let cachedInspection: CoralinaKnowledgeInspection | undefined;

/**
 * The Coralina inspection view, built once per process. The slice is pure and
 * deterministic, so caching is safe and keeps route loads cheap. Each call
 * returns an independent deep copy: on the server one process serves many
 * requests, and a caller mutating shared loader data in place must never be
 * able to poison the cache for every later request.
 */
export function getCoralinaKnowledgeInspection(): CoralinaKnowledgeInspection {
  cachedInspection ??= describeCoralinaKnowledgeInspection(buildCoralinaKnowledgeSlice());
  return structuredClone(cachedInspection);
}
