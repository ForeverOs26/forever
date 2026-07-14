import { loadExtractedDatasets } from "./datasets";
import { loadManifest } from "./manifest";
import { logStep, logSummary, logWarning, type ImportSummary } from "./logger";
import { validateImportPlanRelationships } from "./plan-validator";
import { createImportPlan } from "./planner";
import { createRollbackPlan } from "./rollback";
import {
  createDryRunReceipt,
  fingerprintImportPlan,
  type ImportOperationCounts,
} from "./plan-hash";
import { runImportPreflight } from "./target-guard";
import type { ImportTargetIdentity } from "./import-targets";
import { transitionImportState } from "./state-machine";
import type { ImportExecutionContext, ImportPlan } from "./types";
import { validateProjectImport } from "./validator";
import type { ValidationIssue } from "./validator";

export interface ImportProjectOptions {
  projectSlug: string;
  projectsRoot?: string;
  dryRun?: boolean;
  target?: string;
  expectedPlanHash?: string;
  confirmation?: string;
  expectedOperationCounts?: ImportOperationCounts;
  targetIdentity?: ImportTargetIdentity;
}

function logDryRunPlan(plan: ImportPlan) {
  logStep("Project", String(plan.project.slug));
  logStep(
    "Validation",
    `Project + Buildings + Units + Price History operations: ${plan.operations.length}`,
  );
  logStep("Buildings", String(plan.buildings.length));
  logStep("Units", String(plan.units.length));
  logStep("Prices", String(plan.priceHistoryRows.length));
  logWarning("Dry run only. No Supabase client was created and no database writes were performed.");
}

function logValidationWarnings(issues: ValidationIssue[]) {
  const warnings = issues.filter((issue) => issue.severity === "warning");
  if (!warnings.length) return;

  const warningCounts = new Map<string, number>();
  for (const warning of warnings) {
    warningCounts.set(warning.code, (warningCounts.get(warning.code) ?? 0) + 1);
  }

  for (const [code, count] of warningCounts.entries()) {
    logWarning(`Plan validation warning ${code}: ${count} row${count === 1 ? "" : "s"}.`);
  }
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

  const datasets = await loadExtractedDatasets(manifest.project_slug, projectsRoot);
  context.state = transitionImportState(context.state, "datasets_loaded");

  const validation = await validateProjectImport(manifest, projectsRoot);
  if (!validation.ready) {
    context.state = transitionImportState(context.state, "blocked");
    const summary = {
      projectSlug: manifest.project_slug,
      status: "blocked" as const,
      ready: false,
      validationIssues: validation.issues.map(({ severity, code, message }) => ({
        severity,
        code,
        message,
      })),
      operations: 0,
      buildings: 0,
      units: 0,
      prices: 0,
      skipped: 0,
    };

    logWarning(
      "Project is not ready for import. No import plan was created and no database writes were performed.",
    );
    logSummary(summary);
    context.state = transitionImportState(context.state, "completed");
    return summary;
  }
  context.state = transitionImportState(context.state, "package_validated");
  logStep("Validation");

  const plan = createImportPlan(manifest, validation, datasets, mode);
  plan.rollback = createRollbackPlan(plan);
  context.state = transitionImportState(context.state, "plan_created");

  const relationshipIssues = validateImportPlanRelationships(plan);
  if (relationshipIssues.some((issue) => issue.severity === "error")) {
    const details = relationshipIssues.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
    throw new Error(`Import plan failed relationship validation.\n${details}`);
  }
  logValidationWarnings(relationshipIssues);
  context.state = transitionImportState(context.state, "relationships_validated");
  const planFingerprint = fingerprintImportPlan(plan);

  if (options.dryRun) {
    logDryRunPlan(plan);
    const receipt = createDryRunReceipt(planFingerprint);

    const summary = {
      projectSlug: manifest.project_slug,
      status: "dry_run_completed" as const,
      ready: true,
      operations: plan.operations.length,
      buildings: plan.buildings.length,
      units: plan.units.length,
      prices: plan.priceHistoryRows.length,
      skipped: plan.units.length - plan.priceHistoryRows.length,
      planFingerprint,
      receipt,
    };

    context.state = transitionImportState(context.state, "dry_run_completed");
    context.state = transitionImportState(context.state, "completed");
    logStep("Finished", "dry run");
    logSummary(summary);
    return summary;
  }

  const preflight = runImportPreflight({
    requestedTarget: options.target,
    requestedProjectSlug: options.projectSlug,
    actualPlanFingerprint: planFingerprint,
    expectedFullPlanHash: options.expectedPlanHash ?? "",
    expectedOperationCounts: options.expectedOperationCounts ?? planFingerprint.operationCounts,
    manifestSourceVersion: manifest.source_version,
    confirmation: options.confirmation ?? "",
    targetIdentity: options.targetIdentity,
  });
  if (!preflight.ok) {
    throw new Error(`Import preflight failed [${preflight.code}]: ${preflight.reason}`);
  }

  throw new Error(
    "Project + Buildings + Units + Price History execute mode is not enabled yet. Run dry-run only until this database write path is explicitly approved.",
  );
}
