/**
 * Forever Extraction Pipeline — deterministic extraction planning.
 *
 * This is the engine of RC4.5: {@link planExtraction} takes a definition, a
 * validated RC4.4 source descriptor, and a request, and *describes* the
 * extraction a runtime would attempt — which recipe it would follow, against
 * which catalogued source and exact received revision, targeting which fact
 * types, in the module's one deterministic order. It is a pure function: no
 * clock, no randomness, no environment read, no hidden state, no IO —
 * identical context, source, recipe, and request always yield an identical
 * plan, so a plan is safe to regenerate, diff, and validate.
 *
 * A plan carries *targets*, never values: RC4.5 cannot know what a source
 * says without reading it, so nothing resembling a fact value appears here
 * (anti-fabrication). Every consequential piece is reused, never restated:
 * the source and its revision are judged through the reused RC4.4 validation
 * pipeline, the plan id follows the module's own version-addressed naming
 * rule, and the result's state/outcome derivation is the RC4.0 one. The
 * plan's counters follow one deterministic rule: a plan that validates
 * cleanly would complete every step of its recipe; a blocked plan would fail
 * exactly the steps of its `verify` stages, because that is where the
 * validation pipeline runs.
 */

import type { ISODateTime } from "@/features/forever-database";
import type { ProjectSourceDefinition, ProjectSourceId } from "@/features/forever-project-sources";
import {
  projectSourceDocumentKey,
  validateProjectSourceDefinition,
} from "@/features/forever-project-sources";

import type { ExtractionContext } from "./context";
import type { ExtractionFactType } from "./facttype";
import { compareExtractionFactType, isKnownExtractionFactType } from "./facttype";
import {
  defaultExtractionRecipe,
  findExtractionRecipe,
  isAbsent,
  isNonEmptyString,
} from "./helpers";
import type { ExtractionHistoryEntry } from "./history";
import { extractionPlanIdFor } from "./identity";
import type { ExtractionMethodDescriptor } from "./method";
import { createExtractionResult, emptyExtractionStats } from "./result";
import type { ExtractionResult, ExtractionRunMetadata, ExtractionStats } from "./result";
import { extractionError, extractionWarning, partitionExtractionIssues } from "./types";
import type { ExtractionId, ExtractionIssue } from "./types";
import type { ExtractionSourceVersion } from "./version";

/**
 * The request one planned extraction is described from.
 *
 * Only `source` is required — the RC4.4 descriptor of the catalogued document
 * to read, reused directly rather than re-described. Optional facts are
 * honoured only when supplied so an absent fact stays absent
 * (anti-fabrication): a request that omits `factTypes` targets exactly what
 * the recipe declares, and one that omits `recipeId` follows the definition's
 * default recipe.
 */
export interface ExtractionRequest {
  /** The RC4.4 catalogued source the extraction would read. Reused directly. */
  source: ProjectSourceDefinition;
  /** The recipe to follow; defaults to the definition's first recipe. */
  recipeId?: string;
  /** Fact types to target; defaults to everything the recipe declares. */
  factTypes?: ExtractionFactType[];
}

/** One planned extraction: targets and provenance, never fact values. */
export interface ExtractionPlan {
  /** Deterministic id, e.g. `xplan_proj-coralina-price-list-v1-0-0`. */
  id: string;
  definitionId: ExtractionId;
  /** The recipe the plan follows. */
  recipeId: string;
  /** The project the catalogued source belongs to. */
  projectId: string;
  /** The RC4.4 catalogued source the plan reads. */
  sourceId: ProjectSourceId;
  /** The exact received revision the plan reads — source-version-aware. */
  sourceVersion: ExtractionSourceVersion;
  /** The RC4.4 `projectId:slug` document key of the source. Reused rule. */
  documentKey: string;
  /** The method the recipe designates, when it designates one. */
  method?: ExtractionMethodDescriptor;
  /**
   * The fact types the attempt would target, deduplicated and in the
   * canonical fact-type order — the module's one deterministic ordering.
   */
  targets: ExtractionFactType[];
}

function extractionRunMetadata(
  context: ExtractionContext,
  counts: { stageCount: number; stepCount: number; targetCount: number },
  facts: {
    recipeId?: string;
    sourceId?: ProjectSourceId;
    projectId?: string;
    sourceVersion?: ExtractionSourceVersion;
  },
): ExtractionRunMetadata {
  const metadata: ExtractionRunMetadata = {
    definitionId: context.definition.identity.id,
    ...counts,
  };
  if (facts.recipeId !== undefined) metadata.recipeId = facts.recipeId;
  if (facts.sourceId !== undefined) metadata.sourceId = facts.sourceId;
  if (facts.projectId !== undefined) metadata.projectId = facts.projectId;
  if (facts.sourceVersion !== undefined) {
    metadata.sourceVersion = structuredClone(facts.sourceVersion);
  }
  if (context.now !== undefined) metadata.plannedAt = context.now;
  return metadata;
}

