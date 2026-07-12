/**
 * Forever Project Factory — deterministic build planning.
 *
 * This is the engine of RC4.3: {@link planFactoryBuild} takes a factory, a
 * verified project slug, and the facts the project's verified data provides,
 * and *describes* the package the factory would generate — the RC4.2
 * {@link ProjectPackage} descriptor, the {@link ProjectBundle} that measures it
 * against the template, and the rendered package root. It is a pure function:
 * no clock, no IO, no persistence, no scaffolding — identical inputs always
 * yield an identical result, so a planned build is safe to regenerate, diff,
 * and validate.
 *
 * Every consequential piece is reused, never restated: the package and its ids
 * come from the RC4.2 builders (which reuse the RC3.0 slug rule), the bundle
 * from the RC4.2 assembler, the verification from the RC4.2 validation
 * pipeline, and the result's state/outcome derivation from RC4.0. The plan's
 * counters follow one deterministic rule: a build that validates cleanly would
 * complete every step of its recipe; a build with blocking issues would fail
 * exactly the steps of its `verify` stages, because that is where the reused
 * validation pipeline runs.
 */

import {
  buildForeverProjectTemplate,
  buildProjectBundle,
  buildProjectPackage,
  renderProjectLayoutRoot,
  requiredProjectComponentKinds,
  validateProjectBundle,
  type ProjectBundle,
  type ProjectComponentKind,
  type ProjectPackage,
  type ProjectTemplate,
} from "@/features/forever-project-template";
import type { ISODateTime } from "@/features/forever-database";

import type { FactoryContext } from "./context";
import { factoryBuildIdForSlug, normalizeFactorySlug } from "./identity";
import {
  defaultFactoryRecipe,
  factoryRecipeStageCount,
  factoryRecipeStepCount,
  findFactoryRecipe,
} from "./helpers";
import type { FactoryHistoryEntry } from "./history";
import { createFactoryResult, emptyFactoryStats } from "./result";
import type { FactoryBuildMetadata, FactoryResult, FactoryStats } from "./result";
import { factoryError, factoryWarning, partitionFactoryIssues } from "./types";
import type {
  FactoryEntityKind,
  FactoryId,
  FactoryIssue,
  FactoryMetadata,
  FactoryScope,
  FactoryVersion,
} from "./types";

/**
 * The verified facts one planned build is described from.
 *
 * Only `slug` is required — everything else follows the template. Optional
 * facts are honoured only when supplied so an absent fact stays absent
 * (anti-fabrication): a request that omits `provides` describes a package
 * providing exactly what the template requires, and one that omits `entities`
 * falls back to the recipe's default coverage.
 */
export interface FactoryBuildRequest {
  /** The verified project slug the package is generated for. */
  slug: string;
  /** Display name; defaults to the normalized slug. */
  name?: string;
  /** What the generated package spans; defaults to `project`. */
  scope?: FactoryScope;
  /** The recipe to follow; defaults to the factory's first recipe. */
  recipeId?: string;
  /** The template to generate from; defaults to the canonical RC4.2 template. */
  template?: ProjectTemplate;
  /** Component kinds the package provides; defaults to the template's required kinds. */
  provides?: ProjectComponentKind[];
  /** Entity kinds the verified data covers; defaults to the recipe's default coverage. */
  entities?: FactoryEntityKind[];
  /** Package version; defaults to the RC4.2 default. */
  version?: FactoryVersion;
  metadata?: FactoryMetadata;
}

/** One planned build: the generated descriptors, never generated data. */
export interface FactoryBuild {
  /** Deterministic id of this planned build, e.g. `build_coralina`. */
  id: string;
  factoryId: FactoryId;
  /** The recipe the build follows. */
  recipeId: string;
  /** The RC4.2 template the package was generated from. */
  template: ProjectTemplate;
  /** The generated package descriptor. Built by the reused RC4.2 builder. */
  package: ProjectPackage;
  /** The generated package measured against its template. */
  bundle: ProjectBundle;
  /** The package root rendered for the project slug, e.g. `src/features/coralina-integration`. */
  root: string;
}

function factoryBuildMetadata(
  context: FactoryContext,
  counts: { stageCount: number; stepCount: number; entityCount: number },
  facts: { recipeId?: string; projectSlug?: string },
): FactoryBuildMetadata {
  const metadata: FactoryBuildMetadata = {
    factoryId: context.definition.identity.id,
    ...counts,
  };
  if (facts.recipeId !== undefined) metadata.recipeId = facts.recipeId;
  if (facts.projectSlug !== undefined) metadata.projectSlug = facts.projectSlug;
  if (context.now !== undefined) metadata.plannedAt = context.now;
  return metadata;
}

/**
 * Describe the build a factory would perform for one verified project.
 *
 * Pure and deterministic: resolves the recipe, describes the package through
 * the reused RC4.2 builders, measures it against the template, and judges it
 * through the reused RC4.2 validation pipeline. It mutates neither the context
 * nor the request, performs no IO, and never throws — an unresolvable recipe
 * or an incoherent described package is reported as issues on the result.
 */
