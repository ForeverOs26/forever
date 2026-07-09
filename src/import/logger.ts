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
  status?: "blocked" | "dry_run_completed" | "completed";
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

export function logSummary(summary: ImportSummary) {
  console.log("");
  console.log("Import summary");
  console.log(`Project: ${summary.projectSlug}`);
  if (summary.status) console.log(`Status: ${summary.status}`);
  if (typeof summary.ready === "boolean") console.log(`Ready: ${summary.ready}`);
  if (typeof summary.operations === "number") console.log(`Operations: ${summary.operations}`);
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
