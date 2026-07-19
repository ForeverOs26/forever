/**
 * Fast Intake v1 — owner-only local CLI entry point.
 *
 * Never part of the web bundle; no browser, no Supabase credentials, no
 * database client, no network, no production write (only local generated
 * artifacts are written), no publication.
 *
 * Windows PowerShell and cmd.exe (single line; `npm.cmd` because `npm.ps1`
 * may be blocked by a normal execution policy):
 *
 *   npm.cmd run intake -- --project marina-bay --name "Marina Bay" --source "C:\forever-incoming\Marina Bay"
 *
 * Bash / Linux / macOS:
 *
 *   npm run intake -- --project marina-bay --name "Marina Bay" --source "/path/to/source"
 *
 * Repeat --source for multiple folders and/or .zip archives.
 */

import { parseIntakeInvocation } from "./cli-args";
import { importCommand, runIntake, type RunIntakeResult } from "./run";
import type { IntakeCategory } from "./types";

function printUsage(): void {
  console.log("Usage:");
  console.log(
    '  Windows (PowerShell or cmd.exe):  npm.cmd run intake -- --project <slug> --name "<name>" --source "<folder-or-zip>" [--source "<another>"]',
  );
  console.log(
    '  Bash/Linux/macOS:                 npm run intake -- --project <slug> --name "<name>" --source "<folder-or-zip>" [--source "<another>"]',
  );
  console.log("");
  console.log("Options:");
  console.log("  --project <slug>        Lowercase project slug (required).");
  console.log('  --name "<name>"         Project name (required).');
  console.log("  --source <path>         Source folder or .zip; repeat for multiple (required).");
  console.log("  --out-root <dir>        Output root (default forever-data/projects).");
  console.log(
    "  --workspace <dir>       Gitignored extraction workspace (default .intake-workspace).",
  );
  console.log("  --target-seconds <n>    15-minute target override (default 900).");
  console.log("  --verbose               List every classified file and warning.");
}

function printSummary(result: RunIntakeResult, verbose: boolean): void {
  const s = result.summary;
  const line = "─".repeat(60);
  console.log(line);
  console.log(`Fast Intake v1 — ${s.status}`);
  console.log(line);
  console.log(`Project        : ${s.project_name} (${s.project_slug})`);
  console.log(
    `Elapsed        : ${s.elapsed_seconds}s (target ${s.target_seconds}s, met=${s.target_met})`,
  );
  console.log(`Source files   : ${s.source_file_count} (duplicates: ${s.duplicate_count})`);

  const classified = (Object.entries(s.classified_counts) as Array<[IntakeCategory, number]>)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${category}=${count}`)
    .join(", ");
  console.log(`Classified     : ${classified || "(none)"}`);
  console.log(
    `Planned graph  : projects=${s.planned_graph_counts.projects} buildings=${s.planned_graph_counts.buildings} ` +
      `units=${s.planned_graph_counts.units} prices=${s.planned_graph_counts.prices} ` +
      `media=${s.planned_graph_counts.media} warnings=${s.planned_graph_counts.warnings} ` +
      `batches=${s.planned_graph_counts.batches}`,
  );

  if (result.status === "BLOCKED") {
    console.log(`Validation     : FAILED — ${s.validation.error}`);
    for (const issue of s.blocking_issues) console.log(`  blocked: ${issue}`);
  } else {
    console.log(`Validation     : OK (${s.validation.marker})`);
    console.log(
      `Fingerprint    : ${s.validation.fingerprint} (verified=${s.validation.fingerprint_verified})`,
    );
  }

  console.log(
    `Warnings       : ${s.warnings.length} intake note(s), ${s.planned_graph_counts.warnings} payload warning(s)`,
  );
  if (verbose) {
    for (const warning of s.warnings) {
      console.log(`  [${warning.severity}] ${warning.code}: ${warning.message}`);
    }
  }
  if (s.unsupported_files.length > 0) {
    console.log(
      `Unsupported    : ${s.unsupported_files.length} unknown file(s)${verbose ? "" : " (use --verbose to list)"}`,
    );
    if (verbose) for (const file of s.unsupported_files) console.log(`  - ${file}`);
  }

  console.log(line);
  console.log("Artifacts:");
  console.log(`  ${s.artifacts.source_manifest}`);
  console.log(`  ${s.artifacts.classification}`);
  console.log(`  ${s.artifacts.extracted_facts}`);
  console.log(`  ${s.artifacts.intake_summary}`);
  if (result.wrotePayload) console.log(`  ${s.artifacts.payload}`);
  console.log(line);
  console.log("Next — validate again (no database, no production write):");
  console.log(`  ${s.next_command}`);
  console.log("Then — separately authorized draft import:");
  console.log(`  ${importCommand()}`);
  console.log(line);
}

async function main(): Promise<void> {
  // Tolerate the npm `--` separator when invoked as `npm run intake -- ...`
  // and also when jiti is called directly with an explicit `--`.
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const parsed = parseIntakeInvocation(args);
  if (!parsed.ok) {
    console.error(`Fast Intake: ${parsed.error}`);
    printUsage();
    process.exit(1);
  }

  const result = await runIntake({
    projectSlug: parsed.options.projectSlug,
    projectName: parsed.options.projectName,
    sources: parsed.options.sources,
    outRoot: parsed.options.outRoot,
    workspaceRoot: parsed.options.workspaceRoot,
    targetSeconds: parsed.options.targetSeconds,
    verbose: parsed.options.verbose,
  });

  printSummary(result, parsed.options.verbose);
  process.exit(result.exitCode);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
