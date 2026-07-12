/**
 * Forever Knowledge Graph — declaration validation.
 *
 * Structural guards over the caller's statements before the engine sees
 * them: an entity declaration must state a known entity kind, a usable slug,
 * and at least one anchored grounding reference; a relation declaration must
 * state a declarable kind, two coherent node locators, and likewise anchored
 * grounding. These are the same judgements the engine applies at intake —
 * exposed so a caller can validate declarations standalone. A structurally
 * absent part is reported as missing, never dereferenced. All checks return
 * issues; none throw.
 */

import type { KnowledgeEntityDeclaration, KnowledgeRelationDeclaration } from "../declaration";
import type { KnowledgeNodeLocator } from "../declaration";
import { isDeclarableKnowledgeEdgeKind } from "../edge";
import { isAbsent, isNonEmptyString } from "../helpers";
import { isKnownKnowledgeEntityKind, isKnownKnowledgeNodeKind } from "../node";
import { isAnchoredKnowledgeRef } from "../reference";
import { knowledgeError } from "../types";
import type { KnowledgeIssue } from "../types";
import { validateKnowledgeRef } from "./reference";

function validateGrounding(refs: unknown, base: string): KnowledgeIssue[] {
  if (!Array.isArray(refs)) {
    return [
      knowledgeError("invalid_declaration_refs", "Declaration references must be a list", base),
    ];
  }
  const issues: KnowledgeIssue[] = [];
  // Indexed — never a hole-skipping iterator — so an absent slot is
  // reported as a missing reference instead of vanishing silently.
  for (let index = 0; index < refs.length; index += 1) {
    issues.push(...validateKnowledgeRef(refs[index], `${base}.${index}`));
  }
  if (!refs.some((ref) => isAnchoredKnowledgeRef(ref))) {
    issues.push(
      knowledgeError(
        "ungrounded_declaration",
        "Declaration is grounded in no anchored reference — it would be excluded, never invented",
        base,
      ),
    );
  }
  return issues;
}

/**
 * Validate one entity declaration. `base` locates it; e.g. `entities.0`.
 *
 * Never throws: a declaration so hostile it cannot even be read settles into
 * one structured issue.
 */
export function validateKnowledgeEntityDeclaration(
  declaration: KnowledgeEntityDeclaration,
  base = "entity",
): KnowledgeIssue[] {
  try {
    return validateKnowledgeEntityDeclarationUnguarded(declaration, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "Entity declaration behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateKnowledgeEntityDeclarationUnguarded(
  declaration: KnowledgeEntityDeclaration,
  base: string,
): KnowledgeIssue[] {
  if (isAbsent(declaration)) {
    return [knowledgeError("missing_entity_declaration", "Entity declaration is absent", base)];
  }
  const issues: KnowledgeIssue[] = [];

  if (!isKnownKnowledgeEntityKind(declaration.kind)) {
    issues.push(
      knowledgeError(
        "unknown_entity_kind",
        `Entity declaration states an unknown kind "${String(declaration.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (!isNonEmptyString(declaration.slug)) {
    issues.push(
      knowledgeError("missing_entity_slug", "Entity declaration states no slug", `${base}.slug`),
    );
  }
  if (declaration.name !== undefined && !isNonEmptyString(declaration.name)) {
    issues.push(
      knowledgeError(
        "empty_entity_name",
        "Entity declaration declares an empty name",
        `${base}.name`,
      ),
    );
  }
  issues.push(...validateGrounding(declaration.refs, `${base}.refs`));

  return issues;
}

function validateLocator(locator: KnowledgeNodeLocator, base: string): KnowledgeIssue[] {
  if (isAbsent(locator)) {
    return [knowledgeError("missing_relation_endpoint", "Relation endpoint is absent", base)];
  }
  const issues: KnowledgeIssue[] = [];
  if (!isKnownKnowledgeNodeKind(locator.kind)) {
    issues.push(
      knowledgeError(
        "unknown_endpoint_kind",
        `Relation endpoint states an unknown node kind "${String(locator.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (!isNonEmptyString(locator.key)) {
    issues.push(
      knowledgeError(
        "missing_endpoint_key",
        "Relation endpoint states no canonical key",
        `${base}.key`,
      ),
    );
  }
  return issues;
}

/**
 * Validate one relation declaration. `base` locates it; e.g. `relations.0`.
 *
 * Never throws: a declaration so hostile it cannot even be read settles into
 * one structured issue.
 */
export function validateKnowledgeRelationDeclaration(
  declaration: KnowledgeRelationDeclaration,
  base = "relation",
): KnowledgeIssue[] {
  try {
    return validateKnowledgeRelationDeclarationUnguarded(declaration, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "Relation declaration behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateKnowledgeRelationDeclarationUnguarded(
  declaration: KnowledgeRelationDeclaration,
  base: string,
): KnowledgeIssue[] {
  if (isAbsent(declaration)) {
    return [knowledgeError("missing_relation_declaration", "Relation declaration is absent", base)];
  }
  const issues: KnowledgeIssue[] = [];

  if (!isDeclarableKnowledgeEdgeKind(declaration.kind)) {
    issues.push(
      knowledgeError(
        "undeclarable_relation",
        `Relation declaration states a kind "${String(declaration.kind)}" a caller cannot declare`,
        `${base}.kind`,
      ),
    );
  }
  issues.push(...validateLocator(declaration.from, `${base}.from`));
  issues.push(...validateLocator(declaration.to, `${base}.to`));
  if (declaration.note !== undefined && !isNonEmptyString(declaration.note)) {
    issues.push(
      knowledgeError(
        "empty_relation_note",
        "Relation declaration declares an empty note",
        `${base}.note`,
      ),
    );
  }
  issues.push(...validateGrounding(declaration.refs, `${base}.refs`));

  return issues;
}
