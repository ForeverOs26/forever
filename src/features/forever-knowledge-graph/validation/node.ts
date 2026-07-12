/**
 * Forever Knowledge Graph — node validation.
 *
 * Structural guards over one {@link KnowledgeNode}: it must carry an id, a
 * known kind, a key, and a project; the claim-only facts (subject key,
 * signature, standing) may appear on claim nodes only — a standing on an
 * identity would fabricate a judgement nothing made — and a claim must name
 * its subject; and — the module's traceability mandate — every node must
 * carry at least one anchored reference back to what states it. A
 * structurally absent part is reported as missing, never dereferenced. All
 * checks return issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { KnowledgeNode } from "../node";
import { isKnownKnowledgeNodeKind } from "../node";
import { isKnownKnowledgeStanding } from "../standing";
import { knowledgeError } from "../types";
import type { KnowledgeIssue } from "../types";
import { validateKnowledgeRef } from "./reference";

/**
 * Validate one node. `base` locates it; e.g. `nodes.0`.
 *
 * Never throws: a node so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateKnowledgeNode(node: KnowledgeNode, base = "node"): KnowledgeIssue[] {
  try {
    return validateKnowledgeNodeUnguarded(node, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "Knowledge node behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateKnowledgeNodeUnguarded(node: KnowledgeNode, base: string): KnowledgeIssue[] {
  if (isAbsent(node)) {
    return [knowledgeError("missing_node", "Knowledge node is absent", base)];
  }
  const issues: KnowledgeIssue[] = [];

  if (!isNonEmptyString(node.id)) {
    issues.push(knowledgeError("missing_node_id", "Node is missing an id", `${base}.id`));
  }
  if (!isKnownKnowledgeNodeKind(node.kind)) {
    issues.push(
      knowledgeError(
        "unknown_node_kind",
        `Node has an unknown kind "${String(node.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (!isNonEmptyString(node.key)) {
    issues.push(knowledgeError("missing_node_key", "Node carries no canonical key", `${base}.key`));
  }
  if (!isNonEmptyString(node.projectId)) {
    issues.push(
      knowledgeError(
        "missing_node_project",
        "Node names no canonical project",
        `${base}.projectId`,
      ),
    );
  }
  if (node.label !== undefined && !isNonEmptyString(node.label)) {
    issues.push(
      knowledgeError("empty_node_label", "Node declares an empty label", `${base}.label`),
    );
  }
  if (node.subjectKey !== undefined && !isNonEmptyString(node.subjectKey)) {
    issues.push(
      knowledgeError(
        "empty_node_subject",
        "Node declares an empty subject key",
        `${base}.subjectKey`,
      ),
    );
  }
  if (node.signature !== undefined && typeof node.signature !== "string") {
    issues.push(
      knowledgeError(
        "invalid_node_signature",
        "Node declares a non-string signature",
        `${base}.signature`,
      ),
    );
  }
  if (node.standing !== undefined && !isKnownKnowledgeStanding(node.standing)) {
    issues.push(
      knowledgeError(
        "unknown_node_standing",
        `Node has an unknown standing "${String(node.standing)}"`,
        `${base}.standing`,
      ),
    );
  }

  // The claim/identity line: a statement can be judged, an identity cannot —
  // certainty attached to an identity would be a fabricated judgement.
  if (node.kind === "claim") {
    if (!isNonEmptyString(node.subjectKey)) {
      issues.push(
        knowledgeError(
          "claim_without_subject",
          "Claim node names no reused RC4.5 subject key",
          `${base}.subjectKey`,
        ),
      );
    }
    if (node.standing === undefined) {
      issues.push(
        knowledgeError(
          "claim_without_standing",
          "Claim node states no standing — even unjudged knowledge is explicitly unverified",
          `${base}.standing`,
        ),
      );
    }
  } else if (isKnownKnowledgeNodeKind(node.kind)) {
    for (const part of ["subjectKey", "signature", "standing"] as const) {
      if (node[part] !== undefined) {
        issues.push(
          knowledgeError(
            "misplaced_claim_fact",
            `Node of kind "${node.kind}" declares a claim-only ${part}`,
            `${base}.${part}`,
          ),
        );
      }
    }
  }

  if (!Array.isArray(node.refs)) {
    issues.push(
      knowledgeError("invalid_node_refs", "Node references must be a list", `${base}.refs`),
    );
  } else {
    // Indexed — never a hole-skipping iterator — so an absent slot is
    // reported as a missing reference instead of vanishing silently.
    for (let index = 0; index < node.refs.length; index += 1) {
      issues.push(...validateKnowledgeRef(node.refs[index], `${base}.refs.${index}`));
    }
    // The traceability mandate: every node traces back to what states it.
    if (node.refs.length === 0) {
      issues.push(
        knowledgeError(
          "untraceable_node",
          "Node references nothing — it cannot be traced back to any Forever artifact",
          `${base}.refs`,
        ),
      );
    }
  }

  return issues;
}