/**
 * Describe the extraction a definition would attempt over one catalogued
 * source.
 *
 * Pure and deterministic: resolves the recipe, judges the source through the
 * reused RC4.4 validation pipeline, checks the recipe actually reads the
 * source's document type and file format, and resolves the targets in the
 * canonical fact-type order. It mutates neither the context nor the request,
 * performs no IO, and never throws — an absent definition, an unresolvable
 * recipe, an incoherent source, a malformed request, or an empty target list
 * is reported as issues on the result. The returned plan is deep-copied, so
 * it never aliases the definition's or the request's values.
 */
export function planExtraction(
  context: ExtractionContext,
  request: ExtractionRequest,
): ExtractionResult<ExtractionPlan> {
  const definition = context?.definition;
  if (isAbsent(definition) || isAbsent(definition.identity)) {
    const issue = extractionError(
      "missing_plan_definition",
      "Extraction context names no coherent definition to plan from",
      "definition",
    );
    return createExtractionResult({
      data: [],
      issues: [issue],
      stats: emptyExtractionStats(),
      metadata: {
        definitionId: String(definition?.identity?.id ?? ""),
        stageCount: 0,
        stepCount: 0,
        targetCount: 0,
        ...(context?.now !== undefined ? { plannedAt: context.now } : {}),
      },
    });
  }

  const recipe = !Array.isArray(definition.recipes)
    ? undefined
    : request.recipeId === undefined
      ? defaultExtractionRecipe(definition)
      : findExtractionRecipe(definition, request.recipeId);
  if (isAbsent(recipe)) {
    const issue = extractionError(
      "unknown_recipe",
      request.recipeId === undefined
        ? "Extraction definition declares no recipe to follow"
        : `Extraction definition does not declare recipe "${request.recipeId}"`,
      "recipes",
    );
    return createExtractionResult({
      data: [],
      issues: [issue],
      stats: emptyExtractionStats(),
      metadata: extractionRunMetadata(context, { stageCount: 0, stepCount: 0, targetCount: 0 }, {}),
    });
  }

  // Counted defensively so a malformed recipe is reported, never dereferenced.
  const stages = Array.isArray(recipe.stages) ? recipe.stages : [];
  const stageCount = stages.length;
  const stepCount = stages.reduce(
    (total, stage) => total + (Array.isArray(stage?.steps) ? stage.steps.length : 0),
    0,
  );

  // A plan is only constructible from a source whose identity and revision
  // are usable: the id, slug, project id, and numeric version parts feed the
  // deterministic plan id, so an unusable source is reported, never rendered
  // into a degenerate id.
  const source = request.source;
  const identity = source?.identity;
  const version = source?.version;
  const usableSource =
    !isAbsent(source) &&
    !isAbsent(identity) &&
    isNonEmptyString(identity.id) &&
    isNonEmptyString(identity.slug) &&
    isNonEmptyString(identity.projectId) &&
    !isAbsent(version) &&
    typeof version.major === "number" &&
    typeof version.minor === "number" &&
    typeof version.patch === "number";
  if (!usableSource) {
    const issue = extractionError(
      "missing_plan_source",
      "Extraction request names no coherent catalogued source to read",
      "source",
    );
    return createExtractionResult({
      data: [],
      issues: [issue],
      stats: emptyExtractionStats(),
      metadata: extractionRunMetadata(
        context,
        { stageCount, stepCount, targetCount: 0 },
        { recipeId: recipe.id },
      ),
    });
  }

  // The source is judged through the reused RC4.4 validation pipeline — RC4.5
  // adds no source rule of its own, so a source that would not validate in
  // its own registry blocks a plan here by exactly the same judgement. The
  // reused issues locate themselves inside the source, so their paths are
  // re-rooted under `source.` to match the planner's own convention.
  const issues: ExtractionIssue[] = validateProjectSourceDefinition(source).map((issue) => ({
    ...issue,
    path: issue.path === undefined ? "source" : `source.${issue.path}`,
  }));

  if (
    Array.isArray(recipe.documentTypes) &&
    !recipe.documentTypes.includes(source.descriptor?.documentType as never)
  ) {
    issues.push(
      extractionWarning(
        "recipe_document_type_mismatch",
        `Recipe "${recipe.id}" does not declare document type "${String(
          source.descriptor?.documentType,
        )}"`,
        "source.descriptor.documentType",
      ),
    );
  }
  if (
    Array.isArray(recipe.fileFormats) &&
    !recipe.fileFormats.includes(source.descriptor?.fileFormat as never)
  ) {
    issues.push(
      extractionWarning(
        "recipe_file_format_mismatch",
        `Recipe "${recipe.id}" does not declare file format "${String(
          source.descriptor?.fileFormat,
        )}"`,
        "source.descriptor.fileFormat",
      ),
    );
  }

  // Resolve the targets: everything requested (or everything the recipe
  // declares), kept only where the recipe declares it, deduplicated, and put
  // in the canonical fact-type order so equal input always yields the same
  // plan regardless of request order.
  const declared = Array.isArray(recipe.factTypes) ? recipe.factTypes : [];
  if (request.factTypes !== undefined && !Array.isArray(request.factTypes)) {
    issues.push(
      extractionError(
        "invalid_fact_types",
        "Extraction request declares a non-list factTypes value",
        "factTypes",
      ),
    );
  }
  const requested = Array.isArray(request.factTypes) ? request.factTypes : declared;
  const targets: ExtractionFactType[] = [];
  const seen = new Set<ExtractionFactType>();
  requested.forEach((factType, index) => {
    if (!isKnownExtractionFactType(factType)) {
      issues.push(
        extractionError(
          "unsupported_fact_type",
          `Extraction request targets an unsupported fact type "${String(factType)}"`,
          `factTypes.${index}`,
        ),
      );
      return;
    }
    if (!declared.includes(factType)) {
      issues.push(
        extractionWarning(
          "undeclared_fact_type",
          `Recipe "${recipe.id}" does not declare fact type "${factType}"`,
          `factTypes.${index}`,
        ),
      );
      return;
    }
    if (!seen.has(factType)) {
      seen.add(factType);
      targets.push(factType);
    }
  });
  targets.sort(compareExtractionFactType);
  if (targets.length === 0) {
    issues.push(
      extractionError(
        "no_extraction_targets",
        "Planned extraction would target no fact type at all",
        "factTypes",
      ),
    );
  }

  // The plan is deep-copied at this boundary so a result never aliases the
  // definition's or the request's values: mutating a plan can never reach
  // back into the long-lived definition or the caller's source descriptor.
  const plan: ExtractionPlan = structuredClone({
    id: extractionPlanIdFor(source.identity.projectId, source.identity.slug, source.version),
    definitionId: definition.identity.id,
    recipeId: recipe.id,
    projectId: source.identity.projectId,
    sourceId: source.identity.id,
    sourceVersion: source.version,
    documentKey: projectSourceDocumentKey(source.identity),
    ...(recipe.method !== undefined ? { method: recipe.method } : {}),
    targets,
  });

  // One deterministic completion rule: a clean plan completes every step; a
  // blocked plan fails exactly the steps of its verify stages, where the
  // validation pipeline runs.
  const verifyStepCount = stages
    .filter((stage) => stage?.kind === "verify")
    .reduce((total, stage) => total + (Array.isArray(stage.steps) ? stage.steps.length : 0), 0);
  const blocked = partitionExtractionIssues(issues).errors.length > 0;
  const stats: ExtractionStats = {
    ...emptyExtractionStats(),
    stages: stageCount,
    steps: stepCount,
    completed: blocked ? stepCount - verifyStepCount : stepCount,
    failed: blocked ? verifyStepCount : 0,
  };

  return createExtractionResult({
    data: [plan],
    issues,
    stats,
    metadata: extractionRunMetadata(
      context,
      { stageCount, stepCount, targetCount: plan.targets.length },
      {
        recipeId: recipe.id,
        sourceId: plan.sourceId,
        projectId: plan.projectId,
        sourceVersion: source.version,
      },
    ),
  });
}

