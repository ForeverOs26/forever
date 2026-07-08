import { createDatabaseLayer, type DatabaseLayer } from "./database";
import { loadExtractedDatasets } from "./datasets";
import { loadManifest } from "./manifest";
import { logStep, logSummary, logWarning, type ImportSummary } from "./logger";
import { validateImportPlanRelationships } from "./plan-validator";
import { createImportPlan } from "./planner";
import { createRollbackPlan, rollbackImport } from "./rollback";
import { transitionImportState } from "./state-machine";
import type { ImportExecutionContext, ImportPlan } from "./types";
import { validateProjectImport } from "./validator";

export interface ImportProjectOptions {
  projectSlug: string;
  projectsRoot?: string;
  database?: DatabaseLayer;
  dryRun?: boolean;
}

function logDryRunPlan(plan: ImportPlan) {
  logStep("Developer", String(plan.developer.name));
  logStep("Location", String(plan.location.area_name));
  logStep("Project", String(plan.project.slug));
  logStep("Buildings", String(plan.buildings.length));
  logStep("Units", String(plan.units.length));
  logStep("Prices", String(plan.priceHistoryRows.length));
  logWarning("Dry run only. No Supabase client was created and no database writes were performed.");
}

export async function importProject(options: ImportProjectOptions): Promise<ImportSummary> {
  const projectsRoot = options.projectsRoot ?? "forever-data/projects";
  const mode = options.dryRun ? "dry-run" : "execute";
  const context: ImportExecutionContext = {
    state: "initialized",
    mode,
    projectSlug: options.projectSlug,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    errors: [],
  };

  const manifest = await loadManifest(options.projectSlug, projectsRoot);
  context.state = transitionImportState(context.state, "manifest_loaded");
  logStep("Manifest", manifest.project_slug);

  const validation = await validateProjectImport(manifest, projectsRoot);
  if (!validation.ready) {
    const details = validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
    throw new Error(`Project is not ready for import.\n${details}`);
  }
  context.state = transitionImportState(context.state, "package_validated");
  logStep("Validation");

  const datasets = await loadExtractedDatasets(manifest.project_slug, projectsRoot);
  context.state = transitionImportState(context.state, "datasets_loaded");

  const plan = createImportPlan(manifest, validation, datasets, mode);
  plan.rollback = createRollbackPlan(plan);
  context.state = transitionImportState(context.state, "plan_created");

  const relationshipIssues = validateImportPlanRelationships(plan);
  if (relationshipIssues.some((issue) => issue.severity === "error")) {
    const details = relationshipIssues.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
    throw new Error(`Import plan failed relationship validation.\n${details}`);
  }
  context.state = transitionImportState(context.state, "relationships_validated");

  if (options.dryRun) {
    logDryRunPlan(plan);

    const summary = {
      projectSlug: manifest.project_slug,
      buildings: plan.buildings.length,
      units: plan.units.length,
      prices: plan.priceHistoryRows.length,
      skipped: plan.units.length - plan.priceHistoryRows.length,
    };

    context.state = transitionImportState(context.state, "dry_run_completed");
    context.state = transitionImportState(context.state, "completed");
    logStep("Finished", "dry run");
    logSummary(summary);
    return summary;
  }

  const database = options.database ?? createDatabaseLayer();
  context.state = transitionImportState(context.state, "executing");

  try {
    const developer = await database.upsertDeveloper(manifest);
    logStep("Developer", developer.name);

    const location = await database.upsertLocation(manifest);
    logStep("Location", location.area_name ?? manifest.location);

    const project = await database.upsertProject(manifest, developer, location, plan.projectFacts);
    logStep("Project", project.slug);

    const buildingIds = await database.upsertBuildings(project, plan.buildings);
    logStep("Buildings", String(buildingIds.size));

    const unitIds = await database.upsertUnits(project, buildingIds, plan.units);
    logStep("Units", String(unitIds.size));

    const priceCount = await database.upsertPriceHistory(unitIds, plan.units);
    logStep("Prices", String(priceCount));

    const skipped = plan.units.length - unitIds.size;
    if (skipped > 0) logWarning(`${skipped} unit rows were skipped.`);

    const summary = {
      projectSlug: manifest.project_slug,
      developerId: developer.id,
      locationId: location.id,
      projectId: project.id,
      buildings: buildingIds.size,
      units: unitIds.size,
      prices: priceCount,
      skipped,
    };

    context.state = transitionImportState(context.state, "completed");
    logStep("Finished");
    logSummary(summary);
    return summary;
  } catch (error) {
    context.state = transitionImportState(context.state, "rolling_back");
    const rollback = await rollbackImport(database, plan.rollback);
    context.state = transitionImportState(context.state, "failed");
    logWarning(`Rollback prepared but not executed automatically: ${rollback.reason}`);
    throw error;
  }
}
