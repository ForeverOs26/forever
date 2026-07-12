/**
 * Forever Extraction Pipeline — deterministic, immutable helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: stable
 * natural keys for identities and definitions, recipe lookups and structural
 * counters, distinct collectors over the module's vocabularies, and the fact
 * collection helpers that let one source produce many facts, many sources
 * produce the same fact type, and conflicting readings coexist — grouped and
 * ordered deterministically, never resolved. Given the same input they always
 * return the same output — no randomness, no clocks, no locale — so the whole
 * module stays deterministic and these helpers never need re-implementing per
 * call site.
 *
 * The string and absence guards are reused verbatim from the Forever Project
 * Sources (RC4.4) helpers rather than restated, so RC4.5 shares one
 * definition of "non-empty string" and "absent" with the source machinery it
 * also reuses, and the stats combiners are the RC4.0 ones under
 * extraction-facing names.
 */

import type {
  ProjectSourceDocumentType,
  ProjectSourceId,
} from "@/features/forever-project-sources";
import { isAbsent, isNonEmptyString } from "@/features/forever-project-sources";

import type { ExtractionDefinition } from "./definition";
import type { ExtractionFact } from "./fact";
import { extractionFactSubjectKey } from "./fact";
import type { ExtractionFactType } from "./facttype";
import { compareExtractionFactType } from "./facttype";
import type { ExtractionIdentity } from "./identity";
import type { ExtractionRecipe } from "./recipe";
import { extractionFactStatusCarriesValue, isCurrentExtractionFactStatus } from "./status";
import type { ExtractionStep } from "./step";
import { compareExtractionVersion } from "./version";

export { isAbsent, isNonEmptyString };

// Reuse the RC4.0 stats combiners under extraction-facing names — the stats
// shape is the RC4.0 one, so the arithmetic is too.
export {
  mergeProjectIntegrationStats as mergeExtractionStats,
  sumProjectIntegrationStats as sumExtractionStats,
} from "@/features/forever-project-integration";

/**
 * Stable key for an extraction identity, independent of its surrogate id: the
 * normalized slug. Two identities under the same slug share a key.
 */
export function extractionIdentityKey(identity: ExtractionIdentity): string {
  return identity.slug;
}

/** Stable natural key for a definition, derived from its identity. */
export function extractionDefinitionKey(definition: ExtractionDefinition): string {
  return extractionIdentityKey(definition.identity);
}

/** The number of recipes a definition declares. */
export function extractionRecipeCount(definition: ExtractionDefinition): number {
  return definition.recipes.length;
}

/** The recipe of a definition with a given id, or `undefined`. */
export function findExtractionRecipe(
  definition: ExtractionDefinition,
  recipeId: string,
): ExtractionRecipe | undefined {
  return definition.recipes.find((recipe) => recipe.id === recipeId);
}

/** A definition's default recipe: the first it declares, or `undefined`. */
export function defaultExtractionRecipe(
  definition: ExtractionDefinition,
): ExtractionRecipe | undefined {
  return definition.recipes.length > 0 ? definition.recipes[0] : undefined;
}

/** The number of stages in a recipe. */
export function extractionRecipeStageCount(recipe: ExtractionRecipe): number {
  return recipe.stages.length;
}

/** The total number of steps across every stage of a recipe. */
export function extractionRecipeStepCount(recipe: ExtractionRecipe): number {
  return recipe.stages.reduce((total, stage) => total + stage.steps.length, 0);
}

/** Every step of a recipe, flattened in stage-then-step declared order. */
export function listExtractionRecipeSteps(recipe: ExtractionRecipe): ExtractionStep[] {
  return recipe.stages.flatMap((stage) => stage.steps);
}

/** The total number of stages across every recipe of a definition. */
export function extractionStageCount(definition: ExtractionDefinition): number {
  return definition.recipes.reduce(
    (total, recipe) => total + extractionRecipeStageCount(recipe),
    0,
  );
}

/** The total number of steps across every recipe of a definition. */
export function extractionStepCount(definition: ExtractionDefinition): number {
  return definition.recipes.reduce((total, recipe) => total + extractionRecipeStepCount(recipe), 0);
}

/**
 * The distinct fact types a recipe's steps narrow to, in first-seen
 * (stage-then-step declared) order.
 */
export function extractionRecipeStepFactTypes(recipe: ExtractionRecipe): ExtractionFactType[] {
  const seen = new Set<ExtractionFactType>();
  const types: ExtractionFactType[] = [];
  for (const step of listExtractionRecipeSteps(recipe)) {
    for (const type of step.factTypes ?? []) {
      if (!seen.has(type)) {
        seen.add(type);
        types.push(type);
      }
    }
  }
  return types;
}

/** The distinct RC4.4 document types a definition's recipes read, in first-seen order. */
export function distinctExtractionDocumentTypes(
  definition: ExtractionDefinition,
): ProjectSourceDocumentType[] {
  const seen = new Set<ProjectSourceDocumentType>();
  const types: ProjectSourceDocumentType[] = [];
  for (const recipe of definition.recipes) {
    for (const type of recipe.documentTypes ?? []) {
      if (!seen.has(type)) {
        seen.add(type);
        types.push(type);
      }
    }
  }
  return types;
}