/** Options accepted by {@link extractionPlanHistoryEntry}. */
export interface ExtractionPlanHistoryOptions {
  /** When the planned extraction started, supplied by the caller. */
  startedAt?: ISODateTime;
  /** When the planned extraction finished, supplied by the caller. */
  finishedAt?: ISODateTime;
}

/**
 * Derive the {@link ExtractionHistoryEntry} a planned extraction settles
 * into.
 *
 * Pure glue between {@link planExtraction} and the history model: it copies
 * the result's settled state, outcome, and counters, and attaches the plan,
 * recipe, source, and revision references (and caller-supplied timestamps)
 * only when present, so an absent fact stays absent.
 */
export function extractionPlanHistoryEntry(
  result: ExtractionResult<ExtractionPlan>,
  options: ExtractionPlanHistoryOptions = {},
): ExtractionHistoryEntry {
  const entry: ExtractionHistoryEntry = {
    definitionId: result.metadata.definitionId,
    state: result.state,
    outcome: result.outcome,
    // Copied, never aliased: mutating a history entry's counters must not
    // reach back into the result it was derived from.
    stats: { ...result.stats },
  };
  const plan = result.data.length > 0 ? result.data[0] : undefined;
  if (plan !== undefined) entry.planId = plan.id;
  if (result.metadata.recipeId !== undefined) entry.recipeId = result.metadata.recipeId;
  if (result.metadata.sourceId !== undefined) entry.sourceId = result.metadata.sourceId;
  if (result.metadata.sourceVersion !== undefined) {
    entry.sourceVersion = structuredClone(result.metadata.sourceVersion);
  }
  if (options.startedAt !== undefined) entry.startedAt = options.startedAt;
  if (options.finishedAt !== undefined) entry.finishedAt = options.finishedAt;
  return entry;
}
