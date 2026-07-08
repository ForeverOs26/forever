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
  console.log(`Buildings: ${summary.buildings}`);
  console.log(`Units: ${summary.units}`);
  console.log(`Prices: ${summary.prices}`);
  console.log(`Skipped: ${summary.skipped}`);
}