/** The distinct fact types across facts, in first-seen order. */
export function distinctExtractionFactTypes(
  facts: readonly ExtractionFact[],
): ExtractionFactType[] {
  const seen = new Set<ExtractionFactType>();
  const types: ExtractionFactType[] = [];
  for (const fact of facts) {
    if (!seen.has(fact.factType)) {
      seen.add(fact.factType);
      types.push(fact.factType);
    }
  }
  return types;
}

/** Every fact produced by one catalogued source, in input order. */
export function listExtractionFactsBySource(
  facts: readonly ExtractionFact[],
  sourceId: ProjectSourceId,
): ExtractionFact[] {
  return facts.filter((fact) => fact.sourceId === sourceId);
}

/** Every fact of one fact type, in input order. */
export function listExtractionFactsByType(
  facts: readonly ExtractionFact[],
  factType: ExtractionFactType,
): ExtractionFact[] {
  return facts.filter((fact) => fact.factType === factType);
}

/** Every fact belonging to one project, in input order. */
export function listExtractionFactsForProject(
  facts: readonly ExtractionFact[],
  projectId: string,
): ExtractionFact[] {
  return facts.filter((fact) => fact.projectId === projectId);
}

/** One subject and every reading recorded for it, possibly from many sources. */
export interface ExtractionFactGroup {
  /** The shared subject key, e.g. `proj_coralina:price:pricing.basePrice`. */
  subject: string;
  /** Every fact recorded for the subject, in input order. */
  facts: ExtractionFact[];
}

/**
 * Group facts by their subject key, in first-seen order.
 *
 * Pure and immutable: the input list is never mutated and each group keeps
 * its facts in input order. This is how one subject holds readings from
 * multiple sources — or repeated attempts — side by side, unresolved.
 */
export function groupExtractionFactsBySubject(
  facts: readonly ExtractionFact[],
): ExtractionFactGroup[] {
  const groups = new Map<string, ExtractionFactGroup>();
  const ordered: ExtractionFactGroup[] = [];
  for (const fact of facts) {
    const subject = extractionFactSubjectKey(fact);
    let group = groups.get(subject);
    if (group === undefined) {
      group = { subject, facts: [] };
      groups.set(subject, group);
      ordered.push(group);
    }
    group.facts.push(fact);
  }
  return ordered;
}

/**
 * Stable signature of the value a fact carries, used only to tell readings
 * apart. Byte-level: two structured values that differ in key order are
 * treated as different readings — RC4.5 compares, it never normalizes.
 */
function extractionFactValueSignature(fact: ExtractionFact): string {
  return JSON.stringify({
    rawValue: fact.rawValue,
    structuredValue: fact.structuredValue,
    unit: fact.unit,
  });
}

/**
 * The subjects that currently hold conflicting readings: groups whose
 * current, valued facts (superseded and unavailable readings are set aside
 * through the module's own status predicates) disagree on the value they
 * carry. Groups come back in first-seen order with their facts in input
 * order.
 *
 * A pure description of disagreement — RC4.5 never resolves a conflict,
 * prefers a source, or derives a winner; that stays a future runtime's
 * concern.
 */
export function listConflictingExtractionFactGroups(
  facts: readonly ExtractionFact[],
): ExtractionFactGroup[] {
  return groupExtractionFactsBySubject(facts).filter((group) => {
    const current = group.facts.filter(
      (fact) =>
        isCurrentExtractionFactStatus(fact.status) && extractionFactStatusCarriesValue(fact.status),
    );
    const signatures = new Set(current.map(extractionFactValueSignature));
    return signatures.size > 1;
  });
}

/**
 * Pure, locale-independent code-unit string comparison, so the module's
 * ordering never bends to the host's default locale or ICU data.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A copy of the facts in the module's one deterministic order: by canonical
 * fact-type rank, then subject key, then source id, then source revision
 * (through the reused numeric version comparison), then fact id.
 *
 * Stable and immutable: fully tied facts keep their input order and the input
 * list is never mutated. String tiers compare by code unit — no locale.
 */
export function sortExtractionFacts(facts: readonly ExtractionFact[]): ExtractionFact[] {
  return [...facts].sort(
    (a, b) =>
      compareExtractionFactType(a.factType, b.factType) ||
      compareStrings(extractionFactSubjectKey(a), extractionFactSubjectKey(b)) ||
      compareStrings(a.sourceId, b.sourceId) ||
      compareExtractionVersion(a.sourceVersion, b.sourceVersion) ||
      compareStrings(a.id, b.id),
  );
}

/**
 * A copy of the facts ordered oldest source revision first.
 *
 * Stable and immutable: equal revisions keep their input order and the input
 * list is never mutated. Reuses the RC4.4/RC3.3 version comparison — never a
 * local variant.
 */
export function sortExtractionFactsBySourceVersion(
  facts: readonly ExtractionFact[],
): ExtractionFact[] {
  return [...facts].sort((a, b) => compareExtractionVersion(a.sourceVersion, b.sourceVersion));
}
