/**
 * Forever Knowledge Graph — edge validation.
 *
 * Structural guards over one {@link KnowledgeEdge}: it must carry an id, a
 * known kind, both endpoints, a project, a known origin, and a known
 * standing; a conflict-family edge (`contradicts`, `conflicts_with`) must
 * carry the `disputed` standing — anything milder would silently imply
 * certainty beyond the disagreement it represents; the entity-facing domain
 * kinds may only be `declared` and everything else only `derived` — an edge
 * is never guessed into being; the optional confidence must pass the reused
 * RC4.5 guard; and — the module's traceability mandate — every edge must
 * carry at least one anchored reference. A structurally absent part is
 * reported as missing, never dereferenced. All checks return issues; none
 * throw.
 */

import { validateExtractionConfidence } from "@/features/forever-extraction-pipeline";

import type { KnowledgeEdge } from "../edge";
import {
  isDeclarableKnowledgeEdgeKind,
  isKnownKnowledgeEdgeKind,
  isKnownKnowledgeEdgeOrigin,
} from "../edge";
import { isAbsent, isNonEmptyString } from "../helpers";
import { isKnownKnowledgeStanding } from "../standing";
import { knowledgeError } from "../types";
import type { KnowledgeIssue } from "../types";
import { validateKnowledgeRef } from "./reference";

/**
 * Validate one edge. `base` locates it; e.g. `edges.0`.
 *
 * Never throws: an edge so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateKnowledgeEdge(edge: KnowledgeEdge, base = "edge"): KnowledgeIssue[] {
  try {
    return validateKnowledgeEdgeUnguarded(edge, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "Knowledge edge behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateKnowledgeEdgeUnguarded(edge: KnowledgeEdge, base: string): KnowledgeIssue[] {
  if (isAbsent(edge)) {
    return [knowledgeError("missing_edge", "Knowledge edge is absent", base)];
  }
  const issues: KnowledgeIssue[] = [];

  if (!isNonEmptyString(edge.id)) {
    issues.push(knowledgeError("missing_edge_id", "Edge is missing an id", `${base}.id`));
  }
  if (!isKnownKnowledgeEdgeKind(edge.kind)) {
    issues.push(
      knowledgeError(
        "unknown_edge_kind",
        `Edge has an unknown kind "${String(edge.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (!isNonEmptyString(edge.fromId)) {
    issues.push(knowledgeError("missing_edge_from", "Edge points from no node", `${base}.fromId`));
  }
  if (!isNonEmptyString(edge.toId)) {
    issues.push(knowledgeError("missing_edge_to", "Edge points to no node", `${base}.toId`));
  }
  if (!isNonEmptyString(edge.projectId)) {
    issues.push(
      knowledgeError(
        "missing_edge_project",
        "Edge names no canonical project",
        `${base}.projectId`,
      ),
    );
  }
  if (!isKnownKnowledgeEdgeOrigin(edge.origin)) {
    issues.push(
      knowledgeError(
        "unknown_edge_origin",
        `Edge has an unknown origin "${String(edge.origin)}"`,
        `${base}.origin`,
      ),
    );
  }
  if (!isKnownKnowledgeStanding(edge.standing)) {
    issues.push(
      knowledgeError(
        "unknown_edge_standing",
        `Edge has an unknown standing "${String(edge.standing)}"`,
        `${base}.standing`,
      ),
    );
  }

  // A represented disagreement must say it is one: any milder standing on a
  // conflict-family edge would silently imply certainty beyond the evidence.
  if (
    (edge.kind === "contradicts" || edge.kind === "conflicts_with") &&
    isKnownKnowledgeStanding(edge.standing) &&
    edge.standing !== "disputed"
  ) {
    issues.push(
      knowledgeError(
        "understated_conflict",
        `A ${edge.kind} edge must stand disputed, not "${edge.standing}" — a disagreement is never milder than itself`,
        `${base}.standing`,
      ),
    );
  }

  // The derivation line: domain relationships enter only as declarations,
  // everything else only as derivations — an edge is never guessed.
  if (isKnownKnowledgeEdgeKind(edge.kind) && isKnownKnowledgeEdgeOrigin(edge.origin)) {
    if (edge.origin === "derived" && isDeclarableKnowledgeEdgeKind(edge.kind)) {
      issues.push(
        knowledgeError(
          "underivable_edge",
          `A ${edge.kind} edge cannot be derived — deriving it would be identity resolution, which RC4.8 refuses`,
          `${base}.origin`,
        ),
      );
    }
    if (edge.origin === "declared" && !isDeclarableKnowledgeEdgeKind(edge.kind)) {
      issues.push(
        knowledgeError(
          "undeclarable_edge",
          `A ${edge.kind} edge cannot be declared — it re-expresses what the reused artifacts themselves state`,
          `${base}.origin`,
        ),
      );
    }
  }

  if (edge.confidence !== undefined) {
    issues.push(...validateExtractionConfidence(edge.confidence, `${base}.confidence`));
  }
  if (edge.note !== undefined && !isNonEmptyString(edge.note)) {
    issues.push(knowledgeError("empty_edge_note", "Edge declares an empty note", `${base}.note`));
  }

  if (!Array.isArray(edge.refs)) {
    issues.push(
      knowledgeError("invalid_edge_refs", "Edge references must be a list", `${base}.refs`),
    );
  } else {
    // Indexed — never a hole-skipping iterator — so an absent slot is
    // reported as a missing reference instead of vanishing silently.
    for (let index = 0; index < edge.refs.length; index += 1) {
      issues.push(...validateKnowledgeRef(edge.refs[index], `${base}.refs.${index}`));
    }
    // The traceability mandate: every edge is explainable through existing
    // source, fact, field, revision, or validation references.
    if (edge.refs.length === 0) {
      issues.push(
        knowledgeError(
          "untraceable_edge",
          "Edge references nothing — the relationship cannot be explained by any Forever artifact",
          `${base}.refs`,
        ),
      );
    }
  }

  return issues;
}
