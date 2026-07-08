import { importProject } from "./importer";
import { logFailure } from "./logger";

function printUsage() {
  console.log("Usage:");
  console.log("  npm run import <project-slug>");
  console.log("  npm run import <project-slug> -- --dry-run");
  console.log("");
  console.log("Examples:");
  console.log("  npm run import modeva");
  console.log("  npm run import modeva -- --dry-run");
  console.log("  npm run import coralina");
  console.log("  npm run import katabello");
  console.log("  npm run import gardens-of-eden");
}

async function main() {
  const args = process.argv.slice(2);
  const projectSlug = args.find((arg) => !arg.startsWith("-"));
  const dryRun = args.includes("--dry-run");

  if (!projectSlug || projectSlug === "--help" || projectSlug === "-h") {
    printUsage();
    process.exit(projectSlug ? 0 : 1);
  }

  await importProject({ projectSlug, dryRun });
}

main().catch((error) => {
  logFailure(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