export function planFactoryBuild(
  context: FactoryContext,
  request: FactoryBuildRequest,
): FactoryResult<FactoryBuild> {
  const definition = context.definition;
  const slug = normalizeFactorySlug(request.slug);

  const recipe =
    request.recipeId === undefined
      ? defaultFactoryRecipe(definition)
      : findFactoryRecipe(definition, request.recipeId);
  if (recipe === undefined) {
    const issue = factoryError(
      "unknown_recipe",
      request.recipeId === undefined
        ? "Factory declares no recipe to follow"
        : `Factory does not declare recipe "${request.recipeId}"`,
      "recipes",
    );
    return createFactoryResult({
      data: [],
      issues: [issue],
      stats: emptyFactoryStats(),
      metadata: factoryBuildMetadata(
        context,
        { stageCount: 0, stepCount: 0, entityCount: 0 },
        { projectSlug: slug },
      ),
    });
  }

  const template = request.template ?? buildForeverProjectTemplate();
  const issues: FactoryIssue[] = [];
  if (recipe.templateId !== template.identity.id) {
    issues.push(
      factoryWarning(
        "recipe_template_mismatch",
        `Recipe generates from template "${recipe.templateId}" but the build was given "${template.identity.id}"`,
        "template",
      ),
    );
  }

  // The generated package: identity, ids, and defaults all come from the reused
  // RC4.2 builder — RC4.3 adds no naming or defaulting rule of its own. The
  // defaulted lists are copied at this boundary so a result never aliases the
  // definition's or the request's arrays: mutating a plan can never reach back
  // into the long-lived factory.
  const pkg = buildProjectPackage(slug, {
    name: request.name,
    scope: request.scope,
    templateId: template.identity.id,
    version: request.version,
    provides: [...(request.provides ?? requiredProjectComponentKinds(template))],
    entities: [...(request.entities ?? recipe.entities ?? [])],
    metadata: request.metadata,
  });
  const bundle = buildProjectBundle(pkg, template);
  issues.push(...validateProjectBundle(bundle));

  const build: FactoryBuild = {
    id: factoryBuildIdForSlug(slug),
    factoryId: definition.identity.id,
    recipeId: recipe.id,
    template,
    package: pkg,
    bundle,
    root: renderProjectLayoutRoot(bundle.layout, pkg.identity.slug),
  };

  // One deterministic completion rule: a clean plan completes every step; a
  // blocked plan fails exactly the steps of its verify stages, where the reused
  // RC4.2 validation pipeline runs.
  const stageCount = factoryRecipeStageCount(recipe);
  const stepCount = factoryRecipeStepCount(recipe);
  const verifyStepCount = recipe.stages
    .filter((stage) => stage.kind === "verify")
    .reduce((total, stage) => total + stage.steps.length, 0);
  const blocked = partitionFactoryIssues(issues).errors.length > 0;
  const stats: FactoryStats = {
    ...emptyFactoryStats(),
    stages: stageCount,
    steps: stepCount,
    completed: blocked ? stepCount - verifyStepCount : stepCount,
    failed: blocked ? verifyStepCount : 0,
  };

  return createFactoryResult({
    data: [build],
    issues,
    stats,
    metadata: factoryBuildMetadata(
      context,
      { stageCount, stepCount, entityCount: pkg.entities.length },
      { recipeId: recipe.id, projectSlug: slug },
    ),
  });
}

/** Options accepted by {@link factoryBuildHistoryEntry}. */
export interface FactoryBuildHistoryOptions {
  /** When the planned build started, supplied by the caller. */
  startedAt?: ISODateTime;
  /** When the planned build finished, supplied by the caller. */
  finishedAt?: ISODateTime;
}

/**
 * Derive the {@link FactoryHistoryEntry} a planned build settles into.
 *
 * Pure glue between {@link planFactoryBuild} and the history model: it copies
 * the result's settled state, outcome, and counters, and attaches the build and
 * recipe ids (and caller-supplied timestamps) only when present, so an absent
 * fact stays absent.
 */
export function factoryBuildHistoryEntry(
  result: FactoryResult<FactoryBuild>,
  options: FactoryBuildHistoryOptions = {},
): FactoryHistoryEntry {
  const entry: FactoryHistoryEntry = {
    factoryId: result.metadata.factoryId,
    state: result.state,
    outcome: result.outcome,
    stats: result.stats,
  };
  const build = result.data.length > 0 ? result.data[0] : undefined;
  if (build !== undefined) entry.buildId = build.id;
  if (result.metadata.recipeId !== undefined) entry.recipeId = result.metadata.recipeId;
  if (options.startedAt !== undefined) entry.startedAt = options.startedAt;
  if (options.finishedAt !== undefined) entry.finishedAt = options.finishedAt;
  return entry;
}
