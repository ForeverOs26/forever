export type ImportStep =
  | "Manifest"
  | "Validation"
  | "Developer"
  | "Location"
  | "Project"
  | "Buildings"
  | "Units"
  | "Prices"
  | "Finished";

export interface ImportSummary {
  projectSlug: string;
  status?:
    | "blocked"
    | "dry_run_completed"
    | "collision_inspected"
    | "collision_blocked"
    | "execution_committed"
    | "execution_rolled_back"
    | "execution_rejected"
    | "execution_failed"
    | "completed";
  ready?: boolean;
  validationIssues?: Array<{
    severity: string;
    code: string;
    message: string;
  }>;
  operations?: number;
  developerId?: string;
  locationId?: string;
  projectId?: string;
  buildings: number;
  units: number;
  prices: number;
  skipped: number;
  planFingerprint?: import("./plan-hash").PlanFingerprint;
  receipt?: import("./plan-hash").DryRunReceipt;
  collisionReport?: import("./collision-inspector").CollisionInspectionReport;
  executionReceipt?: import("./transaction-executor").ImportExecutionReceipt;
}

export function logStep(step: ImportStep, detail?: string) {
  console.log(`✔ ${step}${detail ? ` - ${detail}` : ""}`);
}

export function logWarning(message: string) {
  console.warn(`! ${message}`);
}

export function logFailure(message: string) {
  console.error(`✖ ${message}`);
}

export function logCollisionReport(
  report: import("./collision-inspector").CollisionInspectionReport,
) {
  console.log("");
  console.log("Collision inspection report");
  console.log(`Project: ${report.projectSlug}`);
  console.log(`Target: ${report.approvedTarget} (${report.targetIdentity.projectId})`);
  console.log(`Plan SHA-256: ${report.planHash}`);
  console.log(`Plan short hash: ${report.shortPlanHash}`);
  console.log(`Source version: ${report.sourceVersion}`);
  console.log(`Inspected operations: ${report.totalInspectedOperations}`);
  for (const classification of Object.keys(report.countsByClassification).sort()) {
    const count =
      report.countsByClassification[classification as keyof typeof report.countsByClassification];
    if (count > 0) console.log(`  ${classification}: ${count}`);
  }
  console.log(`Read-only confirmed: ${report.readOnlyConfirmed}`);
  console.log(`Execute enabled: ${report.executeEnabled}`);
  console.log(`Writes performed: ${report.writesPerformed}`);
  console.log(`Status: ${report.status}`);

  if (report.blockingFindings.length) {
    console.log("");
    console.log("Blocking findings");
    for (const item of report.blockingFindings) {
      console.log(`${item.classification}: ${item.entity} ${item.naturalKey} - ${item.detail}`);
    }
  }
}

export function logExecutionReceipt(
  receipt: import("./transaction-executor").ImportExecutionReceipt,
) {
  console.log("");
  console.log("Execution receipt");
  console.log(`Project: ${receipt.projectSlug}`);
  console.log(`Target: ${receipt.target} (${receipt.targetIdentity.projectId})`);
  console.log(`Plan SHA-256: ${receipt.planHash}`);
  if (receipt.collisionReportFingerprint) {
    console.log(`Collision report fingerprint: ${receipt.collisionReportFingerprint}`);
  }
  if (receipt.approvalDigest) console.log(`Approval digest: ${receipt.approvalDigest}`);
  console.log(`Approval consumed: ${receipt.approvalConsumed}`);
  console.log(`Outcome: ${receipt.outcome}`);
  console.log(`Commit confirmed: ${receipt.commitConfirmed}`);
  console.log(`Rollback confirmed: ${receipt.rollbackConfirmed}`);
  console.log(`Operations attempted: ${receipt.totalOperationsAttempted}`);
  console.log(`Operations applied: ${receipt.totalOperationsApplied}`);
  console.log(`Execute enabled: ${receipt.executeEnabled}`);
  console.log(`Writes performed: ${receipt.writesPerformed ?? "unconfirmed"}`);
  if (receipt.reasonCodes.length) console.log(`Reasons: ${receipt.reasonCodes.join(",")}`);
}

export function logSummary(summary: ImportSummary) {
  console.log("");
  console.log("Import summary");
  console.log(`Project: ${summary.projectSlug}`);
  if (summary.status) console.log(`Status: ${summary.status}`);
  if (typeof summary.ready === "boolean") console.log(`Ready: ${summary.ready}`);
  if (typeof summary.operations === "number") console.log(`Operations: ${summary.operations}`);
  if (summary.planFingerprint) {
    console.log(`Plan SHA-256: ${summary.planFingerprint.hash}`);
    console.log(`Plan short hash: ${summary.planFingerprint.shortHash}`);
  }
  if (summary.receipt) {
    console.log(`Future confirmation: ${summary.receipt.confirmation}`);
    console.log(`Execute enabled: ${summary.receipt.executeEnabled}`);
  }
  console.log(`Buildings: ${summary.buildings}`);
  console.log(`Units: ${summary.units}`);
  console.log(`Prices: ${summary.prices}`);
  console.log(`Skipped: ${summary.skipped}`);

  if (summary.validationIssues?.length) {
    console.log("");
    console.log("Validation issues");
    for (const issue of summary.validationIssues) {
      console.log(`${issue.severity}: ${issue.code} - ${issue.message}`);
    }
  }
}
